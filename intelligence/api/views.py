"""
API Views — Backend Person B — FraudShield Intelligence & Operations.

All views follow the pattern:
  1. Validate input via serializer.
  2. Delegate to the relevant service.
  3. Return structured JSON.
  4. On error, the exception handler formats the error response.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from intelligence.api.serializers import (
    AnalystDecisionSerializer,
    AssignCaseSerializer,
    CaseListQuerySerializer,
    ExplainSerializer,
    MLPredictSerializer,
    SimulatorRunSerializer,
)
from intelligence.services.analytics_service import (
    get_daily_trend,
    get_fraud_type_distribution,
    get_recent_alerts,
    get_review_queue,
    get_risk_distribution,
    get_summary,
)
from intelligence.services.audit_service import get_shipment_timeline
from intelligence.services.case_service import (
    assign_case,
    close_case,
    get_case_detail,
    list_cases,
    record_analyst_decision,
)
from intelligence.services.fraud_graph_service import (
    detect_fraud_rings,
    get_account_graph,
)
from intelligence.services.genai_service import generate_explanation
from intelligence.services.ml_service import get_ml_service
from intelligence.services.simulator_service import run_scenario


# ─── ML Integration ───────────────────────────────────────────────────────────

class MLPredictView(APIView):
    """
    POST /api/v1/ml/predict/

    Accepts engineered features from Backend Person A and returns
    fraud probability + top reasons.
    """

    def post(self, request):
        s = MLPredictSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        result = get_ml_service().predict(
            shipment_id=s.validated_data['shipment_id'],
            features=s.validated_data['features'],
        )
        return Response(result.to_dict(), status=status.HTTP_200_OK)


# ─── GenAI Fraud Copilot ──────────────────────────────────────────────────────

class FraudExplainView(APIView):
    """
    POST /api/v1/fraud/explain/

    Generate or return a cached GenAI explanation for a risk assessment.
    The LLM only explains — it does NOT modify the risk score or decision.
    """

    def post(self, request):
        s = ExplainSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        explanation = generate_explanation(
            assessment_id=str(s.validated_data['assessment_id'])
        )
        return Response(
            {
                'explanation_id': str(explanation.explanation_id),
                'assessment_id': str(explanation.assessment_id),
                'llm_model': explanation.llm_model,
                'summary': explanation.summary_text,
                'recommended_actions': explanation.recommended_actions,
                'grounded_reason_ids': explanation.grounded_reason_ids,
                'generated_at': explanation.generated_at.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


# ─── Fraud Graph ──────────────────────────────────────────────────────────────

class FraudGraphAccountView(APIView):
    """
    GET /api/v1/fraud-graph/account/<account_id>/

    Return the full fraud relationship graph for an account.
    """

    def get(self, request, account_id):
        graph = get_account_graph(account_id)
        return Response(graph)


class FraudRingDetectView(APIView):
    """
    POST /api/v1/fraud-graph/detect-rings/

    Trigger fraud ring detection across all known entity links.
    Returns list of newly detected rings.
    """

    def post(self, request):
        min_shared = int(request.data.get('min_shared_entities', 2))
        rings = detect_fraud_rings(min_shared_entities=min_shared)
        return Response(
            {
                'rings_detected': len(rings),
                'ring_ids': [str(r.ring_id) for r in rings],
            }
        )


# ─── Cases / Investigation ────────────────────────────────────────────────────

class CaseListView(APIView):
    """
    GET /api/v1/cases/

    List fraud cases with optional status filter.
    """

    def get(self, request):
        s = CaseListQuerySerializer(data=request.query_params)
        s.is_valid(raise_exception=True)
        result = list_cases(
            status=s.validated_data.get('status'),
            page=s.validated_data['page'],
            page_size=s.validated_data['page_size'],
        )
        return Response(result)


class CaseDetailView(APIView):
    """
    GET /api/v1/cases/<case_id>/

    Return the full investigation bundle for a single case.
    """

    def get(self, request, case_id):
        detail = get_case_detail(case_id)
        return Response(detail)


class CaseAssignView(APIView):
    """
    POST /api/v1/cases/<case_id>/assign/

    Assign (or re-assign) a case to an analyst.
    """

    def post(self, request, case_id):
        s = AssignCaseSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        case = assign_case(
            case_id=case_id,
            staff_user_id=str(s.validated_data['staff_user_id']),
        )
        return Response(
            {
                'case_id': str(case.case_id),
                'status': case.status,
                'assigned_to': str(case.assigned_to_id),
                'updated_at': case.updated_at.isoformat(),
            }
        )


class CaseDecisionView(APIView):
    """
    POST /api/v1/cases/<case_id>/decision/

    Record an analyst decision.
    Possible verdicts: CONFIRMED_FRAUD | FALSE_POSITIVE | INCONCLUSIVE
    Possible actions:  ALLOW | ALLOW_MONITOR | VERIFY | REVIEW | BLOCK
    """

    def post(self, request, case_id):
        s = AnalystDecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        # Determine actor from request (use a system staff user for demo if not authenticated)
        staff_user_id = request.data.get('staff_user_id') or _get_demo_staff_id()

        case, decision, feedback = record_analyst_decision(
            case_id=case_id,
            staff_user_id=str(staff_user_id),
            verdict=s.validated_data['verdict'],
            action=s.validated_data['action'],
            reason=s.validated_data['reason'],
            notes=s.validated_data['notes'],
            fraud_type=s.validated_data.get('fraud_type'),
        )
        return Response(
            {
                'case_id': str(case.case_id),
                'status': case.status,
                'verdict': case.verdict,
                'decision_id': str(decision.decision_id),
                'action': decision.action,
                'feedback_id': str(feedback.feedback_id),
            },
            status=status.HTTP_201_CREATED,
        )


class CaseCloseView(APIView):
    """
    POST /api/v1/cases/<case_id>/close/
    """

    def post(self, request, case_id):
        staff_user_id = request.data.get('staff_user_id') or _get_demo_staff_id()
        notes = request.data.get('notes', '')
        case = close_case(case_id=case_id, staff_user_id=str(staff_user_id), notes=notes)
        return Response({'case_id': str(case.case_id), 'status': case.status})


# ─── Audit ────────────────────────────────────────────────────────────────────

class AuditShipmentView(APIView):
    """
    GET /api/v1/audit/shipment/<shipment_id>/

    Return the chronological audit trail for a shipment.
    """

    def get(self, request, shipment_id):
        events = get_shipment_timeline(shipment_id)
        return Response(
            {
                'shipment_id': shipment_id,
                'event_count': len(events),
                'events': events,
            }
        )


# ─── Dashboard Analytics ──────────────────────────────────────────────────────

class DashboardSummaryView(APIView):
    """GET /api/v1/dashboard/summary/"""

    def get(self, request):
        return Response(get_summary())


class DashboardDailyView(APIView):
    """GET /api/v1/dashboard/daily/?days=7"""

    def get(self, request):
        days = int(request.query_params.get('days', 7))
        days = max(1, min(days, 90))  # clamp 1-90
        return Response(get_daily_trend(days=days))


class DashboardReviewQueueView(APIView):
    """GET /api/v1/dashboard/review-queue/"""

    def get(self, request):
        return Response(get_review_queue())


class DashboardRecentAlertsView(APIView):
    """GET /api/v1/dashboard/recent-alerts/"""

    def get(self, request):
        limit = int(request.query_params.get('limit', 10))
        return Response(get_recent_alerts(limit=limit))


class DashboardFraudTypesView(APIView):
    """GET /api/v1/dashboard/fraud-types/"""

    def get(self, request):
        return Response(get_fraud_type_distribution())


class DashboardRiskDistributionView(APIView):
    """GET /api/v1/dashboard/risk-distribution/?day=YYYY-MM-DD"""

    def get(self, request):
        day = request.query_params.get('day')
        return Response(get_risk_distribution(day=day))


# ─── Scenario Simulator ───────────────────────────────────────────────────────

class SimulatorRunView(APIView):
    """
    POST /api/v1/simulator/run/

    Run a named fraud scenario through the actual pipeline.
    """

    def post(self, request):
        s = SimulatorRunSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        result = run_scenario(s.validated_data['scenario'])
        return Response(result, status=status.HTTP_201_CREATED)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_demo_staff_id():
    """
    Return (or auto-create) a demo analyst for hackathon use.
    In production, extract from the authenticated JWT token.
    """
    from intelligence.models import StaffUser
    analyst, _ = StaffUser.objects.get_or_create(
        email='demo-analyst@fraudshield.dev',
        defaults={
            'full_name': 'Demo Analyst',
            'role': 'ANALYST',
        },
    )
    return str(analyst.staff_id)
