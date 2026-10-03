"""
Case / Investigation Service — Backend Person B

Manages fraud_cases lifecycle:
  - Case retrieval with full investigation bundle
  - Case assignment
  - Analyst decision recording
  - Case closure

Consumes risk_assessments, decisions, risk_reasons, genai_explanations
produced by Backend Person A.
"""
from __future__ import annotations
import logging
import time
from concurrent.futures import ThreadPoolExecutor
import uuid
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from intelligence.models import (
    AnalystFeedback, Decision, DecisionAction, DecidedByType,
    FraudCase, CaseStatus, CasePriority, RiskAssessment,
    Shipment, StaffUser, VerdictType,
)
from intelligence.services import audit_service
from intelligence.services.genai_service import get_explanation_for_assessment
from intelligence.services.fraud_graph_service import get_account_graph

log = logging.getLogger(__name__)

_case_pool = ThreadPoolExecutor(max_workers=4)
_CASE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CASE_LIST_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

def get_cached_case(key: str, ttl_seconds: float, compute_fn):
    now = time.time()
    if key in _CASE_CACHE:
        cached_time, cached_val = _CASE_CACHE[key]
        if now - cached_time < ttl_seconds:
            return cached_val
    val = compute_fn()
    _CASE_CACHE[key] = (now, val)
    return val

def invalidate_case_cache(case_id: str | None = None):
    global _CASE_CACHE, _CASE_LIST_CACHE
    _CASE_LIST_CACHE.clear()
    if case_id:
        for k in list(_CASE_CACHE.keys()):
            if case_id in k:
                _CASE_CACHE.pop(k, None)
    else:
        _CASE_CACHE.clear()

# SLA hours by priority
SLA_HOURS = {
    CasePriority.URGENT: 4,
    CasePriority.HIGH:   8,
    CasePriority.NORMAL: 24,
    CasePriority.LOW:    72,
}


def _priority_for_risk(risk_level: str) -> str:
    return {
        'CRITICAL': CasePriority.URGENT,
        'HIGH':     CasePriority.HIGH,
        'MEDIUM':   CasePriority.NORMAL,
        'LOW':      CasePriority.LOW,
    }.get(risk_level, CasePriority.NORMAL)


# ─── Case creation (called automatically after high-risk assessment) ──────────

@transaction.atomic
def open_case_for_assessment(assessment: RiskAssessment) -> FraudCase:
    """
    Open a fraud case for a high-risk assessment.
    Idempotent — returns existing case if one already exists for this shipment.
    """
    existing = FraudCase.objects.filter(shipment=assessment.shipment).first()
    if existing:
        return existing

    priority = _priority_for_risk(assessment.risk_level)
    sla_due = timezone.now() + timedelta(hours=SLA_HOURS.get(priority, 24))

    case = FraudCase.objects.create(
        shipment=assessment.shipment,
        assessment=assessment,
        account=assessment.shipment.account,
        priority=priority,
        sla_due_at=sla_due,
    )

    audit_service.log_event(
        action=audit_service.SCREENED,
        entity_type='FRAUD_CASE',
        entity_id=case.case_id,
        shipment_id=assessment.shipment_id,
        actor_type='SYSTEM',
        after_state={
            'case_id': str(case.case_id),
            'risk_level': assessment.risk_level,
            'risk_score': float(assessment.risk_score),
            'priority': priority,
        },
    )
    log.info("Opened case %s for shipment %s", case.case_id, assessment.shipment_id)
    return case


# ─── Case retrieval ───────────────────────────────────────────────────────────

def get_case_detail(case_id: str, include_graph: bool = False) -> dict[str, Any]:
    """
    Return the full investigation bundle for a case with in-memory caching (120s TTL).
    Optional include_graph flag avoids unnecessary graph traversal on pure case views.
    """
    cache_key = f'case_detail_{case_id}_{include_graph}'
    return get_cached_case(cache_key, 120.0, lambda: _compute_case_detail(case_id, include_graph=include_graph))


def _compute_case_detail(case_id: str, include_graph: bool = False) -> dict[str, Any]:
    case = None
    try:
        uuid.UUID(str(case_id))
        case = FraudCase.objects.select_related(
            'shipment', 'shipment__account', 'shipment__device',
            'shipment__payment', 'shipment__origin_address', 'shipment__dest_address',
            'assessment', 'assigned_to'
        ).filter(case_id=case_id).first()
    except (ValueError, TypeError):
        pass

    if not case:
        case = FraudCase.objects.select_related(
            'shipment', 'shipment__account', 'shipment__device',
            'shipment__payment', 'shipment__origin_address', 'shipment__dest_address',
            'assessment', 'assigned_to'
        ).filter(shipment__booking_ref=case_id).first()

    if not case:
        shipment_obj = Shipment.objects.filter(booking_ref=case_id).first()
        if shipment_obj:
            assessment_obj = RiskAssessment.objects.filter(shipment=shipment_obj).order_by('-assessed_at').first()
            if assessment_obj:
                case = open_case_for_assessment(assessment_obj)
                case = FraudCase.objects.select_related(
                    'shipment', 'shipment__account', 'shipment__device',
                    'shipment__payment', 'shipment__origin_address', 'shipment__dest_address',
                    'assessment', 'assigned_to'
                ).filter(case_id=case.case_id).first()

    if not case:
        raise FraudCase.DoesNotExist(f"Fraud case '{case_id}' not found.")

    assessment = case.assessment
    shipment = case.shipment
    account = shipment.account

    # Risk reasons
    reasons = list(
        assessment.reasons.order_by('rank').values(
            'rank', 'reason_code', 'category', 'points',
            'observed_value', 'baseline_value', 'description'
        )
    )

    # Latest automated decision
    latest_decision = shipment.decisions.filter(
        decided_by_type=DecidedByType.SYSTEM
    ).order_by('-decided_at').first()

    # Latest analyst override decision (if any)
    analyst_decision = shipment.decisions.filter(
        decided_by_type=DecidedByType.ANALYST
    ).order_by('-decided_at').first()

    # GenAI explanation (may be None if not yet generated)
    explanation = get_explanation_for_assessment(str(assessment.assessment_id))

    # Fraud graph (computed only when explicitly requested or already cached)
    if include_graph:
        try:
            graph = get_account_graph(str(account.account_id))
        except Exception as exc:
            log.warning("Graph unavailable for case %s: %s", case_id, exc)
            graph = {'error': str(exc)}
    else:
        graph = {
            'account_id': str(account.account_id),
            'node_count': 0,
            'edge_count': 0,
            'nodes': [],
            'edges': [],
        }

    # Audit trail
    audit_events = audit_service.get_shipment_timeline(str(shipment.shipment_id))

    # Non-blocking async audit log
    _case_pool.submit(
        audit_service.log_event,
        action=audit_service.DATA_VIEWED,
        entity_type='FRAUD_CASE',
        entity_id=case.case_id,
        shipment_id=shipment.shipment_id,
        actor_type='STAFF',
    )

    return {
        'case_id': str(case.case_id),
        'status': case.status,
        'priority': case.priority,
        'opened_at': case.opened_at.isoformat(),
        'sla_due_at': case.sla_due_at.isoformat() if case.sla_due_at else None,
        'closed_at': case.closed_at.isoformat() if case.closed_at else None,
        'verdict': case.verdict,
        'assigned_to': {
            'staff_id': str(case.assigned_to.staff_id),
            'full_name': case.assigned_to.full_name,
            'role': case.assigned_to.role,
        } if case.assigned_to else None,
        'shipment': {
            'shipment_id': str(shipment.shipment_id),
            'booking_ref': shipment.booking_ref,
            'service': shipment.service,
            'weight_kg': float(shipment.weight_kg),
            'booked_at': shipment.booked_at.isoformat(),
            'status': shipment.status,
            'origin_city': shipment.origin_address.city if shipment.origin_address_id else None,
            'dest_city': shipment.dest_address.city if shipment.dest_address_id else None,
        },
        'account': {
            'account_id': str(account.account_id),
            'account_number': account.account_number,
            'status': account.status,
            'opened_at': account.opened_at.isoformat(),
        },
        'risk_assessment': {
            'assessment_id': str(assessment.assessment_id),
            'risk_score': float(assessment.risk_score),
            'risk_level': assessment.risk_level,
            'fraud_probability': float(assessment.fraud_probability or 0),
            'rule_score': float(assessment.rule_score or 0),
            'ml_score': float(assessment.ml_score or 0),
            'assessed_at': assessment.assessed_at.isoformat(),
        },
        'risk_reasons': reasons,
        'automated_decision': {
            'decision_id': str(latest_decision.decision_id),
            'action': latest_decision.action,
            'decided_at': latest_decision.decided_at.isoformat(),
        } if latest_decision else None,
        'analyst_decision': {
            'decision_id': str(analyst_decision.decision_id),
            'action': analyst_decision.action,
            'reason': analyst_decision.reason,
            'decided_at': analyst_decision.decided_at.isoformat(),
        } if analyst_decision else None,
        'genai_explanation': {
            'explanation_id': str(explanation.explanation_id),
            'summary': explanation.summary_text,
            'recommended_actions': explanation.recommended_actions,
            'llm_model': explanation.llm_model,
            'generated_at': explanation.generated_at.isoformat(),
        } if explanation else None,
        'fraud_graph': graph,
        'audit': audit_events,
    }

    # Cross-populate cache with both identifiers so UUID or booking_ref lookups hit memory
    now = time.time()
    _CASE_CACHE[f'case_detail_{case.case_id}_{include_graph}'] = (now, result)
    if shipment and shipment.booking_ref:
        _CASE_CACHE[f'case_detail_{shipment.booking_ref}_{include_graph}'] = (now, result)

    return result


def list_cases(status: str | None = None, page: int = 1, page_size: int = 20) -> dict[str, Any]:
    """List cases with optional status filter and 120s TTL cache."""
    cache_key = f"cases_{status}_{page}_{page_size}"
    now = time.time()
    if cache_key in _CASE_LIST_CACHE:
        cached_time, cached_val = _CASE_LIST_CACHE[cache_key]
        if now - cached_time < 120.0:
            return cached_val

    qs = FraudCase.objects.select_related('shipment', 'account', 'assessment').order_by(
        '-opened_at'
    )
    if status:
        qs = qs.filter(status=status)

    offset = (page - 1) * page_size
    cases = list(qs[offset: offset + page_size])

    if page == 1 and len(cases) < page_size:
        total = len(cases)
    else:
        total = qs.count()

    result = {
        'total': total,
        'page': page,
        'page_size': page_size,
        'results': [
            {
                'case_id': str(c.case_id),
                'shipment_id': str(c.shipment_id),
                'booking_ref': c.shipment.booking_ref,
                'account_number': c.account.account_number,
                'risk_score': float(c.assessment.risk_score),
                'risk_level': c.assessment.risk_level,
                'status': c.status,
                'priority': c.priority,
                'opened_at': c.opened_at.isoformat(),
                'sla_due_at': c.sla_due_at.isoformat() if c.sla_due_at else None,
                'verdict': c.verdict,
            }
            for c in cases
        ],
    }
    _CASE_LIST_CACHE[cache_key] = (now, result)
    return result


# ─── Case assignment ──────────────────────────────────────────────────────────

@transaction.atomic
def assign_case(case_id: str, staff_user_id: str) -> FraudCase:
    case = FraudCase.objects.select_for_update().get(case_id=case_id)
    analyst = StaffUser.objects.get(staff_id=staff_user_id, is_active=True)

    prev_assignee = str(case.assigned_to_id) if case.assigned_to_id else None
    case.assigned_to = analyst
    case.status = CaseStatus.IN_REVIEW
    case.save()

    audit_service.log_event(
        action=audit_service.CASE_ASSIGNED,
        entity_type='FRAUD_CASE',
        entity_id=case.case_id,
        shipment_id=case.shipment_id,
        actor_type='STAFF',
        actor_id=staff_user_id,
        before_state={'assigned_to': prev_assignee},
        after_state={'assigned_to': str(analyst.staff_id), 'status': case.status},
    )
    invalidate_case_cache(str(case_id))
    return case


# ─── Analyst decision ─────────────────────────────────────────────────────────

@transaction.atomic
def record_analyst_decision(
    *,
    case_id: str,
    staff_user_id: str,
    verdict: str,
    action: str,
    reason: str = '',
    notes: str = '',
    fraud_type: str | None = None,
) -> tuple[FraudCase, Decision, AnalystFeedback]:
    """
    Record an analyst's decision on a fraud case.
    - Preserves the original system decision (immutable).
    - Creates a new Decision with supersedes_id pointing to the system decision.
    - Creates an AnalystFeedback record for ML retraining.
    - Creates audit events.
    """
    case = FraudCase.objects.select_for_update().select_related('assessment').get(case_id=case_id)
    analyst = StaffUser.objects.get(staff_id=staff_user_id, is_active=True)

    # Get the original automated decision to supersede
    automated_decision = case.shipment.decisions.filter(
        decided_by_type=DecidedByType.SYSTEM
    ).order_by('-decided_at').first()

    # Create analyst decision (never overwrites automated)
    analyst_decision = Decision.objects.create(
        shipment=case.shipment,
        assessment=case.assessment,
        action=action,
        decided_by_type=DecidedByType.ANALYST,
        decided_by_staff=analyst,
        reason=reason,
        supersedes=automated_decision,
    )

    # Create feedback for ML retraining
    feedback = AnalystFeedback.objects.create(
        case=case,
        shipment=case.shipment,
        analyst=analyst,
        predicted_level=case.assessment.risk_level,
        verdict=verdict,
        fraud_type=fraud_type,
        override_action=action,
        notes=notes,
    )

    # Update case status
    if verdict == VerdictType.CONFIRMED_FRAUD:
        case.verdict = VerdictType.CONFIRMED_FRAUD
        case.status = CaseStatus.CLOSED
        case.closed_at = timezone.now()
    elif verdict == VerdictType.FALSE_POSITIVE:
        case.verdict = VerdictType.FALSE_POSITIVE
        case.status = CaseStatus.CLOSED
        case.closed_at = timezone.now()
    else:
        case.verdict = VerdictType.INCONCLUSIVE
        case.status = CaseStatus.IN_REVIEW
    case.save()

    audit_service.log_event(
        action=audit_service.DECISION_OVERRIDE,
        entity_type='DECISION',
        entity_id=analyst_decision.decision_id,
        shipment_id=case.shipment_id,
        actor_type='STAFF',
        actor_id=staff_user_id,
        before_state={'action': automated_decision.action if automated_decision else None},
        after_state={
            'action': action,
            'verdict': verdict,
            'reason': reason,
            'case_status': case.status,
        },
    )

    if case.status == CaseStatus.CLOSED:
        audit_service.log_event(
            action=audit_service.CASE_CLOSED,
            entity_type='FRAUD_CASE',
            entity_id=case.case_id,
            shipment_id=case.shipment_id,
            actor_type='STAFF',
            actor_id=staff_user_id,
            after_state={'verdict': verdict, 'closed_at': case.closed_at.isoformat()},
        )

    audit_service.log_event(
        action=audit_service.ANALYST_FEEDBACK,
        entity_type='ANALYST_FEEDBACK',
        entity_id=feedback.feedback_id,
        shipment_id=case.shipment_id,
        actor_type='STAFF',
        actor_id=staff_user_id,
        after_state={'verdict': verdict, 'feedback_id': str(feedback.feedback_id)},
    )

    invalidate_case_cache(str(case_id))
    return case, analyst_decision, feedback


# ─── Case closure ─────────────────────────────────────────────────────────────

@transaction.atomic
def close_case(case_id: str, staff_user_id: str, notes: str = '') -> FraudCase:
    case = FraudCase.objects.select_for_update().get(case_id=case_id)
    case.status = CaseStatus.CLOSED
    case.closed_at = timezone.now()
    case.save()

    audit_service.log_event(
        action=audit_service.CASE_CLOSED,
        entity_type='FRAUD_CASE',
        entity_id=case.case_id,
        shipment_id=case.shipment_id,
        actor_type='STAFF',
        actor_id=staff_user_id,
        after_state={'status': 'CLOSED', 'notes': notes},
    )
    return case


def warm_cases_cache():
    """Warm cases list, top cases, and network graphs in cache on server startup."""
    try:
        log.info("[CACHE] Warming cases and graph cache...")
        res = list_cases()
        if res and res.get('results'):
            for item in res['results'][:8]:
                ref = item.get('booking_ref') or item.get('case_id')
                if ref:
                    try:
                        get_case_detail(ref, include_graph=False)
                    except Exception:
                        pass

        # Warm default cluster graphs for Fraud Graph page
        for acc in [
            '3515fce9-6616-4ef0-9074-fcacea953083',
            '68ebcbad-2690-44fa-9c8c-e1863b1fe355',
            '86f82aa8-4f2a-4588-ac76-b63ccc6ac41c',
        ]:
            try:
                get_account_graph(acc)
            except Exception:
                pass
        log.info("[CACHE] Cases and graph cache warmed successfully.")
    except Exception as exc:
        log.warning("[CACHE] Cases/graph cache warming error: %s", exc)
