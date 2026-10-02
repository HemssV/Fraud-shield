"""
Analytics Service — Backend Person B

Provides dashboard summary metrics consumed by the frontend.
Uses PostgreSQL views (v_dashboard_daily, v_review_queue, v_latest_decision)
where possible; falls back to Django ORM aggregations otherwise.
"""
from __future__ import annotations
import logging
from datetime import timedelta
from typing import Any

from django.db import connection
from django.db.models import Count, Q, Sum
from django.utils import timezone

from intelligence.models import (
    AuditLog, Decision, DecisionAction,
    FraudCase, CaseStatus,
    RiskAssessment, RiskLevel,
)

log = logging.getLogger(__name__)


def _try_view(sql: str) -> list[dict] | None:
    """Execute raw SQL against a view. Returns None if the view doesn't exist."""
    try:
        with connection.cursor() as cur:
            cur.execute(sql)
            cols = [c[0] for c in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception as exc:
        log.debug("View query failed (%s), falling back to ORM.", exc)
        return None


# ─── Summary ──────────────────────────────────────────────────────────────────

def get_summary() -> dict[str, Any]:
    """
    High-level KPI summary for the dashboard header.
    Uses ORM aggregations that work with both SQLite and PostgreSQL.
    """
    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total = RiskAssessment.objects.count()
    high_risk = RiskAssessment.objects.filter(risk_level__in=['HIGH', 'CRITICAL']).count()

    blocked = Decision.objects.filter(action=DecisionAction.BLOCK).count()
    under_review = Decision.objects.filter(action__in=[DecisionAction.REVIEW, DecisionAction.VERIFY]).count()

    open_cases = FraudCase.objects.filter(status__in=[CaseStatus.OPEN, CaseStatus.IN_REVIEW]).count()

    # Estimated loss prevented: sum of shipping_cost for BLOCKED shipments
    loss_prevented = (
        Decision.objects.filter(action=DecisionAction.BLOCK)
        .select_related('shipment')
        .aggregate(total=Sum('shipment__shipping_cost'))['total'] or 0
    )

    # Today stats
    today_screened = RiskAssessment.objects.filter(assessed_at__gte=today_start).count()
    today_flagged = RiskAssessment.objects.filter(
        assessed_at__gte=today_start, risk_level__in=['HIGH', 'CRITICAL']
    ).count()

    return {
        'total_screened': total,
        'high_risk': high_risk,
        'blocked': blocked,
        'under_review': under_review,
        'open_cases': open_cases,
        'estimated_loss_prevented': float(loss_prevented),
        'today': {
            'screened': today_screened,
            'flagged': today_flagged,
        },
    }


# ─── Daily trend ──────────────────────────────────────────────────────────────

def get_daily_trend(days: int = 7) -> list[dict[str, Any]]:
    """
    Daily screened / flagged / blocked for the last N days.
    Tries the v_dashboard_daily view first; falls back to ORM.
    """
    view_data = _try_view(
        f"SELECT * FROM v_dashboard_daily ORDER BY day DESC LIMIT {days}"
    )
    if view_data:
        for row in view_data:
            if hasattr(row.get('day'), 'isoformat'):
                row['day'] = row['day'].isoformat()
            if 'loss_prevented' in row and row['loss_prevented'] is not None:
                row['loss_prevented'] = float(row['loss_prevented'])
        return view_data

    # ORM fallback
    cutoff = timezone.now() - timedelta(days=days)
    from django.db.models.functions import TruncDay
    rows = (
        RiskAssessment.objects.filter(assessed_at__gte=cutoff)
        .annotate(day=TruncDay('assessed_at'))
        .values('day')
        .annotate(
            screened=Count('assessment_id'),
            flagged=Count('assessment_id', filter=Q(risk_level__in=['HIGH', 'CRITICAL'])),
        )
        .order_by('-day')
    )
    return [
        {'day': r['day'].isoformat(), 'screened': r['screened'], 'flagged': r['flagged']}
        for r in rows
    ]


# ─── Review queue ─────────────────────────────────────────────────────────────

def get_review_queue() -> list[dict[str, Any]]:
    """
    Open/in-review cases sorted by priority and SLA.
    Tries v_review_queue view first; falls back to ORM.
    """
    view_data = _try_view(
        "SELECT * FROM v_review_queue ORDER BY "
        "CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, "
        "sla_due_at ASC NULLS LAST LIMIT 100"
    )
    if view_data:
        for row in view_data:
            for k, v in row.items():
                if hasattr(v, 'isoformat'):
                    row[k] = v.isoformat()
                if isinstance(v, float):
                    row[k] = float(v)
        return view_data

    # ORM fallback
    cases = (
        FraudCase.objects.exclude(status=CaseStatus.CLOSED)
        .select_related('shipment', 'account', 'assessment', 'assigned_to')
        .order_by('priority', 'sla_due_at')[:100]
    )
    return [
        {
            'case_id': str(c.case_id),
            'booking_ref': c.shipment.booking_ref,
            'account_number': c.account.account_number,
            'risk_score': float(c.assessment.risk_score),
            'risk_level': c.assessment.risk_level,
            'status': c.status,
            'priority': c.priority,
            'opened_at': c.opened_at.isoformat(),
            'sla_due_at': c.sla_due_at.isoformat() if c.sla_due_at else None,
            'assigned_to': c.assigned_to.full_name if c.assigned_to else None,
        }
        for c in cases
    ]


# ─── Recent alerts ────────────────────────────────────────────────────────────

def get_recent_alerts(limit: int = 10) -> list[dict[str, Any]]:
    """Return the most recently flagged high/critical risk assessments."""
    alerts = (
        RiskAssessment.objects.filter(risk_level__in=['HIGH', 'CRITICAL'])
        .select_related('shipment', 'shipment__account')
        .order_by('-assessed_at')[:limit]
    )
    return [
        {
            'assessment_id': str(a.assessment_id),
            'shipment_id': str(a.shipment_id),
            'booking_ref': a.shipment.booking_ref,
            'account_number': a.shipment.account.account_number,
            'risk_score': float(a.risk_score),
            'risk_level': a.risk_level,
            'fraud_probability': float(a.fraud_probability or 0),
            'assessed_at': a.assessed_at.isoformat(),
        }
        for a in alerts
    ]


# ─── Fraud type breakdown ─────────────────────────────────────────────────────

def get_fraud_type_distribution() -> list[dict[str, Any]]:
    """Distribution of confirmed fraud types from analyst feedback."""
    from intelligence.models import AnalystFeedback
    from django.db.models import Count as _Count

    rows = (
        AnalystFeedback.objects.filter(fraud_type__isnull=False)
        .values('fraud_type')
        .annotate(count=_Count('feedback_id'))
        .order_by('-count')
    )
    return [{'fraud_type': r['fraud_type'], 'count': r['count']} for r in rows]
