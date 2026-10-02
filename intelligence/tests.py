"""
Tests — Backend Person B — FraudShield Intelligence.

Covers: ML adapter, GenAI service, fraud graph, cases, audit, dashboard, simulator.
Run with: python manage.py test intelligence
"""
import uuid
import hashlib
from unittest.mock import patch, MagicMock

from django.test import TestCase
from rest_framework.test import APITestCase
from rest_framework import status


# ─── Helper factories ─────────────────────────────────────────────────────────

def _mk_shipper():
    from intelligence.models import Shipper
    return Shipper.objects.create(
        company_name='Test Shipper',
        country='IN',
        external_ref=str(uuid.uuid4()),
    )


def _mk_account(shipper=None):
    from intelligence.models import Account
    if shipper is None:
        shipper = _mk_shipper()
    return Account.objects.create(
        shipper=shipper,
        account_number=str(uuid.uuid4()),
    )


def _mk_device():
    from intelligence.models import Device
    fp = hashlib.sha256(str(uuid.uuid4()).encode()).hexdigest()
    return Device.objects.create(fingerprint_hash=fp, device_type='desktop')


def _mk_payment():
    from intelligence.models import Payment
    return Payment.objects.create(
        payment_token=str(uuid.uuid4()),
        method_type='CREDIT_CARD',
        last4='1234',
    )


def _mk_address(city='Mumbai'):
    from intelligence.models import Address
    nh = hashlib.sha256(f"{city}{uuid.uuid4()}".encode()).hexdigest()
    return Address.objects.create(
        normalized_hash=nh,
        city=city,
        country='IN',
        address_type='COMMERCIAL',
    )


def _mk_shipment(account=None, device=None, payment=None):
    from intelligence.models import Shipment
    if account is None:
        account = _mk_account()
    if device is None:
        device = _mk_device()
    if payment is None:
        payment = _mk_payment()
    origin = _mk_address('Chennai')
    dest = _mk_address('Delhi')
    return Shipment.objects.create(
        booking_ref=str(uuid.uuid4()),
        account=account,
        shipper=account.shipper,
        device=device,
        payment=payment,
        origin_address=origin,
        dest_address=dest,
        service='GROUND',
        weight_kg=5.0,
        shipping_cost=500,
        declared_value=1000,
    )


def _mk_assessment(shipment, risk_score=75, risk_level='HIGH', fraud_prob=0.75):
    from intelligence.models import RiskAssessment
    return RiskAssessment.objects.create(
        shipment=shipment,
        risk_score=risk_score,
        risk_level=risk_level,
        fraud_probability=fraud_prob,
        ml_score=fraud_prob * 100,
        rule_score=risk_score * 0.6,
        input_snapshot={},
        features={'volume_ratio': 8.2, 'new_device': True},
        mode='NORMAL',
    )


def _mk_risk_reason(assessment, rank=1):
    from intelligence.models import RiskReason
    return RiskReason.objects.create(
        assessment=assessment,
        rank=rank,
        reason_code='NEW_DEVICE',
        category='IDENTITY',
        points=20,
        description='New device detected.',
    )


def _mk_decision(shipment, assessment, action='BLOCK'):
    from intelligence.models import Decision, DecidedByType
    return Decision.objects.create(
        shipment=shipment,
        assessment=assessment,
        action=action,
        decided_by_type=DecidedByType.SYSTEM,
    )


def _mk_staff():
    from intelligence.models import StaffUser
    return StaffUser.objects.create(
        email=f"analyst-{uuid.uuid4()}@test.com",
        full_name='Test Analyst',
        role='ANALYST',
    )


def _mk_case(shipment=None, assessment=None):
    from intelligence.models import FraudCase
    if shipment is None:
        shipment = _mk_shipment()
    if assessment is None:
        assessment = _mk_assessment(shipment)
    return FraudCase.objects.create(
        shipment=shipment,
        assessment=assessment,
        account=shipment.account,
        priority='HIGH',
    )


# ═════════════════════════════════════════════════════════════════════════════
# 1. ML Service
# ═════════════════════════════════════════════════════════════════════════════

class TestMockMLAdapter(TestCase):

    def setUp(self):
        from intelligence.services.ml_service import MockMLAdapter
        self.adapter = MockMLAdapter()

    def test_normal_shipment_low_score(self):
        from intelligence.services.ml_service import MLInput
        result = self.adapter.predict(MLInput('S001', {'volume_ratio': 1.0, 'new_device': False}))
        self.assertLess(result.fraud_probability, 0.40)

    def test_high_volume_spike_increases_score(self):
        from intelligence.services.ml_service import MLInput
        result = self.adapter.predict(MLInput('S002', {'volume_ratio': 8.5, 'new_device': True, 'new_destination': True}))
        self.assertGreater(result.fraud_probability, 0.50)

    def test_all_signals_high_score(self):
        from intelligence.services.ml_service import MLInput
        result = self.adapter.predict(MLInput('S003', {
            'volume_ratio': 10.0, 'new_device': True, 'new_destination': True,
            'new_payment': True, 'weight_deviation': 3.0, 'recent_profile_change': True,
        }))
        self.assertGreater(result.fraud_probability, 0.85)

    def test_empty_features_raises_valueerror(self):
        from intelligence.services.ml_service import FraudMLService
        svc = FraudMLService.__new__(FraudMLService)
        from intelligence.services.ml_service import MockMLAdapter
        svc._adapter = MockMLAdapter()
        with self.assertRaises(ValueError):
            svc.predict('S004', {})

    def test_top_reasons_returned(self):
        from intelligence.services.ml_service import MLInput
        result = self.adapter.predict(MLInput('S005', {'volume_ratio': 6.0, 'new_device': True}))
        self.assertIn('volume_spike', result.top_reasons)
        self.assertIn('new_device', result.top_reasons)

    def test_result_capped_at_097(self):
        from intelligence.services.ml_service import MLInput
        result = self.adapter.predict(MLInput('S006', {
            'volume_ratio': 100.0, 'new_device': True, 'new_destination': True,
            'new_payment': True, 'weight_deviation': 99.0, 'recent_profile_change': True,
        }))
        self.assertLessEqual(result.fraud_probability, 0.97)

    def test_risk_level_derived(self):
        from intelligence.services.ml_service import MLOutput
        self.assertEqual(MLOutput(0.1, [])._derive_level(10), 'LOW')
        self.assertEqual(MLOutput(0.4, [])._derive_level(40), 'MEDIUM')
        self.assertEqual(MLOutput(0.8, [])._derive_level(80), 'HIGH')
        self.assertEqual(MLOutput(0.99, [])._derive_level(99), 'CRITICAL')


class TestMLPredictAPI(APITestCase):

    def test_valid_request_returns_200(self):
        resp = self.client.post('/api/v1/ml/predict/', {
            'shipment_id': 'S001',
            'features': {'volume_ratio': 1.5, 'new_device': False},
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('fraud_probability', resp.data)
        self.assertIn('top_reasons', resp.data)

    def test_empty_features_returns_400(self):
        resp = self.client.post('/api/v1/ml/predict/', {
            'shipment_id': 'S001',
            'features': {},
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_missing_shipment_id_returns_400(self):
        resp = self.client.post('/api/v1/ml/predict/', {
            'features': {'volume_ratio': 1.0},
        }, format='json')
        self.assertEqual(resp.status_code, 400)


# ═════════════════════════════════════════════════════════════════════════════
# 2. GenAI Service
# ═════════════════════════════════════════════════════════════════════════════

class TestGenAIService(TestCase):

    def setUp(self):
        self.shipment = _mk_shipment()
        self.assessment = _mk_assessment(self.shipment)
        _mk_risk_reason(self.assessment, rank=1)
        _mk_decision(self.shipment, self.assessment)

    def test_mock_genai_returns_explanation(self):
        from intelligence.services.genai_service import generate_explanation
        exp = generate_explanation(str(self.assessment.assessment_id))
        self.assertIsNotNone(exp.summary_text)
        self.assertTrue(len(exp.summary_text) > 0)

    def test_llm_model_is_mock(self):
        from intelligence.services.genai_service import generate_explanation
        exp = generate_explanation(str(self.assessment.assessment_id))
        self.assertEqual(exp.llm_model, 'mock')

    def test_cached_explanation_returned_on_second_call(self):
        from intelligence.services.genai_service import generate_explanation
        exp1 = generate_explanation(str(self.assessment.assessment_id))
        exp2 = generate_explanation(str(self.assessment.assessment_id))
        self.assertEqual(exp1.explanation_id, exp2.explanation_id)

    def test_explanation_grounded_in_reasons(self):
        from intelligence.services.genai_service import generate_explanation
        from intelligence.models import RiskReason
        exp = generate_explanation(str(self.assessment.assessment_id))
        reason_ids = list(RiskReason.objects.filter(
            assessment=self.assessment
        ).values_list('reason_id', flat=True))
        self.assertEqual(exp.grounded_reason_ids, reason_ids)

    def test_explanation_does_not_modify_risk_score(self):
        from intelligence.services.genai_service import generate_explanation
        original_score = float(self.assessment.risk_score)
        generate_explanation(str(self.assessment.assessment_id))
        self.assessment.refresh_from_db()
        self.assertEqual(float(self.assessment.risk_score), original_score)


# ═════════════════════════════════════════════════════════════════════════════
# 3. Fraud Graph
# ═════════════════════════════════════════════════════════════════════════════

class TestFraudGraphService(TestCase):

    def setUp(self):
        self.account = _mk_account()
        self.device = _mk_device()
        self.payment = _mk_payment()

    def test_empty_graph_returns_valid_structure(self):
        from intelligence.services.fraud_graph_service import get_account_graph
        result = get_account_graph(str(self.account.account_id))
        self.assertIn('nodes', result)
        self.assertIn('edges', result)
        self.assertIn('risk_signals', result)

    def test_entity_link_appears_in_graph(self):
        from intelligence.models import EntityLink
        from intelligence.services.fraud_graph_service import get_account_graph
        EntityLink.objects.create(
            src_type='ACCOUNT', src_id=self.account.account_id,
            dst_type='DEVICE', dst_id=self.device.device_id,
            link_type='USES_DEVICE', weight=3,
        )
        result = get_account_graph(str(self.account.account_id))
        self.assertGreater(len(result['edges']), 0)

    def test_upsert_link_increments_weight(self):
        from intelligence.services.fraud_graph_service import upsert_entity_link
        link1 = upsert_entity_link(
            src_type='ACCOUNT', src_id=str(self.account.account_id),
            dst_type='DEVICE', dst_id=str(self.device.device_id),
            link_type='USES_DEVICE',
        )
        link2 = upsert_entity_link(
            src_type='ACCOUNT', src_id=str(self.account.account_id),
            dst_type='DEVICE', dst_id=str(self.device.device_id),
            link_type='USES_DEVICE',
        )
        self.assertEqual(link2.weight, 2)

    def test_shared_device_ring_detection(self):
        from intelligence.services.fraud_graph_service import detect_fraud_rings
        from intelligence.models import AccountDevice
        # Two accounts sharing the same device
        acct2 = _mk_account()
        AccountDevice.objects.create(account=self.account, device=self.device)
        AccountDevice.objects.create(account=acct2, device=self.device)
        # Need a shared payment too for threshold of 2
        AccountDevice.objects.create(account=self.account, device=_mk_device())
        # Use min_shared_entities=1 to trigger on device alone
        rings = detect_fraud_rings(min_shared_entities=1)
        self.assertGreater(len(rings), 0)

    def test_nonexistent_account_raises(self):
        from intelligence.services.fraud_graph_service import get_account_graph
        with self.assertRaises(Exception):
            get_account_graph(str(uuid.uuid4()))


# ═════════════════════════════════════════════════════════════════════════════
# 4. Cases / Investigation
# ═════════════════════════════════════════════════════════════════════════════

class TestCaseService(TestCase):

    def setUp(self):
        self.shipment = _mk_shipment()
        self.assessment = _mk_assessment(self.shipment)
        _mk_decision(self.shipment, self.assessment)
        self.staff = _mk_staff()

    def test_open_case_creates_case(self):
        from intelligence.services.case_service import open_case_for_assessment
        case = open_case_for_assessment(self.assessment)
        self.assertIsNotNone(case.case_id)

    def test_open_case_idempotent(self):
        from intelligence.services.case_service import open_case_for_assessment
        from intelligence.models import FraudCase
        open_case_for_assessment(self.assessment)
        open_case_for_assessment(self.assessment)
        count = FraudCase.objects.filter(shipment=self.shipment).count()
        self.assertEqual(count, 1)

    def test_assign_case(self):
        from intelligence.services.case_service import open_case_for_assessment, assign_case
        case = open_case_for_assessment(self.assessment)
        updated = assign_case(str(case.case_id), str(self.staff.staff_id))
        self.assertEqual(str(updated.assigned_to_id), str(self.staff.staff_id))
        self.assertEqual(updated.status, 'IN_REVIEW')

    def test_record_analyst_decision_confirmed_fraud(self):
        from intelligence.services.case_service import open_case_for_assessment, record_analyst_decision
        case = open_case_for_assessment(self.assessment)
        updated_case, decision, feedback = record_analyst_decision(
            case_id=str(case.case_id),
            staff_user_id=str(self.staff.staff_id),
            verdict='CONFIRMED_FRAUD',
            action='BLOCK',
            reason='Test reason',
        )
        self.assertEqual(updated_case.verdict, 'CONFIRMED_FRAUD')
        self.assertEqual(updated_case.status, 'CLOSED')
        self.assertEqual(decision.action, 'BLOCK')

    def test_analyst_decision_does_not_overwrite_system_decision(self):
        from intelligence.services.case_service import open_case_for_assessment, record_analyst_decision
        from intelligence.models import Decision
        case = open_case_for_assessment(self.assessment)
        record_analyst_decision(
            case_id=str(case.case_id),
            staff_user_id=str(self.staff.staff_id),
            verdict='FALSE_POSITIVE',
            action='ALLOW',
        )
        all_decisions = Decision.objects.filter(shipment=self.shipment).count()
        system_decisions = Decision.objects.filter(
            shipment=self.shipment, decided_by_type='SYSTEM'
        ).count()
        self.assertEqual(system_decisions, 1)
        self.assertEqual(all_decisions, 2)  # system + analyst

    def test_close_case(self):
        from intelligence.services.case_service import open_case_for_assessment, close_case
        case = open_case_for_assessment(self.assessment)
        closed = close_case(str(case.case_id), str(self.staff.staff_id))
        self.assertEqual(closed.status, 'CLOSED')


class TestCaseAPI(APITestCase):

    def setUp(self):
        self.shipment = _mk_shipment()
        self.assessment = _mk_assessment(self.shipment)
        _mk_risk_reason(self.assessment)
        _mk_decision(self.shipment, self.assessment)
        from intelligence.services.case_service import open_case_for_assessment
        self.case = open_case_for_assessment(self.assessment)

    def test_list_cases(self):
        resp = self.client.get('/api/v1/cases/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('results', resp.data)

    def test_case_detail(self):
        resp = self.client.get(f'/api/v1/cases/{self.case.case_id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('risk_assessment', resp.data)
        self.assertIn('audit', resp.data)

    def test_case_not_found(self):
        resp = self.client.get(f'/api/v1/cases/{uuid.uuid4()}/')
        self.assertEqual(resp.status_code, 404)


# ═════════════════════════════════════════════════════════════════════════════
# 5. Audit
# ═════════════════════════════════════════════════════════════════════════════

class TestAuditService(TestCase):

    def test_log_event_creates_entry(self):
        from intelligence.services.audit_service import log_event, SCREENED
        from intelligence.models import AuditLog
        sid = uuid.uuid4()
        log_event(action=SCREENED, entity_type='SHIPMENT', entity_id=sid, shipment_id=sid)
        self.assertTrue(AuditLog.objects.filter(action=SCREENED).exists())

    def test_hash_chain_maintained(self):
        from intelligence.services.audit_service import log_event, SCREENED, DECISION_MADE
        from intelligence.models import AuditLog
        sid = uuid.uuid4()
        log_event(action=SCREENED, entity_type='SHIPMENT', entity_id=sid, shipment_id=sid)
        log_event(action=DECISION_MADE, entity_type='DECISION', entity_id=uuid.uuid4(), shipment_id=sid)
        entries = AuditLog.objects.order_by('audit_id')
        if entries.count() >= 2:
            e1, e2 = entries[0], entries[1]
            self.assertEqual(e2.prev_hash, e1.row_hash)

    def test_get_shipment_timeline(self):
        from intelligence.services.audit_service import log_event, SCREENED, get_shipment_timeline
        sid = uuid.uuid4()
        log_event(action=SCREENED, entity_type='SHIPMENT', entity_id=sid, shipment_id=sid)
        events = get_shipment_timeline(str(sid))
        self.assertGreater(len(events), 0)
        self.assertEqual(events[0]['action'], SCREENED)


class TestAuditAPI(APITestCase):

    def test_audit_timeline(self):
        from intelligence.services.audit_service import log_event, SCREENED
        sid = uuid.uuid4()
        log_event(action=SCREENED, entity_type='SHIPMENT', entity_id=sid, shipment_id=sid)
        resp = self.client.get(f'/api/v1/audit/shipment/{sid}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('events', resp.data)


# ═════════════════════════════════════════════════════════════════════════════
# 6. Analyst Feedback
# ═════════════════════════════════════════════════════════════════════════════

class TestFeedback(TestCase):

    def test_feedback_stored_on_analyst_decision(self):
        from intelligence.services.case_service import open_case_for_assessment, record_analyst_decision
        from intelligence.models import AnalystFeedback
        shipment = _mk_shipment()
        assessment = _mk_assessment(shipment)
        _mk_decision(shipment, assessment)
        staff = _mk_staff()
        case = open_case_for_assessment(assessment)
        record_analyst_decision(
            case_id=str(case.case_id),
            staff_user_id=str(staff.staff_id),
            verdict='CONFIRMED_FRAUD',
            action='BLOCK',
            fraud_type='ACCOUNT_TAKEOVER',
        )
        fb = AnalystFeedback.objects.filter(case=case).first()
        self.assertIsNotNone(fb)
        self.assertEqual(fb.verdict, 'CONFIRMED_FRAUD')
        self.assertEqual(fb.fraud_type, 'ACCOUNT_TAKEOVER')
        self.assertFalse(fb.used_for_training)  # ML person flips this


# ═════════════════════════════════════════════════════════════════════════════
# 7. Dashboard Analytics
# ═════════════════════════════════════════════════════════════════════════════

class TestDashboardAPI(APITestCase):

    def test_summary_endpoint(self):
        resp = self.client.get('/api/v1/dashboard/summary/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('total_screened', resp.data)
        self.assertIn('blocked', resp.data)

    def test_daily_trend_endpoint(self):
        resp = self.client.get('/api/v1/dashboard/daily/?days=7')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)

    def test_review_queue_endpoint(self):
        resp = self.client.get('/api/v1/dashboard/review-queue/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)

    def test_recent_alerts_endpoint(self):
        resp = self.client.get('/api/v1/dashboard/recent-alerts/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)

    def test_fraud_types_endpoint(self):
        resp = self.client.get('/api/v1/dashboard/fraud-types/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)


# ═════════════════════════════════════════════════════════════════════════════
# 8. Scenario Simulator
# ═════════════════════════════════════════════════════════════════════════════

class TestSimulator(TestCase):

    def _run(self, scenario):
        from intelligence.services.simulator_service import run_scenario
        return run_scenario(scenario)

    def test_normal_scenario_low_risk(self):
        result = self._run('NORMAL')
        self.assertIn(result['risk_level'], ['LOW', 'MEDIUM'])
        self.assertIn(result['action'], ['ALLOW', 'ALLOW_MONITOR'])

    def test_account_takeover_high_risk(self):
        result = self._run('ACCOUNT_TAKEOVER')
        self.assertIn(result['risk_level'], ['HIGH', 'CRITICAL'])
        self.assertGreater(result['risk_score'], 60)

    def test_volume_spike_flagged(self):
        result = self._run('VOLUME_SPIKE')
        self.assertGreater(result['risk_score'], 60)

    def test_fraud_ring_creates_multiple_accounts(self):
        result = self._run('FRAUD_RING')
        self.assertEqual(len(result.get('account_ids', [])), 3)

    def test_seasonal_legit_spike_not_blocked(self):
        result = self._run('SEASONAL_LEGIT_SPIKE')
        self.assertNotEqual(result['action'], 'BLOCK')
        self.assertIn(result['risk_level'], ['LOW', 'MEDIUM'])

    def test_unknown_scenario_raises(self):
        from intelligence.services.simulator_service import run_scenario
        with self.assertRaises(ValueError):
            run_scenario('INVALID_SCENARIO')

    def test_simulation_run_record_created(self):
        from intelligence.models import SimulationRun
        before = SimulationRun.objects.count()
        self._run('PAYMENT_FRAUD')
        self.assertEqual(SimulationRun.objects.count(), before + 1)


class TestSimulatorAPI(APITestCase):

    def test_run_via_api(self):
        resp = self.client.post('/api/v1/simulator/run/', {'scenario': 'NORMAL'}, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertIn('risk_score', resp.data)
        self.assertIn('action', resp.data)

    def test_invalid_scenario_returns_400(self):
        resp = self.client.post('/api/v1/simulator/run/', {'scenario': 'MADE_UP'}, format='json')
        self.assertEqual(resp.status_code, 400)
