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


class FraudGraphClustersView(APIView):
    """
    GET /api/v1/fraud-graph/clusters/

    Return all fraud-ring clusters from the database.
    Each cluster includes: ring metadata, member accounts, shared entities,
    the full entity-link graph, and risk signals.
    Used by the frontend Fraud Graph Intelligence page instead of hardcoded data.
    """

    def get(self, request):
        from intelligence.models import (
            FraudRing, FraudRingMember, Account, FraudSignal, EntityLink,
        )
        from collections import defaultdict
        from django.db.models import Q

        # Deduplicate rings — group by sorted account-pair to avoid duplicates
        all_rings = FraudRing.objects.prefetch_related('members').order_by('-ring_score', '-detected_at')
        seen_account_sets = set()
        unique_clusters = []

        for ring in all_rings:
            member_ids = sorted([str(m.account_id) for m in ring.members.all()])
            key = tuple(member_ids)
            if key in seen_account_sets:
                continue
            seen_account_sets.add(key)

            # Build the graph for this cluster by aggregating entity links across all member accounts
            all_entity_ids = list(member_ids)
            links = EntityLink.objects.filter(
                Q(src_id__in=all_entity_ids) | Q(dst_id__in=all_entity_ids)
            )

            nodes_map = {}
            edges_list = []

            # Add member account nodes first
            for acct_id in member_ids:
                acct = Account.objects.filter(account_id=acct_id).first()
                node_key = f"ACCOUNT:{acct_id}"
                acct_number = acct.account_number if acct else acct_id[:8]
                signals = FraudSignal.objects.filter(
                    entity_type='ACCOUNT', entity_id=acct_id, is_active=True
                )
                max_severity = max([s.severity for s in signals], default=0)
                nodes_map[node_key] = {
                    'id': node_key,
                    'entity_type': 'ACCOUNT',
                    'entity_id': acct_id,
                    'label': f'Account {acct_number}',
                    'risk_score': min(max_severity * 10, 100),
                    'is_suspicious': max_severity >= 5,
                    'signal_count': signals.count(),
                }

            for link in links:
                src_key = f"{link.src_type}:{link.src_id}"
                dst_key = f"{link.dst_type}:{link.dst_id}"

                if src_key not in nodes_map:
                    nodes_map[src_key] = {
                        'id': src_key,
                        'entity_type': link.src_type,
                        'entity_id': str(link.src_id),
                        'label': f'{link.src_type} {str(link.src_id)[:8]}',
                        'risk_score': 0,
                        'is_suspicious': False,
                        'signal_count': 0,
                    }
                if dst_key not in nodes_map:
                    nodes_map[dst_key] = {
                        'id': dst_key,
                        'entity_type': link.dst_type,
                        'entity_id': str(link.dst_id),
                        'label': f'{link.dst_type} {str(link.dst_id)[:8]}',
                        'risk_score': 0,
                        'is_suspicious': False,
                        'signal_count': 0,
                    }

                edges_list.append({
                    'source': src_key,
                    'target': dst_key,
                    'link_type': link.link_type,
                    'weight': link.weight,
                })

            # Mark shared-entity nodes as suspicious
            shared_ents = ring.shared_entities or {}
            for dev_id in shared_ents.get('devices', []):
                dev_key = f"DEVICE:{dev_id}"
                if dev_key in nodes_map:
                    nodes_map[dev_key]['is_suspicious'] = True
                    nodes_map[dev_key]['risk_score'] = max(nodes_map[dev_key]['risk_score'], 85)
            for pay_id in shared_ents.get('payments', []):
                pay_key = f"PAYMENT:{pay_id}"
                if pay_key in nodes_map:
                    nodes_map[pay_key]['is_suspicious'] = True
                    nodes_map[pay_key]['risk_score'] = max(nodes_map[pay_key]['risk_score'], 80)

            # Determine cluster risk level
            score = float(ring.ring_score)
            risk_level = 'CRITICAL' if score >= 80 else 'HIGH' if score >= 60 else 'MEDIUM' if score >= 40 else 'LOW'

            unique_clusters.append({
                'ring_id': str(ring.ring_id),
                'ring_score': score,
                'risk_level': risk_level,
                'shared_entities': shared_ents,
                'detected_at': ring.detected_at.isoformat() if ring.detected_at else None,
                'member_account_ids': member_ids,
                'node_count': len(nodes_map),
                'edge_count': len(edges_list),
                'nodes': list(nodes_map.values()),
                'edges': edges_list,
            })

            if len(unique_clusters) >= 20:
                break

        # Also include standalone high-risk accounts (those with signals but no ring membership)
        ring_account_ids = set()
        for c in unique_clusters:
            ring_account_ids.update(c['member_account_ids'])

        standalone_signals = FraudSignal.objects.filter(
            entity_type='ACCOUNT', is_active=True
        ).exclude(entity_id__in=ring_account_ids).values_list('entity_id', flat=True).distinct()[:5]

        for acct_id in standalone_signals:
            acct_id_str = str(acct_id)
            graph = get_account_graph(acct_id_str)
            if graph.get('node_count', 0) > 1:
                unique_clusters.append({
                    'ring_id': f'standalone-{acct_id_str[:8]}',
                    'ring_score': 50.0,
                    'risk_level': 'HIGH',
                    'shared_entities': {},
                    'detected_at': None,
                    'member_account_ids': [acct_id_str],
                    'node_count': graph['node_count'],
                    'edge_count': graph['edge_count'],
                    'nodes': [
                        {
                            'id': n['id'],
                            'entity_type': n['entity_type'],
                            'entity_id': n['entity_id'],
                            'label': f"{n['entity_type']} {n['entity_id'][:8]}",
                            'risk_score': 60 if n['entity_type'] != 'ACCOUNT' else 70,
                            'is_suspicious': True,
                            'signal_count': 0,
                        }
                        for n in graph['nodes']
                    ],
                    'edges': graph['edges'],
                })

        return Response({
            'cluster_count': len(unique_clusters),
            'clusters': unique_clusters,
        })


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
        include_graph = request.query_params.get('include_graph', 'false').lower() in ('1', 'true', 'yes')
        detail = get_case_detail(case_id, include_graph=include_graph)
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


class DashboardAllView(APIView):
    """
    GET /api/v1/dashboard/all/

    Combined endpoint that returns summary, daily trends, recent alerts,
    and risk distribution in a single response. This eliminates 4 separate
    HTTP round-trips from the frontend, reducing dashboard load time from
    ~5s (4 sequential cloud DB connections) to ~1 request.
    """

    def get(self, request):
        import concurrent.futures

        days = int(request.query_params.get('days', 7))
        days = max(1, min(days, 90))
        limit = int(request.query_params.get('limit', 10))

        # Execute all 4 queries in parallel threads to overlap I/O wait
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            f_summary = pool.submit(get_summary)
            f_daily = pool.submit(get_daily_trend, days)
            f_alerts = pool.submit(get_recent_alerts, limit)
            f_dist = pool.submit(get_risk_distribution)

        return Response({
            'summary': f_summary.result(),
            'daily': f_daily.result(),
            'alerts': f_alerts.result(),
            'risk_distribution': f_dist.result(),
        })


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
