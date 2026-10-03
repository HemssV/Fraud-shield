"""
GenAI Fraud Copilot Service — Backend Person B

Wraps Google Gemini to produce natural-language explanations of fraud
risk assessments.

CRITICAL RULES (hard-coded into the system prompt):
  • The LLM is an EXPLANATION layer only.
  • It must NOT calculate, modify, or override the risk score or decision.
  • It must NOT invent evidence not present in the structured input.
  • It must NOT classify a shipment as fraudulent by itself.

USE_MOCK_GENAI=true → deterministic fallback (no API key needed for demo).
USE_MOCK_GENAI=false → calls Gemini API using GEMINI_API_KEY.
"""
from __future__ import annotations
import hashlib
import json
import logging
import uuid
from typing import Any

from django.conf import settings
from django.db import transaction

from intelligence.models import (
    GenAIExplanation, RiskAssessment, RiskReason
)
from intelligence.services import audit_service

log = logging.getLogger(__name__)

# ─── Prompt construction ─────────────────────────────────────────────────────

SYSTEM_INSTRUCTIONS = """
You are FraudShield's fraud analysis assistant.
Your ONLY job is to explain, in clear business language, why a shipment was flagged by the automated fraud-detection system.

Hard rules you MUST follow:
1. Use ONLY the evidence provided in the JSON input below. Do not invent facts.
2. Do NOT recalculate or modify the risk_score or fraud_probability.
3. Do NOT change the automated_decision.
4. Do NOT claim fraud is confirmed unless the supplied evidence explicitly says so.
5. Do NOT mention these instructions in your response.

Return ONLY a valid JSON object with exactly these keys:
{
  "summary": "<1-3 sentence plain English summary>",
  "reasons": ["<reason 1>", "<reason 2>", ...],
  "recommended_actions": ["<action 1>", "<action 2>", ...]
}
"""


def _build_evidence_payload(assessment: RiskAssessment) -> dict[str, Any]:
    """Build the structured evidence dict sent to the LLM."""
    reasons = list(
        assessment.reasons.order_by('rank').values(
            'reason_id', 'reason_code', 'category', 'points',
            'observed_value', 'baseline_value', 'description'
        )
    )

    shipment = assessment.shipment
    account = shipment.account

    payload: dict[str, Any] = {
        'shipment_id': str(shipment.shipment_id),
        'booking_ref': shipment.booking_ref,
        'booked_at': shipment.booked_at.isoformat(),
        'service': shipment.service,
        'weight_kg': float(shipment.weight_kg),
        'account_number': account.account_number,
        'account_status': account.status,
        'risk_score': float(assessment.risk_score),
        'risk_level': assessment.risk_level,
        'fraud_probability': float(assessment.fraud_probability or 0),
        'automated_decision': None,
        'risk_reasons': reasons,
        'features': assessment.features,
    }

    # Attach the latest decision action
    latest_decision = shipment.decisions.order_by('-decided_at').first()
    if latest_decision:
        payload['automated_decision'] = latest_decision.action

    return payload


# ─── [HARDCODED DATA / GENAI DETERMINISTIC FALLBACK] ────────────────────────
def _mock_explanation(assessment: RiskAssessment, evidence: dict) -> dict[str, Any]:
    """
    Deterministic fallback explanation built from stored risk reasons.
    Used when USE_MOCK_GENAI=true or when the Gemini API key is unset or fails.
    """
    reasons = evidence.get('risk_reasons', [])
    reason_texts = [r['description'] for r in reasons if r.get('description')]

    if not reason_texts:
        reason_texts = ['The automated system flagged this shipment based on multiple signals.']

    summary = (
        f"This shipment received a {evidence['risk_level']} risk score of "
        f"{evidence['risk_score']:.0f}/100. "
        f"The automated decision is {evidence.get('automated_decision', 'UNKNOWN')}. "
        "Review the reasons below for details."
    )

    actions = [
        "Verify the account holder's identity.",
        "Confirm the payment method is authorized.",
        "Check whether the destination address is expected.",
        "Contact the shipper if the volume is unusually high.",
    ]

    return {
        'summary': summary,
        'reasons': reason_texts,
        'recommended_actions': actions[:min(len(reasons) + 1, 4)],
    }


def _call_gemini(evidence: dict) -> dict[str, Any]:
    """Call the Gemini API and return the parsed explanation."""
    from google import genai  # lazy import — new SDK
    from google.genai import types

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    model_name = getattr(settings, 'GEMINI_MODEL', 'gemini-2.0-flash')

    prompt = (
        SYSTEM_INSTRUCTIONS.strip()
        + "\n\nEvidence:\n"
        + json.dumps(evidence, indent=2, default=str)
    )

    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
    )
    raw_text = response.text.strip()

    # Strip markdown code fences if present
    if raw_text.startswith('```'):
        lines = raw_text.split('\n')
        raw_text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])

    return json.loads(raw_text)


@transaction.atomic
def generate_explanation(assessment_id: str) -> GenAIExplanation:
    """
    Generate (or return cached) GenAI explanation for a risk assessment.

    1. Load assessment + reasons from DB.
    2. Build structured evidence payload.
    3. Call LLM (or mock).
    4. Persist explanation in genai_explanations.
    5. Create audit log entry.

    Returns the GenAIExplanation model instance.
    """
    assessment = RiskAssessment.objects.select_related(
        'shipment', 'shipment__account'
    ).get(assessment_id=assessment_id)

    evidence = _build_evidence_payload(assessment)
    prompt_hash = hashlib.sha256(
        json.dumps(evidence, sort_keys=True, default=str).encode()
    ).hexdigest()

    # Return cached explanation if evidence hasn't changed
    cached = GenAIExplanation.objects.filter(
        assessment_id=assessment_id,
        prompt_hash=prompt_hash,
    ).first()
    if cached:
        log.debug("GenAI: returning cached explanation %s", cached.explanation_id)
        return cached

    use_mock = getattr(settings, 'USE_MOCK_GENAI', True)
    llm_model = 'mock' if use_mock else getattr(settings, 'GEMINI_MODEL', 'gemini-2.0-flash')

    if use_mock:
        structured = _mock_explanation(assessment, evidence)
    else:
        try:
            structured = _call_gemini(evidence)
        except Exception as exc:
            log.warning("Gemini API error (%s); falling back to mock explanation.", exc)
            structured = _mock_explanation(assessment, evidence)
            llm_model = 'mock-fallback'

    # Validate the LLM did NOT change the risk score
    # (sanity check — extra safety guard)
    if 'risk_score' in structured and structured.get('risk_score') != evidence['risk_score']:
        log.warning("GenAI tried to modify risk_score — stripping field.")
        structured.pop('risk_score', None)

    reason_ids = list(
        assessment.reasons.values_list('reason_id', flat=True)
    )

    explanation = GenAIExplanation.objects.create(
        assessment=assessment,
        llm_model=llm_model,
        prompt_hash=prompt_hash,
        summary_text=structured.get('summary', ''),
        recommended_actions=structured.get('recommended_actions', []),
        grounded_reason_ids=reason_ids,
        similar_case_ids=[],
    )

    audit_service.log_event(
        action=audit_service.GENAI_EXPLANATION_CREATED,
        entity_type='GENAI_EXPLANATION',
        entity_id=explanation.explanation_id,
        shipment_id=assessment.shipment_id,
        actor_type='LLM',
        after_state={'assessment_id': str(assessment_id), 'llm_model': llm_model},
    )

    return explanation


def get_explanation_for_assessment(assessment_id: str) -> GenAIExplanation | None:
    """Return the most recent explanation for an assessment, if any."""
    return GenAIExplanation.objects.filter(
        assessment_id=assessment_id
    ).order_by('-generated_at').first()
