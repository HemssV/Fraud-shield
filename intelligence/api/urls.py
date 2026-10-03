"""
URL configuration for Backend Person B — /api/v1/...
"""
from django.urls import path
from intelligence.api import views

urlpatterns = [
    # ── ML Integration ──────────────────────────────────────────────────────
    path('ml/predict/', views.MLPredictView.as_view(), name='ml-predict'),

    # ── GenAI Fraud Copilot ─────────────────────────────────────────────────
    path('fraud/explain/', views.FraudExplainView.as_view(), name='fraud-explain'),

    # ── Fraud Graph ─────────────────────────────────────────────────────────
    path('fraud-graph/account/<str:account_id>/', views.FraudGraphAccountView.as_view(), name='fraud-graph-account'),
    path('fraud-graph/detect-rings/', views.FraudRingDetectView.as_view(), name='fraud-graph-detect-rings'),

    # ── Cases / Investigation ───────────────────────────────────────────────
    path('cases/', views.CaseListView.as_view(), name='case-list'),
    path('cases/<str:case_id>/', views.CaseDetailView.as_view(), name='case-detail'),
    path('cases/<str:case_id>/assign/', views.CaseAssignView.as_view(), name='case-assign'),
    path('cases/<str:case_id>/decision/', views.CaseDecisionView.as_view(), name='case-decision'),
    path('cases/<str:case_id>/close/', views.CaseCloseView.as_view(), name='case-close'),

    # ── Audit ────────────────────────────────────────────────────────────────
    path('audit/shipment/<str:shipment_id>/', views.AuditShipmentView.as_view(), name='audit-shipment'),

    # ── Dashboard Analytics ──────────────────────────────────────────────────
    path('dashboard/summary/', views.DashboardSummaryView.as_view(), name='dashboard-summary'),
    path('dashboard/daily/', views.DashboardDailyView.as_view(), name='dashboard-daily'),
    path('dashboard/review-queue/', views.DashboardReviewQueueView.as_view(), name='dashboard-review-queue'),
    path('dashboard/recent-alerts/', views.DashboardRecentAlertsView.as_view(), name='dashboard-recent-alerts'),
    path('dashboard/fraud-types/', views.DashboardFraudTypesView.as_view(), name='dashboard-fraud-types'),
    path('dashboard/risk-distribution/', views.DashboardRiskDistributionView.as_view(), name='dashboard-risk-distribution'),

    # ── Scenario Simulator ───────────────────────────────────────────────────
    path('simulator/run/', views.SimulatorRunView.as_view(), name='simulator-run'),
]
