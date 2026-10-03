# Adaptive Behavioral Profiling — Implementation Guide

## Overview

FraudShield's **Adaptive Behavioral Profiling** system allows the fraud detection pipeline to learn that *new, verified behavior is legitimate* without creating a global whitelist or compromising account-level security (e.g., account takeover protection).

The system moves conceptually from:
> "This behavior is **unfamiliar** for this shipper"

to:

> "This behavior has become **familiar** for this shipper"

…without ever reaching:
> ~~"This shipper/behavior is **trusted** and therefore safe"~~

---

## Architecture

```
┌──────────────┐       ┌──────────────────────┐       ┌────────────────────┐
│   Booking    │──────▶│  Feature Generator   │──────▶│    Rule Engine     │
│   Ingestion  │       │  (+ Familiarity)      │       │  (evaluateRules)   │
└──────────────┘       └──────┬───────────────┘       └────────────────────┘
                              │                                │
                              │ checkFamiliarity()             │ rule_score
                              ▼                                ▼
                    ┌──────────────────┐              ┌────────────────────┐
                    │   behavioral_    │              │   Risk Aggregator  │
                    │   familiarity    │              │   + ML Model       │
                    │   (PostgreSQL)   │              │   → Decision       │
                    └──────────────────┘              └────────────────────┘
                              ▲
                              │ recordVerifiedBehavior()
                              │ invalidateFamiliarity()
                              │
                    ┌──────────────────┐
                    │  Analyst Verdict │
                    │  FALSE_POSITIVE  │──── Learns behavior
                    │  CONFIRMED_FRAUD │──── Invalidates ALL
                    │  INCONCLUSIVE    │──── No change
                    └──────────────────┘
```

---

## Behavioral Lifecycle

### Phase 1: Novel Behavior Detected
A shipper (Account A) historically ships to Bangalore, Hyderabad, and Mumbai.  
A new shipment arrives with destination **Kolkata**.

The feature generator sets `is_new_destination = true`, which triggers the `NEW_DESTINATION` rule (+8 risk points). Combined with other signals, this may escalate the shipment for review.

### Phase 2: Analyst Verification
An analyst reviews the flagged shipment, determines the shipper legitimately expanded to Kolkata, and marks it **FALSE_POSITIVE**.

The system calls `processAnalystFeedback()` which creates a `behavioral_familiarity` entry:

| Field | Value |
|-------|-------|
| account_id | Account A's UUID |
| dimension | `destination` |
| value | `kolkata` |
| occurrence_count | 1 |
| source_shipment_id | The reviewed shipment |
| source_analyst_id | The reviewing analyst |

### Phase 3: Familiarity Applied
The next shipment from Account A to Kolkata triggers `generateFeaturesWithFamiliarity()`.  
The function queries `behavioral_familiarity`, finds Kolkata is familiar (strength 0.33), and sets `is_new_destination = false`.

The `NEW_DESTINATION` rule does **not** fire. But ALL other signals (device, payment, IP, velocity) remain fully active.

### Phase 4: Strengthening
After 3+ analyst-verified shipments to Kolkata, the familiarity strength reaches 1.0 (established). The behavior is now fully integrated into the shipper's profile.

### Phase 5: Decay
If the shipper doesn't ship to Kolkata for 180 days, the familiarity entry decays and eventually expires. The next shipment to Kolkata would again be flagged as novel.

### Phase 6: Fraud Invalidation
If Account A is later confirmed as fraud (e.g., account takeover), ALL behavioral familiarity entries are immediately invalidated. This prevents the attacker from inheriting the legitimate owner's learned profile.

---

## Fraud Safety Guarantees

### ✅ Entity Isolation
Familiarity learned for **Account A** does NOT affect **Account B**. Each account has its own scoped behavioral profile.

### ✅ Dimension Independence
Learning `destination:Kolkata` as familiar does NOT suppress:
- New device detection (`NEW_DEVICE_FOR_ACCOUNT`)
- New payment detection (`NEW_PAYMENT_FOR_ACCOUNT`)
- VPN/Proxy detection
- IP blacklist signals
- Velocity anomalies
- Weight anomalies
- Address risk signals

### ✅ Account Takeover Protection
An attacker who takes over Account A and ships to the legitimate owner's familiar destination will still trigger:
- `NEW_DEVICE_FOR_ACCOUNT` (attacker's device is unknown)
- `NEW_PAYMENT_FOR_ACCOUNT` (attacker's payment is unknown)
- `RECENT_PASSWORD_CHANGE` (attacker changed the password)
- `VPN_DETECTED` / `PROXY_DETECTED` (attacker hiding location)

Familiar destination ONLY suppresses the behavioral novelty signal — all identity/device/payment signals remain active.

### ✅ Fraudulent Seasoning Resistance
- Only **analyst-verified** `FALSE_POSITIVE` verdicts create familiarity entries
- `INCONCLUSIVE` verdicts do NOT create entries
- Unreviewed shipments do NOT create entries
- Single verified occurrences have **weak** strength (0.33)
- Multiple verifications required for **full** strength (1.0)

### ✅ Reversibility
- `CONFIRMED_FRAUD` on any shipment invalidates **ALL** familiarity for the account
- Individual entries can be invalidated by dimension+value or source shipment
- Invalidated entries are never returned as familiar

### ✅ Fail-Safe Behavior
If the behavioral familiarity service is unavailable (DB down, network error, corruption):
- `checkFamiliarity()` returns `{ familiar: false }` → **no reduced scrutiny**
- `generateFeaturesWithFamiliarity()` falls back to standard features → **higher scrutiny**
- `recordVerifiedBehavior()` returns `null` → analyst workflow continues unblocked
- The system **never silently reduces fraud scrutiny** due to a service failure

### ✅ No ML Model Retraining
The adaptive behavioral profiling system operates entirely at the **feature engineering layer**. It does NOT:
- Retrain LightGBM, Isolation Forest, or calibration models
- Modify ML model weights or thresholds
- Change the risk aggregation formula

It simply adjusts the **input features** that feed into the existing pipeline.

---

## ML Interaction

The adaptive profiling system interacts with the ML pipeline at the feature level:

```
Standard pipeline:    booking → features(is_new_destination=true)  → ML → score
Adapted pipeline:     booking → features(is_new_destination=false) → ML → score
```

The ML model receives adjusted feature values. Since `is_new_destination` is one input among many (device signals, payment signals, velocity, weight, etc.), its suppression has a proportional — not dominant — effect on the final fraud probability.

The ML model was NOT retrained. Its behavior with `is_new_destination=false` is the same as for a shipper whose historical destinations already included the city.

---

## API Reference

### GET `/api/behavioral-profile/:account_id`
Returns the full behavioral familiarity state for an account.

**Response:**
```json
{
  "account_id": "uuid",
  "familiarity_entries": [
    {
      "familiarity_id": 1,
      "dimension": "destination",
      "value": "kolkata",
      "occurrence_count": 3,
      "strength": 0.95,
      "first_verified_at": "2026-10-01T10:00:00Z",
      "last_verified_at": "2026-10-03T14:00:00Z",
      "is_stale": false
    }
  ],
  "config": {
    "stale_days": 180,
    "min_occurrences_for_established": 3,
    "supported_dimensions": ["destination", "origin", "service_type", "booking_hour_range"]
  }
}
```

### POST `/api/behavioral-profile/feedback`
Process analyst feedback to update behavioral profiles.

**Request:**
```json
{
  "account_id": "uuid",
  "shipment_id": "uuid",
  "verdict": "FALSE_POSITIVE",
  "analyst_id": "uuid",
  "case_id": "uuid",
  "shipment_details": {
    "origin": "Chennai",
    "destination": "Kolkata",
    "service_type": "EXPRESS"
  }
}
```

### POST `/api/behavioral-profile/invalidate`
Manually invalidate behavioral familiarity entries.

**Request:**
```json
{
  "account_id": "uuid",
  "reason": "Later confirmed as fraud",
  "dimension": "destination",
  "value": "Kolkata"
}
```

---

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `STALE_DAYS` | 180 | Entries older than this are stale (not familiar) |
| `MIN_OCCURRENCES_FOR_ESTABLISHED` | 3 | Minimum verified occurrences for full familiarity |
| `DECAY_ENABLED` | true | Enable linear recency decay |
| `MAX_FAMILIARITY_REDUCTION` | 8 | Maximum risk score reduction from familiarity |
| `DIMENSIONS` | destination, origin, service_type, booking_hour_range | Supported behavioral dimensions |

---

## Database Schema

```sql
CREATE TABLE behavioral_familiarity (
  familiarity_id    BIGSERIAL PRIMARY KEY,
  account_id        UUID NOT NULL,
  dimension         TEXT NOT NULL,
  value             TEXT NOT NULL,
  occurrence_count  INT NOT NULL DEFAULT 1,
  first_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_shipment_id UUID,
  source_analyst_id  UUID,
  source_case_id     UUID,
  is_invalidated    BOOLEAN NOT NULL DEFAULT FALSE,
  invalidated_at    TIMESTAMPTZ,
  invalidated_reason TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, dimension, value)
);
```

---

## Testing

Run the test suite:
```bash
npx jest tests/behavioralProfile.test.js --verbose
```

### Test Scenarios Covered

| # | Scenario | Status |
|---|----------|--------|
| 1 | Existing baseline behavior not flagged | ✅ |
| 2 | Legitimate behavioral change detected as novel | ✅ |
| 3 | Analyst verification causes behavioral adaptation | ✅ |
| 4 | Repeated normal behavior no longer penalized | ✅ |
| 5 | Entity isolation (Account A ≠ Account B) | ✅ |
| 6 | Independent risk signals remain active | ✅ |
| 7 | Account takeover detection still works | ✅ |
| 8 | Fraudulent seasoning resistance | ✅ |
| 9 | Incorrect feedback reversal | ✅ |
| 10 | Recency decay | ✅ |
| 11 | Failure safety | ✅ |
| 12 | Regression (existing rules/ML preserved) | ✅ |
| 13 | Point-in-time correctness | ✅ |
