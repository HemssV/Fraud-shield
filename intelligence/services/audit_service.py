"""
Audit Service — Backend Person B

Creates and queries audit log entries.
Uses a hash-chain (SHA-256) matching the PostgreSQL trigger design.
Every important Person B action goes through this service.
"""
from __future__ import annotations
import hashlib
import json
import logging
import uuid
from typing import Any

from django.db import transaction

from intelligence.models import AuditLog

log = logging.getLogger(__name__)

# ─── Audit action constants ───────────────────────────────────────────────────
SCREENED                   = 'SCREENED'
DECISION_MADE              = 'DECISION_MADE'
DECISION_OVERRIDE          = 'OVERRIDE'
CASE_ASSIGNED              = 'CASE_ASSIGNED'
CASE_CLOSED                = 'CASE_CLOSED'
DATA_VIEWED                = 'DATA_VIEWED'
GENAI_EXPLANATION_CREATED  = 'GENAI_EXPLANATION_CREATED'
ANALYST_FEEDBACK           = 'ANALYST_FEEDBACK'
ML_PREDICTION              = 'ML_PREDICTION'
GRAPH_QUERIED              = 'GRAPH_QUERIED'
SIMULATION_RUN             = 'SIMULATION_RUN'
FRAUD_RING_DETECTED        = 'FRAUD_RING_DETECTED'


def _compute_hash(prev_hash: str | None, entry: AuditLog) -> str:
    """
    Replicates the PostgreSQL audit_log_chain() trigger logic in Python.
    Used when the trigger is not present (SQLite dev mode).
    """
    raw = (
        (prev_hash or '')
        + str(entry.occurred_at or '')
        + (entry.actor_type or '')
        + (str(entry.actor_id) if entry.actor_id else '')
        + (entry.action or '')
        + (entry.entity_type or '')
        + (str(entry.entity_id) if entry.entity_id else '')
        + (json.dumps(entry.after_state, sort_keys=True) if entry.after_state else '')
    )
    return hashlib.sha256(raw.encode()).hexdigest()


@transaction.atomic
def log_event(
    *,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | str | None = None,
    shipment_id: uuid.UUID | str | None = None,
    actor_type: str = 'SYSTEM',
    actor_id: uuid.UUID | str | None = None,
    before_state: dict | None = None,
    after_state: dict | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """
    Persist one audit event.
    In production the hash chain is maintained by the PostgreSQL trigger.
    In SQLite dev mode we maintain it in Python (best-effort).
    """
    prev_entry = AuditLog.objects.order_by('-audit_id').first()
    prev_hash = prev_entry.row_hash if prev_entry else None

    entry = AuditLog(
        actor_type=actor_type,
        actor_id=uuid.UUID(str(actor_id)) if actor_id else None,
        action=action,
        entity_type=entity_type,
        entity_id=uuid.UUID(str(entity_id)) if entity_id else None,
        shipment_id=uuid.UUID(str(shipment_id)) if shipment_id else None,
        before_state=before_state,
        after_state=after_state,
        ip_address=ip_address,
        prev_hash=prev_hash,
        row_hash='',   # placeholder; filled below
    )

    # In production, the PostgreSQL trigger overwrites row_hash.
    # In SQLite dev mode we compute it ourselves.
    row_hash = _compute_hash(prev_hash, entry)
    entry.row_hash = row_hash
    entry.save()
    log.debug("Audit: %s %s:%s", action, entity_type, entity_id)
    return entry


def get_shipment_timeline(shipment_id: str) -> list[dict[str, Any]]:
    """Return chronological audit events for a shipment."""
    events = AuditLog.objects.filter(
        shipment_id=shipment_id
    ).order_by('audit_id')

    return [
        {
            'audit_id': e.audit_id,
            'action': e.action,
            'entity_type': e.entity_type,
            'entity_id': str(e.entity_id) if e.entity_id else None,
            'actor_type': e.actor_type,
            'actor_id': str(e.actor_id) if e.actor_id else None,
            'occurred_at': e.occurred_at.isoformat(),
            'after_state': e.after_state,
        }
        for e in events
    ]
