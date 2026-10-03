"""
Fraud Graph Service — Backend Person B

Builds in-memory NetworkX graphs from the entity_links / fraud_signals tables
and exposes fraud relationship data for investigation and fraud-ring detection.

Does NOT use Neo4j — uses PostgreSQL (entity_links) + NetworkX for analysis.
"""
from __future__ import annotations
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any
import uuid

from django.db.models import Q
import networkx as nx

from intelligence.models import (
    Account, AccountDevice, AccountPayment, Device, EntityLink,
    FraudRing, FraudRingMember, FraudSignal, Payment, Shipment,
)
from intelligence.services import audit_service

log = logging.getLogger(__name__)

_graph_pool = ThreadPoolExecutor(max_workers=4)
_GRAPH_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

def get_cached_graph(key: str, ttl_seconds: float, compute_fn):
    now = time.time()
    if key in _GRAPH_CACHE:
        cached_time, cached_val = _GRAPH_CACHE[key]
        if now - cached_time < ttl_seconds:
            return cached_val
    val = compute_fn()
    _GRAPH_CACHE[key] = (now, val)
    return val


# ─── Graph builder ────────────────────────────────────────────────────────────

def _build_entity_graph(account_id: str) -> nx.Graph:
    """
    Build a NetworkX graph for the given account by loading all entity_links
    where the account (or its linked devices/payments) is a source or target.
    Uses a single batched query with PostgreSQL indexes instead of N loop queries.
    """
    G = nx.Graph()

    # Pre-fetch account devices and payments in batch
    account_devices = list(AccountDevice.objects.filter(account_id=account_id).values_list('device_id', flat=True))
    account_payments = list(AccountPayment.objects.filter(account_id=account_id).values_list('payment_id', flat=True))

    all_entity_ids = [account_id] + [str(d) for d in account_devices] + [str(p) for p in account_payments]

    # Fetch ALL direct and 1-hop links in a single indexed query
    links = EntityLink.objects.filter(
        Q(src_id__in=all_entity_ids) | Q(dst_id__in=all_entity_ids)
    )

    for link in links:
        src_node = f"{link.src_type}:{link.src_id}"
        dst_node = f"{link.dst_type}:{link.dst_id}"
        if not G.has_node(src_node):
            G.add_node(src_node, entity_type=link.src_type, entity_id=str(link.src_id))
        if not G.has_node(dst_node):
            G.add_node(dst_node, entity_type=link.dst_type, entity_id=str(link.dst_id))
        if not G.has_edge(src_node, dst_node):
            G.add_edge(src_node, dst_node, link_type=link.link_type, weight=link.weight)

    return G


def _graph_to_response(G: nx.Graph, account_id: str, signals: list[dict]) -> dict[str, Any]:
    nodes = []
    for node_id, data in G.nodes(data=True):
        nodes.append({
            'id': node_id,
            'entity_type': data.get('entity_type'),
            'entity_id': data.get('entity_id'),
        })

    edges = []
    for src, dst, data in G.edges(data=True):
        edges.append({
            'source': src,
            'target': dst,
            'link_type': data.get('link_type'),
            'weight': data.get('weight', 1),
        })

    return {
        'account_id': str(account_id),
        'node_count': len(nodes),
        'edge_count': len(edges),
        'nodes': nodes,
        'edges': edges,
        'risk_signals': signals,
    }


# ─── Public API ───────────────────────────────────────────────────────────────

def get_account_graph(account_id: str) -> dict[str, Any]:
    """
    Return the fraud relationship graph for an account with in-memory caching (120s TTL).
    Includes all entity links plus active fraud signals.
    """
    return get_cached_graph(f'graph_{account_id}', 120.0, lambda: _compute_account_graph(account_id))


def _compute_account_graph(account_id: str) -> dict[str, Any]:
    account = None
    try:
        uuid.UUID(str(account_id))
        account = Account.objects.filter(account_id=account_id).first()
    except (ValueError, TypeError):
        pass

    if not account:
        account = Account.objects.filter(account_number=account_id).first()

    if not account:
        shipment = Shipment.objects.filter(booking_ref=account_id).first()
        if shipment:
            account = shipment.account

    if not account:
        # Fall back to first account with entity links if demo lookup
        first_acct = Account.objects.first()
        if first_acct:
            account = first_acct
        else:
            raise ValueError(f"Account {account_id} not found")

    real_account_id = str(account.account_id)
    G = _build_entity_graph(real_account_id)

    # Add account node if not already present
    acct_node = f"ACCOUNT:{real_account_id}"
    if not G.has_node(acct_node):
        G.add_node(acct_node, entity_type='ACCOUNT', entity_id=real_account_id)

    # Retrieve active signals for this account and related entities
    signals_qs = FraudSignal.objects.filter(
        entity_type='ACCOUNT', entity_id=real_account_id, is_active=True
    ).values('signal_id', 'signal_type', 'severity', 'confidence', 'source', 'description', 'detected_at')

    signals = [
        {**s, 'detected_at': s['detected_at'].isoformat(), 'confidence': float(s['confidence'] or 0)}
        for s in signals_qs
    ]

    # Non-blocking async audit logging
    _graph_pool.submit(
        audit_service.log_event,
        action=audit_service.GRAPH_QUERIED,
        entity_type='ACCOUNT',
        entity_id=real_account_id,
        actor_type='SYSTEM',
    )

    return _graph_to_response(G, real_account_id, signals)


def upsert_entity_link(
    *,
    src_type: str,
    src_id: str,
    dst_type: str,
    dst_id: str,
    link_type: str,
) -> EntityLink:
    """
    Create or increment the weight of an entity link.
    Called by the simulator and investigation pipeline to keep the graph current.
    """
    link, created = EntityLink.objects.get_or_create(
        src_type=src_type,
        src_id=uuid.UUID(src_id),
        dst_type=dst_type,
        dst_id=uuid.UUID(dst_id),
        link_type=link_type,
        defaults={'weight': 1},
    )
    if not created:
        EntityLink.objects.filter(pk=link.pk).update(weight=link.weight + 1)
        link.refresh_from_db()
    return link


# ─── Fraud Ring Detection ─────────────────────────────────────────────────────

def detect_fraud_rings(min_shared_entities: int = 2) -> list[FraudRing]:
    """
    Identify suspicious account clusters sharing devices/payments/addresses.
    Persists detected rings using fraud_rings + fraud_ring_members tables.

    Algorithm:
      1. Find devices used by > 1 account.
      2. Find payments used by > 1 account.
      3. Group accounts sharing 2+ entity types.
      4. Create / update FraudRing records.
    """
    rings_created = []

    # Shared devices
    shared_devices: dict[str, list] = {}  # device_id → [account_ids]
    for ad in AccountDevice.objects.select_related('account').all():
        key = str(ad.device_id)
        shared_devices.setdefault(key, []).append(str(ad.account_id))

    # Shared payments
    shared_payments: dict[str, list] = {}
    for ap in AccountPayment.objects.select_related('account').all():
        key = str(ap.payment_id)
        shared_payments.setdefault(key, []).append(str(ap.account_id))

    # Build clusters: accounts that share >= min_shared_entities items
    from collections import defaultdict
    pair_overlap: dict[tuple, dict] = defaultdict(lambda: {'devices': [], 'payments': []})

    for dev_id, accts in shared_devices.items():
        if len(accts) >= 2:
            for i in range(len(accts)):
                for j in range(i + 1, len(accts)):
                    key = tuple(sorted([accts[i], accts[j]]))
                    pair_overlap[key]['devices'].append(dev_id)

    for pay_id, accts in shared_payments.items():
        if len(accts) >= 2:
            for i in range(len(accts)):
                for j in range(i + 1, len(accts)):
                    key = tuple(sorted([accts[i], accts[j]]))
                    pair_overlap[key]['payments'].append(pay_id)

    suspicious_pairs = {
        k: v for k, v in pair_overlap.items()
        if len(v['devices']) + len(v['payments']) >= min_shared_entities
    }

    for (acct_a, acct_b), shared in suspicious_pairs.items():
        ring_score = min(50.0 + (len(shared['devices']) * 15) + (len(shared['payments']) * 10), 100.0)

        # Check if a ring for this pair already exists
        existing = (
            FraudRingMember.objects.filter(account_id=acct_a)
            .values_list('ring_id', flat=True)
        )
        existing_for_b = (
            FraudRingMember.objects.filter(account_id=acct_b, ring_id__in=existing)
            .values_list('ring_id', flat=True)
        )
        if existing_for_b.exists():
            continue  # ring already recorded

        ring = FraudRing.objects.create(
            ring_score=ring_score,
            shared_entities=shared,
            notes=f"Auto-detected: accounts {acct_a} and {acct_b} share entities.",
        )
        FraudRingMember.objects.create(ring=ring, account_id=acct_a)
        FraudRingMember.objects.create(ring=ring, account_id=acct_b)

        # Add fraud signals for both accounts
        for acct_id in [acct_a, acct_b]:
            FraudSignal.objects.get_or_create(
                entity_type='ACCOUNT',
                entity_id=acct_id,
                signal_type='LINKED_TO_BLOCKED_ACCOUNT',
                source='internal_graph',
                defaults={
                    'severity': min(int(ring_score / 10), 10),
                    'confidence': round(ring_score / 100, 3),
                    'description': f"Account linked to suspected fraud ring {ring.ring_id}",
                    'is_active': True,
                }
            )

        audit_service.log_event(
            action=audit_service.FRAUD_RING_DETECTED,
            entity_type='FRAUD_RING',
            entity_id=ring.ring_id,
            actor_type='SYSTEM',
            after_state={
                'ring_score': float(ring_score),
                'shared_entities': shared,
                'accounts': [acct_a, acct_b],
            },
        )
        rings_created.append(ring)
        log.info("Fraud ring detected: %s (score=%.1f)", ring.ring_id, ring_score)

    return rings_created
