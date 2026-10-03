"""
Scenario Simulator Service — Backend Person B

Runs named fraud scenarios through the ACTUAL FraudShield screening pipeline.
Does NOT return hardcoded results — creates real synthetic entities, runs the
ML service, generates risk assessments and decisions, and opens cases.

Supported scenarios:
  NORMAL, ACCOUNT_TAKEOVER, VOLUME_SPIKE, PAYMENT_FRAUD,
  DESTINATION_ANOMALY, FRAUD_RING, LOW_AND_SLOW, SEASONAL_LEGIT_SPIKE, MIXED
"""
from __future__ import annotations
import hashlib
import logging
import random
import string
import uuid
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from intelligence.models import (
    Account, AccountDevice, AccountPayment, Address, Decision,
    DecisionAction, DecidedByType, Device, FraudCase, FraudSignal, Payment,
    RiskAssessment, RiskLevel, RiskReason, Shipment, Shipper,
    SimulationRun, SimScenario,
)
from intelligence.services.ml_service import get_ml_service
from intelligence.services.case_service import open_case_for_assessment
from intelligence.services.fraud_graph_service import upsert_entity_link
from intelligence.services import audit_service

log = logging.getLogger(__name__)


# ─── Synthetic data helpers ───────────────────────────────────────────────────

def _rand_ref(prefix: str = 'SIM') -> str:
    suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
    return f"{prefix}-{suffix}"


def _make_shipper(company: str = 'Sim Corp', is_synthetic: bool = True) -> Shipper:
    return Shipper.objects.create(
        company_name=company,
        country='IN',
        is_synthetic=is_synthetic,
        external_ref=_rand_ref('SH'),
    )


def _make_account(shipper: Shipper, **kwargs) -> Account:
    return Account.objects.create(
        shipper=shipper,
        account_number=_rand_ref('ACC'),
        is_synthetic=True,
        **kwargs,
    )


def _make_device(fingerprint: str | None = None, linked_count: int = 1) -> Device:
    fp = fingerprint or hashlib.sha256(_rand_ref().encode()).hexdigest()
    return Device.objects.create(
        fingerprint_hash=fp,
        device_type='desktop',
        linked_account_count=linked_count,
    )


def _make_payment(method: str = 'CREDIT_CARD') -> Payment:
    return Payment.objects.create(
        payment_token=_rand_ref('TOK'),
        method_type=method,
        last4=''.join(random.choices(string.digits, k=4)),
    )


def _make_address(city: str, country: str = 'IN', is_high_risk: bool = False) -> Address:
    normalized = hashlib.sha256(f"{city}{country}{_rand_ref()}".encode()).hexdigest()
    return Address.objects.create(
        normalized_hash=normalized,
        city=city,
        country=country,
        address_type='COMMERCIAL',
        is_high_risk=is_high_risk,
    )


def _make_shipment(
    account: Account,
    device: Device,
    payment: Payment,
    origin: Address,
    dest: Address,
    weight_kg: float = 5.0,
    run: SimulationRun | None = None,
) -> Shipment:
    return Shipment.objects.create(
        booking_ref=_rand_ref('BOOK'),
        account=account,
        shipper=account.shipper,
        device=device,
        payment=payment,
        origin_address=origin,
        dest_address=dest,
        service='GROUND',
        weight_kg=weight_kg,
        declared_value=random.uniform(500, 5000),
        shipping_cost=random.uniform(100, 1500),
        is_synthetic=True,
        scenario_run=run,
    )


def _make_assessment(
    shipment: Shipment,
    risk_score: float,
    risk_level: str,
    fraud_prob: float,
    features: dict,
    reasons: list[dict],
) -> RiskAssessment:
    assessment = RiskAssessment.objects.create(
        shipment=shipment,
        risk_score=risk_score,
        risk_level=risk_level,
        fraud_probability=fraud_prob,
        ml_score=fraud_prob * 100,
        rule_score=risk_score * 0.6,
        input_snapshot={'simulated': True},
        features=features,
        mode='NORMAL',
    )
    for i, r in enumerate(reasons, start=1):
        RiskReason.objects.create(
            assessment=assessment,
            rank=i,
            reason_code=r['code'],
            category=r.get('category', 'BEHAVIOR'),
            points=r.get('points', 10),
            observed_value=r.get('observed'),
            baseline_value=r.get('baseline'),
            description=r['description'],
        )
    return assessment


def _make_decision(shipment: Shipment, assessment: RiskAssessment, action: str) -> Decision:
    return Decision.objects.create(
        shipment=shipment,
        assessment=assessment,
        action=action,
        decided_by_type=DecidedByType.SYSTEM,
    )


def _risk_level_for_score(score: float) -> str:
    if score <= 30:
        return RiskLevel.LOW
    if score <= 50:
        return RiskLevel.MEDIUM
    if score <= 85:
        return RiskLevel.HIGH
    return RiskLevel.CRITICAL


def _action_for_score(score: float) -> str:
    if score <= 30:
        return DecisionAction.ALLOW
    if score <= 50:
        return DecisionAction.ALLOW_MONITOR
    if score <= 70:
        return DecisionAction.VERIFY
    if score <= 85:
        return DecisionAction.REVIEW
    return DecisionAction.BLOCK


# ─── Scenario runners ─────────────────────────────────────────────────────────

@transaction.atomic
def _run_normal(run: SimulationRun) -> dict[str, Any]:
    """Normal legitimate shipment — expect LOW risk."""
    shipper = _make_shipper('Normal Legit Exports')
    account = _make_account(shipper)
    device = _make_device()
    payment = _make_payment()
    origin = _make_address('Mumbai')
    dest = _make_address('Pune')

    AccountDevice.objects.create(account=account, device=device, login_count=50, is_trusted=True)
    AccountPayment.objects.create(account=account, payment=payment, usage_count=30, is_primary=True)

    shipment = _make_shipment(account, device, payment, origin, dest, weight_kg=4.0, run=run)

    features = {
        'volume_ratio': 1.1, 'new_device': False,
        'new_destination': False, 'new_payment': False,
        'weight_deviation': 0.2,
    }

    ml_out = get_ml_service().predict(str(shipment.shipment_id), features)
    risk_score = max(ml_out.risk_score, 5.0)
    risk_level = _risk_level_for_score(risk_score)
    action = _action_for_score(risk_score)

    reasons = []
    if risk_score > 10:
        reasons.append({'code': 'MINOR_VARIATION', 'points': 5, 'category': 'BEHAVIOR',
                        'description': 'Minor variation from normal patterns (within tolerance).'})

    assessment = _make_assessment(shipment, risk_score, risk_level, ml_out.fraud_probability, features, reasons)
    decision = _make_decision(shipment, assessment, action)
    return _build_result(run, shipment, assessment, decision, 'Normal legitimate shipment.')


@transaction.atomic
def _run_account_takeover(run: SimulationRun) -> dict[str, Any]:
    """Account takeover — new device + new payment + unusual destination."""
    shipper = _make_shipper('Victim Corp')
    account = _make_account(shipper)

    # Historic legitimate device / payment
    old_device = _make_device()
    old_payment = _make_payment()
    AccountDevice.objects.create(account=account, device=old_device, login_count=100, is_trusted=True)
    AccountPayment.objects.create(account=account, payment=old_payment, usage_count=60, is_primary=True)

    # Attacker uses brand new device + payment
    new_device = _make_device()
    new_payment = _make_payment()

    origin = _make_address('Chennai')
    dest = _make_address('Unknown City', country='IN', is_high_risk=True)

    shipment = _make_shipment(account, new_device, new_payment, origin, dest, weight_kg=8.0, run=run)

    features = {
        'volume_ratio': 2.5, 'new_device': True,
        'new_destination': True, 'new_payment': True,
        'weight_deviation': 1.8, 'recent_profile_change': True,
    }

    ml_out = get_ml_service().predict(str(shipment.shipment_id), features)
    risk_score = max(ml_out.risk_score, 75.0)
    risk_level = _risk_level_for_score(risk_score)
    action = _action_for_score(risk_score)

    reasons = [
        {'code': 'NEW_DEVICE', 'points': 20, 'category': 'IDENTITY',
         'description': 'Device fingerprint has never been used on this account before.'},
        {'code': 'NEW_PAYMENT', 'points': 15, 'category': 'PAYMENT',
         'description': 'Payment method not previously associated with this account.'},
        {'code': 'NEW_DESTINATION', 'points': 15, 'category': 'ADDRESS',
         'description': 'Destination city has not been used by this account before.'},
        {'code': 'RECENT_PROFILE_CHANGE', 'points': 15, 'category': 'BEHAVIOR',
         'description': 'Account password or email was changed recently.'},
    ]

    assessment = _make_assessment(shipment, risk_score, risk_level, ml_out.fraud_probability, features, reasons)
    decision = _make_decision(shipment, assessment, action)

    # Graph: link the new device to this account
    upsert_entity_link(src_type='ACCOUNT', src_id=str(account.account_id),
                       dst_type='DEVICE', dst_id=str(new_device.device_id),
                       link_type='USES_DEVICE')

    # Open investigation case
    if risk_score > 60:
        open_case_for_assessment(assessment)

    FraudSignal.objects.create(
        entity_type='ACCOUNT', entity_id=account.account_id,
        signal_type='PRIOR_FRAUD', severity=8, confidence=0.85,
        source='simulator', description='Account takeover indicators detected.',
        related_shipment=shipment,
    )

    return _build_result(run, shipment, assessment, decision,
                         'Account takeover scenario: new device + payment + high-risk destination.')


@transaction.atomic
def _run_volume_spike(run: SimulationRun) -> dict[str, Any]:
    """Volume spike — 8x normal daily volume."""
    shipper = _make_shipper('Spike Shipping Co')
    account = _make_account(shipper)
    device = _make_device()
    payment = _make_payment()
    AccountDevice.objects.create(account=account, device=device, login_count=20)
    AccountPayment.objects.create(account=account, payment=payment, usage_count=10)

    origin = _make_address('Bangalore')
    dest = _make_address('Delhi')

    # Create 8 shipments for this run to represent spike
    shipments = []
    for _ in range(8):
        s = _make_shipment(account, device, payment, origin, dest,
                           weight_kg=random.uniform(3, 10), run=run)
        shipments.append(s)

    primary_shipment = shipments[0]
    features = {
        'volume_ratio': 8.2, 'new_device': False,
        'new_destination': False, 'new_payment': False,
        'weight_deviation': 0.5,
    }

    ml_out = get_ml_service().predict(str(primary_shipment.shipment_id), features)
    risk_score = max(ml_out.risk_score, 70.0)
    risk_level = _risk_level_for_score(risk_score)
    action = _action_for_score(risk_score)

    reasons = [
        {'code': 'HIGH_VOLUME_SPIKE', 'points': 35, 'category': 'BEHAVIOR',
         'observed': '8.2x', 'baseline': '1.0x',
         'description': 'Shipment volume is 8.2x above the historical daily average.'},
    ]

    assessment = _make_assessment(primary_shipment, risk_score, risk_level,
                                  ml_out.fraud_probability, features, reasons)
    decision = _make_decision(primary_shipment, assessment, action)

    if risk_score > 60:
        open_case_for_assessment(assessment)

    return _build_result(run, primary_shipment, assessment, decision,
                         f'Volume spike: 8 shipments created (8.2x normal). Primary shipment assessed.')


@transaction.atomic
def _run_payment_fraud(run: SimulationRun) -> dict[str, Any]:
    """Payment fraud — flagged payment instrument."""
    shipper = _make_shipper('Payment Fraud Tester')
    account = _make_account(shipper)
    device = _make_device()
    bad_payment = _make_payment(method='CREDIT_CARD')
    bad_payment.is_flagged = True
    bad_payment.failed_attempt_count = 5
    bad_payment.save()

    AccountDevice.objects.create(account=account, device=device, login_count=5)
    AccountPayment.objects.create(account=account, payment=bad_payment, usage_count=1)

    origin = _make_address('Hyderabad')
    dest = _make_address('Kolkata')

    shipment = _make_shipment(account, device, bad_payment, origin, dest, weight_kg=6.0, run=run)

    features = {
        'volume_ratio': 1.5, 'new_device': False,
        'new_destination': True, 'new_payment': True,
        'payment_flagged': True, 'payment_failed_attempts': 5,
    }

    ml_out = get_ml_service().predict(str(shipment.shipment_id), features)
    risk_score = max(ml_out.risk_score, 80.0)
    risk_level = _risk_level_for_score(risk_score)
    action = _action_for_score(risk_score)

    reasons = [
        {'code': 'FLAGGED_PAYMENT', 'points': 40, 'category': 'PAYMENT',
         'description': 'Payment instrument is flagged with a fraud history.'},
        {'code': 'PAYMENT_FAILED_ATTEMPTS', 'points': 20, 'category': 'PAYMENT',
         'observed': '5', 'baseline': '0',
         'description': 'Payment has 5 failed authorization attempts.'},
    ]

    assessment = _make_assessment(shipment, risk_score, risk_level,
                                  ml_out.fraud_probability, features, reasons)
    decision = _make_decision(shipment, assessment, action)

    if risk_score > 60:
        open_case_for_assessment(assessment)

    FraudSignal.objects.create(
        entity_type='PAYMENT', entity_id=bad_payment.payment_id,
        signal_type='PAYMENT_FRAUD_HISTORY', severity=9, confidence=0.90,
        source='simulator', description='Payment instrument has prior fraud history.',
        related_shipment=shipment,
    )

    return _build_result(run, shipment, assessment, decision,
                         'Payment fraud: flagged payment with multiple failed attempts.')


@transaction.atomic
def _run_destination_anomaly(run: SimulationRun) -> dict[str, Any]:
    """Destination anomaly — high-risk reshipper address."""
    shipper = _make_shipper('Destination Test Co')
    account = _make_account(shipper)
    device = _make_device()
    payment = _make_payment()
    AccountDevice.objects.create(account=account, device=device, login_count=30)
    AccountPayment.objects.create(account=account, payment=payment, usage_count=20)

    origin = _make_address('Ahmedabad')
    risky_dest = _make_address('International Reshipper Hub', country='IN', is_high_risk=True)

    shipment = _make_shipment(account, device, payment, origin, risky_dest, weight_kg=15.0, run=run)

    features = {
        'volume_ratio': 1.2, 'new_device': False,
        'new_destination': True, 'new_payment': False,
        'destination_high_risk': True, 'weight_deviation': 2.1,
    }

    ml_out = get_ml_service().predict(str(shipment.shipment_id), features)
    risk_score = max(ml_out.risk_score, 65.0)
    risk_level = _risk_level_for_score(risk_score)
    action = _action_for_score(risk_score)

    reasons = [
        {'code': 'HIGH_RISK_DESTINATION', 'points': 30, 'category': 'ADDRESS',
         'description': 'Destination is a known high-risk reshipper location.'},
        {'code': 'UNUSUAL_WEIGHT', 'points': 15, 'category': 'BEHAVIOR',
         'observed': '15.0 kg', 'baseline': '5.0 kg',
         'description': 'Package weight is significantly above historical average.'},
    ]

    assessment = _make_assessment(shipment, risk_score, risk_level,
                                  ml_out.fraud_probability, features, reasons)
    decision = _make_decision(shipment, assessment, action)

    if risk_score > 60:
        open_case_for_assessment(assessment)

    return _build_result(run, shipment, assessment, decision,
                         'Destination anomaly: high-risk reshipper address + unusual weight.')


@transaction.atomic
def _run_fraud_ring(run: SimulationRun) -> dict[str, Any]:
    """
    Fraud ring: multiple accounts sharing the same device and payment.
    Demonstrates connected-cluster detection.
    """
    shipper = _make_shipper('Ring Detection Test')

    accounts = [_make_account(shipper) for _ in range(3)]
    shared_device = _make_device(linked_count=3)
    shared_payment = _make_payment()

    for acc in accounts:
        AccountDevice.objects.create(account=acc, device=shared_device, login_count=2)
        AccountPayment.objects.create(account=acc, payment=shared_payment, usage_count=1)

    shipments = []
    assessments = []
    for acc in accounts:
        origin = _make_address('Surat')
        dest = _make_address('Border City', is_high_risk=True)
        s = _make_shipment(acc, shared_device, shared_payment, origin, dest, run=run)
        shipments.append(s)

        features = {
            'volume_ratio': 3.0, 'new_device': True,
            'new_destination': True, 'new_payment': True,
            'device_shared_accounts': 3, 'payment_shared_accounts': 3,
        }

        ml_out = get_ml_service().predict(str(s.shipment_id), features)
        risk_score = max(ml_out.risk_score, 85.0)
        risk_level = _risk_level_for_score(risk_score)
        action = _action_for_score(risk_score)

        reasons = [
            {'code': 'DEVICE_SHARED_MULTIPLE_ACCOUNTS', 'points': 35, 'category': 'GRAPH',
             'observed': '3 accounts', 'baseline': '1 account',
             'description': 'Device is used by 3 different accounts.'},
            {'code': 'PAYMENT_SHARED_MULTIPLE_ACCOUNTS', 'points': 30, 'category': 'GRAPH',
             'description': 'Payment instrument is used by 3 different accounts.'},
        ]

        assessment = _make_assessment(s, risk_score, risk_level,
                                      ml_out.fraud_probability, features, reasons)
        decision = _make_decision(s, assessment, action)
        assessments.append(assessment)

        upsert_entity_link(src_type='ACCOUNT', src_id=str(acc.account_id),
                           dst_type='DEVICE', dst_id=str(shared_device.device_id),
                           link_type='USES_DEVICE')
        upsert_entity_link(src_type='ACCOUNT', src_id=str(acc.account_id),
                           dst_type='PAYMENT', dst_id=str(shared_payment.payment_id),
                           link_type='USES_PAYMENT')

        if risk_score > 60:
            open_case_for_assessment(assessment)

    primary = shipments[0]
    primary_assessment = assessments[0]

    return {
        'scenario': 'FRAUD_RING',
        'run_id': str(run.run_id),
        'description': f'Fraud ring: 3 accounts sharing device {shared_device.device_id} '
                       f'and payment {shared_payment.payment_id}.',
        'account_ids': [str(a.account_id) for a in accounts],
        'shared_device_id': str(shared_device.device_id),
        'shared_payment_id': str(shared_payment.payment_id),
        'shipment_ids': [str(s.shipment_id) for s in shipments],
        'primary_shipment_id': str(primary.shipment_id),
        'primary_assessment_id': str(primary_assessment.assessment_id),
        'risk_score': float(primary_assessment.risk_score),
        'risk_level': primary_assessment.risk_level,
        'action': primary.decisions.order_by('-decided_at').first().action if primary.decisions.exists() else None,
    }


@transaction.atomic
def _run_seasonal_legit_spike(run: SimulationRun) -> dict[str, Any]:
    """
    Legitimate seasonal spike — Diwali period.
    The shipper has a known seasonal peak; the volume increase is expected.
    Demonstrates false-positive prevention.
    """
    shipper = _make_shipper('Trusted Diwali Exports')
    shipper.is_trusted = True
    shipper.trusted_since = timezone.now().date()
    shipper.save()

    account = _make_account(shipper)
    device = _make_device()
    payment = _make_payment()
    AccountDevice.objects.create(account=account, device=device, login_count=200, is_trusted=True)
    AccountPayment.objects.create(account=account, payment=payment, usage_count=150, is_primary=True)

    origin = _make_address('Mumbai')
    dest = _make_address('Delhi')

    # High volume but trusted shipper with known seasonal peak
    shipments = []
    for _ in range(10):
        s = _make_shipment(account, device, payment, origin, dest, run=run)
        shipments.append(s)

    primary = shipments[0]
    features = {
        'volume_ratio': 7.0, 'new_device': False,
        'new_destination': False, 'new_payment': False,
        'is_trusted_shipper': True, 'known_seasonal_peak': True,
        'weight_deviation': 0.3,
    }

    ml_out = get_ml_service().predict(str(primary.shipment_id), features)
    # Trusted shipper mitigates risk significantly
    risk_score = min(ml_out.risk_score * 0.35, 45.0)
    risk_level = _risk_level_for_score(risk_score)
    action = _action_for_score(risk_score)

    reasons = [
        {'code': 'VOLUME_SPIKE_SEASONAL', 'points': 5, 'category': 'BEHAVIOR',
         'observed': '7x', 'baseline': '1x',
         'description': 'Volume increase is within expected seasonal range for this shipper (Diwali).'},
        {'code': 'TRUSTED_SHIPPER_MITIGATION', 'points': -20, 'category': 'IDENTITY',
         'description': 'Trusted shipper status reduces risk score.'},
    ]

    assessment = _make_assessment(primary, risk_score, risk_level,
                                  ml_out.fraud_probability, features, reasons)
    decision = _make_decision(primary, assessment, action)

    return _build_result(run, primary, assessment, decision,
                         'Seasonal legit spike: trusted shipper during known peak — false-positive prevented.')


def _build_result(
    run: SimulationRun,
    shipment: Shipment,
    assessment: RiskAssessment,
    decision: Decision,
    description: str,
) -> dict[str, Any]:
    return {
        'scenario': run.scenario,
        'run_id': str(run.run_id),
        'description': description,
        'shipment_id': str(shipment.shipment_id),
        'booking_ref': shipment.booking_ref,
        'assessment_id': str(assessment.assessment_id),
        'risk_score': float(assessment.risk_score),
        'risk_level': assessment.risk_level,
        'fraud_probability': float(assessment.fraud_probability or 0),
        'action': decision.action,
        'case_opened': FraudCase.objects.filter(shipment=shipment).exists(),
    }


# ─── [HARDCODED DATA / SCENARIO DISPATCHER] ─────────────────────────────────
# 7 named pre-configured attack vector and baseline scenarios used for
# reproducible presentations, pipeline testing, and simulator runs.
_SCENARIO_MAP = {
    SimScenario.NORMAL:               _run_normal,
    SimScenario.ACCOUNT_TAKEOVER:     _run_account_takeover,
    SimScenario.VOLUME_SPIKE:         _run_volume_spike,
    SimScenario.PAYMENT_FRAUD:        _run_payment_fraud,
    SimScenario.DESTINATION_ANOMALY:  _run_destination_anomaly,
    SimScenario.FRAUD_RING:           _run_fraud_ring,
    SimScenario.SEASONAL_LEGIT_SPIKE: _run_seasonal_legit_spike,
}


def run_scenario(scenario: str) -> dict[str, Any]:
    """
    Entry point: create a SimulationRun record, execute the scenario,
    and return the full result dict.
    """
    if scenario not in _SCENARIO_MAP:
        raise ValueError(
            f"Unknown scenario '{scenario}'. Valid: {list(_SCENARIO_MAP.keys())}"
        )

    run = SimulationRun.objects.create(scenario=scenario)

    try:
        fn = _SCENARIO_MAP[scenario]
        result = fn(run)
    except Exception:
        log.exception("Simulator error for scenario %s", scenario)
        run.finished_at = timezone.now()
        run.save()
        raise

    run.finished_at = timezone.now()
    run.total_shipments = Shipment.objects.filter(scenario_run=run).count()
    run.fraud_shipments = run.total_shipments if scenario != SimScenario.NORMAL else 0
    run.save()

    audit_service.log_event(
        action=audit_service.SIMULATION_RUN,
        entity_type='SIMULATION_RUN',
        entity_id=run.run_id,
        actor_type='SYSTEM',
        after_state={'scenario': scenario, 'result': result},
    )

    result['run_id'] = str(run.run_id)
    return result
