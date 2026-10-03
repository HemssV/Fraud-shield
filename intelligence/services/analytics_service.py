"""
Analytics Service — Backend Person B

Provides dashboard summary metrics consumed by the frontend.
Uses PostgreSQL views (v_dashboard_daily, v_review_queue, v_latest_decision)
where possible; falls back to Django ORM aggregations otherwise.
"""
from __future__ import annotations
import logging
import time
from datetime import timedelta
from typing import Any

from django.db import connection
from django.db.models import Count, Q, Sum
from django.utils import timezone

from intelligence.models import (
    AuditLog, Decision, DecisionAction,
    FraudCase, CaseStatus,
    RiskAssessment, RiskLevel, RiskReason, GenAIExplanation,
)

log = logging.getLogger(__name__)

# Lightweight in-memory cache to eliminate cloud database latency
# TTLs are intentionally long (60-120s) because dashboard analytics
# tolerate stale data — this avoids repeated 500ms+ cloud DB round-trips.
_CACHE: dict[str, tuple[Any, float]] = {}
_CACHE_WARMING = False  # flag to prevent concurrent warming

def get_cached_or_compute(key: str, ttl_seconds: float, compute_fn):
    now = time.time()
    if key in _CACHE:
        val, expiry = _CACHE[key]
        if now < expiry:
            return val
    result = compute_fn()
    _CACHE[key] = (result, now + ttl_seconds)
    return result

def invalidate_dashboard_cache():
    _CACHE.clear()


def warm_dashboard_cache():
    """
    Pre-populate the in-memory cache with all dashboard data.
    Call this once at server startup to ensure the first user request is fast.
    """
    global _CACHE_WARMING
    if _CACHE_WARMING:
        return
    _CACHE_WARMING = True
    try:
        log.info("[CACHE] Warming dashboard cache...")
        t0 = time.time()
        get_summary()
        get_daily_trend(7)
        get_recent_alerts(15)
        get_risk_distribution()
        elapsed = time.time() - t0
        log.info("[CACHE] Dashboard cache warmed in %.1fs", elapsed)
    except Exception as exc:
        log.warning("[CACHE] Cache warming failed: %s", exc)
    finally:
        _CACHE_WARMING = False



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
    return get_cached_or_compute('dashboard_summary', 120.0, _compute_summary)

def _compute_summary() -> dict[str, Any]:
    """
    High-level KPI summary for the dashboard header.
    Optimized with single consolidated SQL query to avoid high-latency sequential round trips.
    """
    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    try:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT 
                    (SELECT COUNT(*) FROM risk_assessments) AS total_screened,
                    (SELECT COUNT(*) FROM risk_assessments WHERE risk_level IN ('HIGH', 'CRITICAL')) AS high_risk,
                    (SELECT COUNT(*) FROM risk_assessments WHERE assessed_at >= %s) AS today_screened,
                    (SELECT COUNT(*) FROM risk_assessments WHERE assessed_at >= %s AND risk_level IN ('HIGH', 'CRITICAL')) AS today_flagged,
                    (SELECT COUNT(*) FROM risk_assessments WHERE assessed_at >= %s AND assessed_at < %s) AS yesterday_screened,
                    (SELECT COUNT(*) FROM decisions WHERE action = 'BLOCK') AS blocked,
                    (SELECT COUNT(*) FROM decisions WHERE action IN ('REVIEW', 'VERIFY')) AS under_review,
                    (SELECT COUNT(*) FROM fraud_cases WHERE status IN ('OPEN', 'IN_REVIEW')) AS open_cases,
                    (SELECT COALESCE(SUM(s.shipping_cost), 0) FROM decisions d JOIN shipments s ON d.shipment_id = s.shipment_id WHERE d.action = 'BLOCK') AS loss_prevented
            """, [today_start, today_start, yesterday_start, today_start])
            row = cur.fetchone()
            if row:
                total, high_risk, today_screened, today_flagged, yesterday_screened, blocked, under_review, open_cases, loss_prevented = row
                total = total or 0
                high_risk = high_risk or 0
                today_screened = today_screened or 0
                today_flagged = today_flagged or 0
                yesterday_screened = yesterday_screened or 0
                blocked = blocked or 0
                under_review = under_review or 0
                open_cases = open_cases or 0
                loss_prevented = float(loss_prevented or 0)

                if yesterday_screened > 0:
                    trend_pct = round(((today_screened - yesterday_screened) / yesterday_screened) * 100, 1)
                    trend_str = f"{'+' if trend_pct >= 0 else ''}{trend_pct}% today"
                elif today_screened > 0:
                    trend_str = f"+{today_screened} today"
                else:
                    trend_str = "+0% today"

                return {
                    'total_screened': total,
                    'shipments_screened': total,
                    'high_risk': high_risk,
                    'blocked': blocked,
                    'under_review': under_review,
                    'open_cases': open_cases,
                    'estimated_loss_prevented': loss_prevented,
                    'trend_str': trend_str,
                    'today': {
                        'screened': today_screened,
                        'flagged': today_flagged,
                        'trend_pct': trend_str,
                    },
                }
    except Exception as exc:
        log.warning("Consolidated summary query failed (%s), falling back to ORM.", exc)

    # ORM Fallback if raw query fails
    total = RiskAssessment.objects.count()
    high_risk = RiskAssessment.objects.filter(risk_level__in=['HIGH', 'CRITICAL']).count()

    blocked = Decision.objects.filter(action=DecisionAction.BLOCK).count()
    under_review = Decision.objects.filter(action__in=[DecisionAction.REVIEW, DecisionAction.VERIFY]).count()
    open_cases = FraudCase.objects.filter(status__in=[CaseStatus.OPEN, CaseStatus.IN_REVIEW]).count()

    loss_prevented = (
        Decision.objects.filter(action=DecisionAction.BLOCK)
        .select_related('shipment')
        .aggregate(total=Sum('shipment__shipping_cost'))['total'] or 0
    )

    today_screened = RiskAssessment.objects.filter(assessed_at__gte=today_start).count()
    today_flagged = RiskAssessment.objects.filter(
        assessed_at__gte=today_start, risk_level__in=['HIGH', 'CRITICAL']
    ).count()

    yesterday_screened = RiskAssessment.objects.filter(
        assessed_at__gte=yesterday_start, assessed_at__lt=today_start
    ).count()

    if yesterday_screened > 0:
        trend_pct = round(((today_screened - yesterday_screened) / yesterday_screened) * 100, 1)
        trend_str = f"{'+' if trend_pct >= 0 else ''}{trend_pct}% today"
    elif today_screened > 0:
        trend_str = f"+{today_screened} today"
    else:
        trend_str = "+0% today"

    return {
        'total_screened': total,
        'shipments_screened': total,
        'high_risk': high_risk,
        'blocked': blocked,
        'under_review': under_review,
        'open_cases': open_cases,
        'estimated_loss_prevented': float(loss_prevented),
        'trend_str': trend_str,
        'today': {
            'screened': today_screened,
            'flagged': today_flagged,
            'trend_pct': trend_str,
        },
    }


# ─── Daily trend ──────────────────────────────────────────────────────────────

def get_daily_trend(days: int = 7) -> list[dict[str, Any]]:
    return get_cached_or_compute(f'daily_trend_{days}', 120.0, lambda: _compute_daily_trend(days))

def _compute_daily_trend(days: int = 7) -> list[dict[str, Any]]:
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


# ─── Risk distribution ────────────────────────────────────────────────────────

def get_risk_distribution(day: str | None = None) -> list[dict[str, Any]]:
    return get_cached_or_compute(f'risk_dist_{day}', 120.0, lambda: _compute_risk_distribution(day))

def _compute_risk_distribution(day: str | None = None) -> list[dict[str, Any]]:
    """
    Return distribution of risk levels (Critical, High, Medium, Low).
    Optionally filtered by a specific date 'YYYY-MM-DD'.
    """
    qs = RiskAssessment.objects.all()
    if day:
        qs = qs.filter(assessed_at__date=day)

    counts = qs.values('risk_level').annotate(count=Count('assessment_id'))
    count_map = {c['risk_level']: c['count'] for c in counts}

    return [
        {'name': 'Critical', 'value': count_map.get('CRITICAL', 0), 'key': 'CRITICAL'},
        {'name': 'High',     'value': count_map.get('HIGH', 0),     'key': 'HIGH'},
        {'name': 'Medium',   'value': count_map.get('MEDIUM', 0),   'key': 'MEDIUM'},
        {'name': 'Low',      'value': count_map.get('LOW', 0),      'key': 'LOW'},
    ]


# ─── Recent alerts ────────────────────────────────────────────────────────────

def get_recent_alerts(limit: int = 15) -> list[dict[str, Any]]:
    return get_cached_or_compute(f'recent_alerts_{limit}', 90.0, lambda: _compute_recent_alerts(limit))

def _compute_recent_alerts(limit: int = 15) -> list[dict[str, Any]]:
    """
    Return recently flagged high/critical risk assessments,
    enriched with routing, telemetry, and reasons,
    sorted by remaining SLA time (most urgent / closest to breach first).
    """
    now = timezone.now()

    assessments = list(
        RiskAssessment.objects.filter(risk_level__in=['HIGH', 'CRITICAL'])
        .select_related('shipment', 'shipment__account', 'shipment__origin_address', 'shipment__dest_address')
        .prefetch_related('reasons')
        .order_by('-assessed_at')[:limit]
    )

    if not assessments:
        return []

    shipment_ids = [a.shipment_id for a in assessments]
    cases_by_shipment = {
        c.shipment_id: c
        for c in FraudCase.objects.filter(shipment_id__in=shipment_ids)
    }
    decisions_by_shipment = {
        d.shipment_id: d
        for d in Decision.objects.filter(shipment_id__in=shipment_ids).order_by('decided_at')
    }

    results = []
    for a in assessments:
        s = a.shipment
        case = cases_by_shipment.get(a.shipment_id)
        decision = decisions_by_shipment.get(a.shipment_id)

        # Determine priority and SLA
        if case and case.sla_due_at:
            sla_due_at = case.sla_due_at
            priority = case.priority
            case_id = str(case.case_id)
        else:
            priority = 'URGENT' if a.risk_level == 'CRITICAL' else 'HIGH'
            hours = 4 if priority == 'URGENT' else 8
            sla_due_at = a.assessed_at + timedelta(hours=hours)
            case_id = str(case.case_id) if case else None

        remaining_sec = (sla_due_at - now).total_seconds()

        # Format human-readable SLA
        if remaining_sec < 0:
            overdue_mins = int(abs(remaining_sec) // 60)
            if overdue_mins < 60:
                sla_formatted = f"Overdue by {overdue_mins}m"
            else:
                sla_formatted = f"Overdue by {overdue_mins // 60}h {overdue_mins % 60}m"
        else:
            h = int(remaining_sec // 3600)
            m = int((remaining_sec % 3600) // 60)
            sla_formatted = f"{h}h {m}m left"

        # Format relative time
        diff_sec = (now - a.assessed_at).total_seconds()
        if diff_sec < 60:
            time_str = "just now"
        elif diff_sec < 3600:
            time_str = f"{int(diff_sec // 60)} min ago"
        elif diff_sec < 86400:
            time_str = f"{int(diff_sec // 3600)} hr ago"
        else:
            time_str = f"{int(diff_sec // 86400)}d ago"

        # Action taken
        action = decision.action if decision else ('BLOCK' if a.risk_level == 'CRITICAL' else 'HOLD')

        # Top reasons — sliced in-memory from prefetched cache to avoid N+1 queries
        cached_reasons = sorted(a.reasons.all(), key=lambda r: r.rank or 0)[:3]
        reasons_data = [
            {
                'reason_code': r.reason_code,
                'category': r.category,
                'points': r.points,
                'description': r.description,
                'observed_value': str(r.observed_value) if r.observed_value else '',
            }
            for r in cached_reasons
        ]

        origin_city = s.origin_address.city if s and s.origin_address else 'Mumbai'
        dest_city = s.dest_address.city if s and s.dest_address else 'Surat Hub'
        dest_high_risk = s.dest_address.is_high_risk if s and s.dest_address else False

        results.append({
            'assessment_id': str(a.assessment_id),
            'shipment_id': s.booking_ref if s else str(a.shipment_id),
            'db_shipment_id': str(a.shipment_id),
            'case_id': case_id,
            'account_number': s.account.account_number if s and s.account else 'S1001-CORP',
            'risk_score': int(round(float(a.risk_score))),
            'risk_level': a.risk_level,
            'fraud_probability': float(a.fraud_probability or 0),
            'rule_score': int(round(float(a.rule_score or 0))),
            'ml_score': int(round(float(a.ml_score or 0))),
            'decision': action,
            'priority': priority,
            'sla_due_at': sla_due_at.isoformat(),
            'sla_remaining_seconds': remaining_sec,
            'sla_formatted': sla_formatted,
            'time': time_str,
            'assessed_at': a.assessed_at.isoformat(),
            'origin': origin_city,
            'destination': f"{dest_city} (Flagged High Risk)" if dest_high_risk else dest_city,
            'weight_kg': float(s.weight_kg) if s and s.weight_kg else 25.0,
            'service': s.service if s and s.service else 'EXPRESS AIR',
            'reasons': reasons_data,
        })

    # SORT BY SLA REMAINING TIME ASCENDING (least time remaining / closest to breach first)
    results.sort(key=lambda x: x['sla_remaining_seconds'])
    return results[:limit]


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
