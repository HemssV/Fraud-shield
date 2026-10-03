# FraudShield ML — The Deep-Dive (`what.md`)

> **What is everything in this folder, why is it here, and how does it all connect?**
> This document covers: the problem, the data, the features, the model architecture, the training pipeline, the evaluation results, the serving layer, the integration layer, and the tests. Read it top to bottom once and you'll understand the entire system.

---

## Table of Contents

1. [The Problem Being Solved](#1-the-problem-being-solved)
2. [Folder Map — What Each File Is](#2-folder-map--what-each-file-is)
3. [Data — `data/`](#3-data--data)
4. [Features — `features/`](#4-features--features)
5. [Model Architecture — `models/`](#5-model-architecture--models)
6. [Evaluation Results — `docs/EVAL.md`](#6-evaluation-results--docsevalmid)
7. [Inference Engine — `engine.py`](#7-inference-engine--enginepy)
8. [Serving Layer — `service/`](#8-serving-layer--service)
9. [Saved Artifacts — `artifacts/v1/`](#9-saved-artifacts--artifactsv1)
10. [Integration Layer — `integration/`](#10-integration-layer--integration)
11. [Scripts — `scripts/`](#11-scripts--scripts)
12. [Tests — `tests/`](#12-tests--tests)
13. [Configuration — `config.py`](#13-configuration--configpy)
14. [Dependencies — `requirements.txt`](#14-dependencies--requirementstxt)
15. [How to Run Everything](#15-how-to-run-everything)
16. [Architecture Diagram](#16-architecture-diagram)

---

## 1. The Problem Being Solved

FraudShield is a logistics fraud detection system built for a shipping platform serving Indian businesses. When a shipper (a company or individual) creates a booking, the system must answer:

> **"Is this shipment fraudulent?"** — in real time, before the package is dispatched.

The fraudulent behaviour being detected spans six typologies:
- An attacker taking over a legitimate account (**ACCOUNT_TAKEOVER**)
- A fraudster flooding the network with shipments using stolen credentials (**VOLUME_ATTACK**)
- Shipments routed to known reshipping hubs for black-market goods (**DESTINATION_ANOMALY**)
- Stolen or cloned payment instruments (**PAYMENT_MISMATCH**)
- Organised fraud rings sharing a single device or payment method across multiple fake accounts (**FRAUD_RING**)
- Slow-burn fraud that carefully mimics legitimate behaviour to avoid rule triggers (**LOW_AND_SLOW**)

The `ml/` folder is the **entire ML subsystem** that handles this detection. It is a standalone Python microservice that sits alongside the Node.js booking backend and the Django intelligence backend.

---

## 2. Folder Map — What Each File Is

```
ml/
├── what.md                            ← You are here
├── README.md                          ← Short setup & command reference
├── MERGE.md                           ← Step-by-step integration guide for teammates
├── config.py                          ← All paths, ports, seeds in one place
├── engine.py                          ← The core FraudEngine class (inference logic)
├── requirements.txt                   ← Pinned Python dependencies
├── .gitignore                         ← Excludes venv/, data/out/, __pycache__/
│
├── data/
│   ├── generate.py                    ← Synthetic data generator (no database needed)
│   └── out/
│       ├── bookings.parquet           ← ~50 MB generated dataset (180 days, 2000 shippers)
│       └── scenarios.json            ← 7 named test-case payloads for smoke tests
│
├── features/
│   ├── schema.py                      ← FEATURE_SPEC dict + ORDERED_FEATURE_NAMES list
│   └── transform.py                   ← flatten_features(): nested dict → numpy float32 array
│
├── models/
│   ├── train.py                       ← Full training pipeline (IForest + LightGBM + Calibrator)
│   ├── evaluate.py                    ← Generates EVAL.md and cost_curve.png
│   └── policy.py                      ← Placeholder for future threshold policy overrides
│
├── service/
│   └── app.py                         ← FastAPI HTTP service: /health /score /predict /feedback
│
├── artifacts/
│   └── v1/
│       ├── model.txt                  ← Serialised LightGBM booster (~139 KB)
│       ├── iforest.joblib             ← Serialised Isolation Forest (~836 KB)
│       ├── calibrator.joblib          ← Serialised Isotonic Regression (~1 KB)
│       ├── feature_spec.json          ← Snapshot of FEATURE_SPEC at training time
│       ├── thresholds.json            ← Risk threshold values
│       └── metadata.json             ← Training metadata + test metrics
│
├── integration/
│   ├── fraudModel.js.new              ← Drop-in replacement for Node.js src/ml/fraudModel.js
│   ├── ml_service_RealMLAdapter.py.snippet  ← Django RealMLAdapter class to paste in
│   ├── node_patch.md                  ← Notes on making the Node.js call-site async
│   ├── env_additions.txt              ← New env vars to add to .env files
│   └── OPTIONAL_booking_schema_additions.md ← Optional DB schema additions
│
├── scripts/
│   ├── demo_scenarios.py              ← 7-scenario colour-coded smoke test (no HTTP)
│   ├── make_golden.js                 ← Placeholder for Node golden feature extractor
│   └── retrain.py                     ← Placeholder for future retraining automation
│
├── tests/
│   ├── test_basic.py                  ← Import smoke test
│   └── test_leakage.py               ← Verifies no future-data leakage in feature generation
│
└── docs/
    ├── RECON.md                       ← Full feature schema reference + Node/Django contracts
    ├── ASSUMPTIONS.md                 ← Design decisions and known constraints
    ├── EVAL.md                        ← Auto-generated evaluation report (real numbers)
    └── figures/
        └── cost_curve.png             ← Threshold vs. Expected Cost plot (INR)
```

---

## 3. Data — `data/`

### Why Synthetic?

There is no production database connected to the ML module. The data is **fully synthetically generated** by `data/generate.py`. This was a deliberate design choice:

- No database connection required → fully portable
- Controlled fraud rates and typology mix
- Reproducible with a fixed seed (`DEFAULT_SEED = 42`)
- Instant iteration on feature engineering without waiting for real data pipelines

The trade-off is that the model's performance on synthetic data overstates real-world effectiveness (the model was trained and tested on data from the same generator). This is explicitly documented in the limitations.

### The Shipper Digital Twin

The most important concept in `generate.py` is the **`ShipperState` class** — a per-shipper "Digital Twin":

```python
class ShipperState:
    def __init__(self, shipper_id, company, is_trusted, created_at): ...
    def update(self, row, dt): ...        # Called AFTER feature computation
    def compute_features(self, row, dt, global_state) -> dict: ...  # Called BEFORE update
```

Each shipper has a stateful in-memory object that tracks everything they have ever done:
- `known_devices` — set of device IDs used in past bookings
- `known_payments` — set of payment IDs used in past bookings
- `usual_destinations` / `usual_origins` — cities shipped from/to historically
- `usual_hours` — hours of day they typically book
- `weights` — rolling list of shipment weights (last 1000)
- `daily_counts` — package counts per calendar day

**Critical property:** `compute_features()` is always called **before** `update()`. This means the feature for booking N is computed using only the history of bookings 1 through N-1. There is no leakage of future information into features. The `test_leakage.py` test explicitly verifies this invariant.

The simulation runs a **time loop** over 180 days, processing each shipper each day stochastically based on their size persona. Three named seed shippers are established at fixed ages:
- `S1001` — Chennai Export Pvt Ltd (MEDIUM persona, 3.5 years old at sim start)
- `S2002` — Mumbai Small Shipper (THIN persona, 47 days old at sim start)
- `S3003` — Delhi Enterprise Corp (ENTERPRISE persona, 6.7 years old at sim start)

The remaining ~1,997 shippers are randomly sized with random personas (origins, destinations, weight distributions, booking cadences).

Shipper personas control booking frequency:
| Persona | Daily booking probability | Bookings per day |
|---|---|---|
| THIN | 5% | 1 |
| SMALL | 20% | 1 |
| MEDIUM | 80% | 3 |
| ENTERPRISE | 100% | ~20 (normal distribution) |

### Fraud Typologies Simulated

Each booking has a **1.5% chance** of being fraudulent. When it is, a fraud type is chosen uniformly at random and the row is mutated to exhibit the signature signals:

| Fraud Type | Mutations Applied |
|---|---|
| `ACCOUNT_TAKEOVER` | New attacker device ID, new attacker payment ID, destination = "Unknown City", password recently changed (2h ago) |
| `VOLUME_ATTACK` | `package_count` inflated 10–50×, `weight` scaled proportionally |
| `DESTINATION_ANOMALY` | Destination = "International Reshipper Hub", weight tripled |
| `PAYMENT_MISMATCH` | Stolen payment ID with `fraud_count=1`, `cardholder_match=False`, `billing_shipping_match=False` |
| `FRAUD_RING` | Shared device `RING_DEVICE_1` linked to 5 accounts and marked as linked to fraud |
| `LOW_AND_SLOW` | **No mutations** — intentionally mimics legitimate behaviour with no detectable signal |

### Hard Negatives

After fraud assignment, non-fraud bookings have a **3% chance** of being a "hard negative" — a legitimate transaction that superficially looks suspicious:

- **`SEASONAL_LEGIT_SPIKE`** (30% of hard negatives): High package count (5–15×), the shipper is marked `is_trusted=True`. Represents Diwali-style surges from known good accounts.
- **`LEGIT_NEW_BEHAVIOR`** (70% of hard negatives): Either a new device (replacement phone) or a new destination (expanding business) — both legitimate.

Hard negatives are tracked in the `is_hard_negative` column and evaluated separately to measure false-positive rates on ambiguous cases.

### Output Files

| File | Size | Description |
|---|---|---|
| `data/out/bookings.parquet` | ~50 MB | Full 180-day dataset. ~110K+ rows. Contains raw booking fields + all pre-computed feature columns. ~1.5% fraud rate. |
| `data/out/scenarios.json` | ~24 KB | One representative row per unique scenario plus one NORMAL row. Used by the smoke test and demo UI. |

---

## 4. Features — `features/`

### The Six Feature Families

Features are organised into six namespaced families, defined authoritatively in `features/schema.py` as the `FEATURE_SPEC` dict.

#### `behavioral` — What the shipper is doing now vs. their history

| Feature | Type | What it captures |
|---|---|---|
| `weight_z_score` | Float | Std deviations of current shipment weight from shipper's historical mean |
| `weight_ratio_to_avg` | Float | Current weight / historical average |
| `weight_exceeds_max` | Bool | Current weight exceeds the shipper's all-time maximum |
| `is_unusual_hour` | Bool | Booking hour is outside the shipper's historical booking hours |
| `booking_hour` | Int | UTC hour of booking (0–23) |
| `is_new_destination` | Bool | Destination city not in shipper's historical destinations |
| `is_new_origin` | Bool | Origin city not in shipper's historical origins |
| `is_unusual_service` | Bool | Service type deviates from historical pattern |
| `package_count_ratio` | Float | Current package count / historical average daily volume |
| `total_historical_shipments` | Int | Absolute count of past shipments |
| `is_low_history` | Bool | `total_shipments < 10` — thin history is a fraud signal |

#### `identity` — Who the account holder is

| Feature | Type | What it captures |
|---|---|---|
| `is_new_device` | Bool | Booking from a device ID never seen on this account |
| `is_new_payment_for_account` | Bool | Payment ID never previously linked to this account |
| `password_changed_recently` | Bool | Password changed within last 72 hours (classic ATO signal) |
| `profile_updated_recently` | Bool | Profile updated within last 48 hours (attacker preparing account) |
| `account_age_days` | Int | Days since account creation |
| `is_new_account` | Bool | `account_age_days < 30` |
| `is_suspended` | Bool | Account explicitly suspended — strongest single identity signal |
| `is_under_investigation` | Bool | Account under fraud investigation |
| `is_verified` | Bool | Account KYC verified |
| `previous_fraud_cases` | Int | Number of confirmed past fraud events on this account |
| `previous_review_cases` | Int | Number of times account was flagged for review |

#### `payment` — What payment instrument is being used

| Feature | Type | What it captures |
|---|---|---|
| `payment_found` | Bool | Whether payment data was provided at all |
| `is_new_payment_method` | Bool | Payment not previously linked to this account |
| `cardholder_match` | Bool | Cardholder name matches account name |
| `billing_shipping_match` | Bool | Billing address matches shipment origin |
| `previous_transactions` | Int | Total transactions on this payment instrument |
| `previous_shipments` | Int | Shipments specifically paid with this method |
| `amount_spend_30d` | Float | Total spend in last 30 days (velocity proxy) |
| `previous_fraud_count` | Int | Known fraud events on this payment instrument |
| `foreign_card` | Bool | Issuing bank is outside India |

#### `device` — What device and network are being used

| Feature | Type | What it captures |
|---|---|---|
| `device_found` | Bool | Whether device data was provided |
| `known_device` | Bool | Device is in the system-wide known-devices registry |
| `known_for_this_account` | Bool | Device was previously used by this specific account |
| `accounts_linked` | Int | How many distinct accounts have used this device (high = fraud ring) |
| `device_risk_score` | Int | Third-party device fingerprint risk score (0–100) |
| `vpn_detected` | Bool | IP belongs to a known VPN provider |
| `proxy_detected` | Bool | IP is a proxy |
| `device_blacklisted` | Bool | Device ID is on the fraud blocklist |
| `ip_blacklisted` | Bool | IP address is on the fraud blocklist |
| `device_linked_to_fraud` | Bool | Device was involved in a past confirmed fraud event |
| `linked_fraud_account_count` | Int | Number of confirmed fraud accounts linked to this device |

#### `address` — Where the package is going

| Feature | Type | What it captures |
|---|---|---|
| `address_found` | Bool | Whether address data was provided |
| `address_valid` | Bool | Address validated by a mapping service |
| `confidence_score` | Float | Deliverability confidence (0–1) |
| `is_new_destination_for_shipper` | Bool | Destination not in this shipper's historical destinations |
| `delivery_success_rate` | Float | Historical delivery success rate at this address |

#### `velocity` — Temporal patterns

| Feature | Type | What it captures |
|---|---|---|
| `booking_hour` | Int | Hour of booking (0–23) |
| `is_late_night` | Bool | Booking between 22:00–04:00 |
| `is_weekend` | Bool | Weekend booking |
| `avg_daily_volume` | Float | Historical average daily shipment volume for this shipper |
| `estimated_daily_rate` | Int | Current booking's package count |
| `volume_spike_detected` | Bool | `package_count > avg_daily * 3` — direct VOLUME_ATTACK signal |

### Feature Encoding

The `FEATURE_SPEC` dict defines both the **schema** and **defaults** for all features. String and array features (`account_status`, `ip_country`, `ip_reputation`, `risk_tier`, `signals`, `linked_fraud_accounts`) are included in the schema for documentation but are **excluded from the model input** — only scalar (`int`, `float`, `bool`) features feed into LightGBM.

`ORDERED_FEATURE_NAMES` is computed automatically by iterating `FEATURE_SPEC` and collecting only scalar features. The **order is deterministic** and critical — the LightGBM model is trained on this exact ordering and must always be scored with the same ordering.

`features/transform.py` provides `flatten_features(features_dict)` which:
1. Iterates `FEATURE_SPEC` categories in the fixed order
2. For each scalar feature, reads the value from the incoming dict (or fills the default if missing)
3. Applies type coercion (bool → float, int → float, float → float)
4. Returns a `numpy.float32` array of length = `len(ORDERED_FEATURE_NAMES)`

This tolerance for missing keys makes the engine robust when the upstream Node.js or Django caller doesn't provide every field.

---

## 5. Model Architecture — `models/`

The scoring stack is a **three-stage ensemble**:

```
Input Features (nested dict)
         │
         ▼
  [flatten_features()]  →  43 scalar floats
         │
         ├─────────────────────────────────────────┐
         │  (behavioral + velocity features only)  │
         ▼                                         │
   [Isolation Forest]                              │
   (trained on legitimate rows only)               │
         │                                         │
         ▼                                         │
   anomaly_score (inverted, higher = more anomalous)│
         │                                         │
         └─────────────────────────────────────────┘
                        │
                        ▼
              44 features (43 original + anomaly_score)
                        │
                        ▼
              [LightGBM Booster]
              (binary classification, 1000 trees max)
                        │
                        ▼
                raw_prediction (uncalibrated float)
                        │
                        ▼
         [Isotonic Regression Calibrator]
         (fitted on validation set predictions)
                        │
                        ▼
              fraud_probability ∈ [0.0, 1.0]
```

### Stage 1: Isolation Forest (Unsupervised)

**What it is:** `sklearn.ensemble.IsolationForest(n_estimators=100, contamination=0.05)`

**What it does:** Detects anomalies in the behavioural and velocity feature space — specifically, whether the *current shipment* looks like an anomaly relative to normal shipping activity.

**Why only behavioral + velocity features?**
These are the features that capture *what the shipper is doing* relative to their own baseline. The Isolation Forest is specifically good at spotting "this shipper is doing something they've never done before" — which is what VOLUME_ATTACK and partially ACCOUNT_TAKEOVER look like.

**Training data:** Only the legitimate (label=0) rows from the training split. Fraud rows are intentionally excluded so the model doesn't learn to consider fraud behaviour as "normal."

**Output:** `decision_function()` returns a score where more negative = more anomalous. We invert it (`-decision_function()`) so that **higher score = more anomalous**. This inverted score becomes the `anomaly_score` feature appended to the LightGBM input.

**Why this matters:** LightGBM is purely supervised — it only learns patterns that appear in the training labels. The IForest is unsupervised and can catch general anomalies that are underrepresented in training labels, particularly helping detect novel fraud patterns.

**Saved as:** `artifacts/v1/iforest.joblib` (~836 KB, 100 trees)

### Stage 2: LightGBM (Supervised)

**What it is:** `lightgbm.train()` — gradient boosted decision trees optimised for binary classification.

**Training parameters:**
```python
{
    'objective': 'binary',
    'metric': 'average_precision',   # Optimises PR-AUC — correct for imbalanced data
    'learning_rate': 0.05,
    'num_leaves': 31,                # Moderate complexity, avoids overfitting
    'scale_pos_weight': ~66,         # Handles ~1.5% fraud rate
    'random_state': 42,
    'num_boost_round': 1000,         # Max trees
    'early_stopping_rounds': 50      # Stops when val AP stops improving for 50 rounds
}
```

**Key design decisions:**
- `scale_pos_weight` is computed as `(n_legit) / (n_fraud)` (~66 at 1.5% fraud rate). This amplifies the gradient of each fraud example by 66×, counteracting the class imbalance
- `average_precision` as the metric directly optimises Precision-Recall AUC, which is the right metric for highly imbalanced data where we care about detecting the rare positive class
- Early stopping on the validation set prevents overfitting while maximising the effective model capacity

**Output:** `predict()` returns raw scores (not true probabilities). `predict(pred_contrib=True)` returns SHAP-style per-feature contributions used for explainability — this is how `top_reasons` and `feature_importances` are computed in the engine.

**Saved as:** `artifacts/v1/model.txt` (~139 KB, native LightGBM text format)

### Stage 3: Isotonic Regression Calibration

**What it is:** `sklearn.isotonic.IsotonicRegression(out_of_bounds='clip')`

**What it does:** Maps LightGBM's raw output scores to properly calibrated probabilities. LightGBM's raw `predict()` output is monotonically related to fraud probability but is not a well-calibrated probability (i.e., a raw score of 0.7 does not mean 70% chance of fraud).

**Why isotonic regression?**
- Non-parametric — fits any shape of miscalibration, not just the logistic sigmoid used by Platt scaling
- Works well when the validation set is large enough (1 month × 2000 shippers)
- `out_of_bounds='clip'` prevents it from extrapolating beyond the training range

**Training data:** The validation set (Days 120–150) — data the LightGBM model has never trained on. Using the validation set for calibration is correct and does not constitute data leakage.

**Saved as:** `artifacts/v1/calibrator.joblib` (~1 KB — just a monotone lookup table)

### Why This Stack?

| Requirement | Solution |
|---|---|
| Real-time scoring (<50ms) | LightGBM inference is CPU-only and takes <1ms per row |
| Handles imbalanced data (1.5% fraud) | `scale_pos_weight` + PR-AUC metric |
| Detects unseen anomalies | Isolation Forest as an additional feature |
| Interpretable outputs for investigators | SHAP-style `pred_contrib` from LightGBM |
| Calibrated probabilities | Isotonic Regression calibration |
| No GPU required | All sklearn + LightGBM, CPU-only |
| Portable deployment | All serialised to single files |

### Training Split Strategy

The 180-day dataset is split **strictly by time** to avoid temporal leakage:

```
Day 0 ──────── Day 120 ──────── Day 150 ──────── Day 180
│                │                │                │
│   TRAIN        │   VALIDATION   │   TEST         │
│  (4 months)    │   (1 month)    │  (1 month)     │
│  ~66% of data  │   ~17%         │  ~17%          │
```

- **Train:** Days 0–120 → fits IForest + LightGBM
- **Validation:** Days 120–150 → used for LightGBM early stopping + Isotonic calibration fitting
- **Test:** Days 150–180 → held out completely, used only in `evaluate.py` for final metrics

This mirrors how a real deployment works: the model is always predicting on future data it has never seen.

### Label Delay Simulation

Real-world fraud labels (chargebacks, disputes) arrive 30–90 days after the transaction. To simulate this, labels for the **last 14 days of the training window** (Days 106–120) are zeroed out:

```python
label_cutoff = train_end - timedelta(days=14)
train_df.loc[train_df['timestamp'] >= label_cutoff, 'label'] = 0
```

The model learns to generalise in situations where recent fraud hasn't been confirmed yet — a realistic challenge.

### Class Imbalance Handling

The fraud rate is ~1.5%. Without intervention, a model that always predicts "not fraud" would have 98.5% accuracy while catching zero fraud. Two mechanisms address this:

1. **`scale_pos_weight = (n_legit) / (n_fraud)` (~66)** — Amplifies the gradient contribution of each fraud example during training.
2. **PR-AUC metric (`average_precision`)** — Directly measures performance on the positive (fraud) class, ignoring the overwhelming true-negative mass.

---

## 6. Evaluation Results — `docs/EVAL.md`

All numbers are from the **test set (Month 6, Days 150–180)**, generated by `models/evaluate.py` on the trained model.

### Headline Metrics

| Metric | Value | Interpretation |
|---|---|---|
| **ROC-AUC** | **0.913** | The model ranks a random fraud above a random legit 91.3% of the time |
| **PR-AUC** | **0.789** | Precision-Recall area under curve across all thresholds |
| **Recall at 1% FPR** | **0.816** | Catching 81.6% of fraud while flagging only 1 in 100 legit shipments |
| **Recall at 0.5% FPR** | **0.816** | Same recall achievable at even lower false positive rate |
| **Precision at Top-500** | **0.996** | If you review the 500 most suspicious cases, 99.6% are real fraud |

### Confusion Matrix

At the default threshold of 0.5 on the test set:

| | Predicted Legitimate | Predicted Fraud |
|---|---|---|
| **Actual Legitimate** | 108,328 ✅ (TN) | 78 ❌ (FP) |
| **Actual Fraud** | 376 ❌ (FN — missed) | 1,310 ✅ (TP — caught) |

- **Recall (True Positive Rate):** 1,310 / (1,310 + 376) = **77.7%**
- **Precision:** 1,310 / (1,310 + 78) = **94.4%**
- **FPR:** 78 / (108,328 + 78) = **0.07%** — extremely low false alarm rate at this threshold

### Per-Typology Recall

| Fraud Type | Recall | Cases | Notes |
|---|---|---|---|
| **FRAUD_RING** | **1.000** | 299 | Perfect. `accounts_linked` and `device_linked_to_fraud` are decisive. |
| **VOLUME_ATTACK** | **1.000** | 285 | Perfect. `volume_spike_detected` + `package_count_ratio` provide clear signals. |
| **PAYMENT_MISMATCH** | **0.951** | 288 | Excellent. `previous_fraud_count` + `cardholder_match=False` are powerful. |
| **ACCOUNT_TAKEOVER** | **0.935** | 278 | Strong. `is_new_device` + `password_changed_recently` combination is distinctive. |
| **DESTINATION_ANOMALY** | **0.676** | 284 | Moderate. High-risk destinations are detectable but some cases bleed through. |
| **LOW_AND_SLOW** | **0.000** | 252 | **Zero.** Intentionally mimics legitimate behaviour with no detectable signal. |

**LOW_AND_SLOW is the hardest and most realistic fraud type.** The fraudster places normal shipments to normal destinations using a known payment method. The only tell would be longitudinal behavioural drift over time, which the current feature window doesn't capture.

### Hard Negatives FPR

**FPR on Hard Negatives: 0.001 (0.1%)**

Only 1 in 1,000 hard negatives (legitimate-but-suspicious shipments) was incorrectly flagged as fraud. This means the model has learned to distinguish between anomalous-but-legitimate behaviour (seasonal spikes from trusted shippers, new devices from established accounts) and actual fraud — one of the most practically important metrics.

### Cost Curve Analysis

The cost model used in `models/evaluate.py`:

| Event | Cost |
|---|---|
| Missed fraud (False Negative) | ₹2,500 (estimated average shipment value lost) |
| False alarm (False Positive) | ₹50 (cost of a 5-minute manual review) |

**Optimal threshold from cost curve: 0.040**

The default threshold of 0.5 is very conservative. Since catching fraud (avoiding ₹2,500 loss) is 50× more valuable than avoiding a false alarm (₹50 review cost), the optimal threshold is much lower. At threshold 0.04, the model flags far more cases for review but eliminates most of the expensive missed frauds.

The cost curve plot is saved to `docs/figures/cost_curve.png`.

### Ablation Study

During training (`models/train.py`), three systems are compared on the test set:

| System | What it is | Limitation |
|---|---|---|
| **Rules Only** | Simplified Python version of the Node.js rule engine | Rigid thresholds, no learning from data |
| **IForest Only** | Top 5% of anomaly scores → predicted fraud | Unsupervised, confuses hard negatives with fraud |
| **Full Stack** | IForest + LightGBM + Calibration | Best on all metrics |

The full stack wins because:
- Rules are rigid and cannot adapt to patterns in data
- IForest is unsupervised and has no concept of "fraud vs. hard negative"
- LightGBM learns the precise decision boundary from labelled examples

### Limitations

1. **Synthetic data ceiling:** The model was trained and tested on data from the same generator. Real-world fraud is more diverse, more adaptive, and less cleanly separated.

2. **Label delay gap:** We simulated 14-day label delay, but real chargebacks can take 30–90 days. This is an optimistic approximation.

3. **LOW_AND_SLOW is unsolvable with current features:** Catching slow-burn fraud requires longitudinal features (e.g., "what is this shipper's 30-day trend?") that current per-booking feature generation doesn't compute.

4. **No concept drift handling:** The model is static (v1.0.0). As fraud patterns evolve, the model will degrade without retraining.

---

## 7. Inference Engine — `engine.py`

The `FraudEngine` class is the single entry point for all scoring. It loads all three model artefacts at startup and exposes one public method: `score()`.

### Scoring Pipeline

```python
result = engine.score(features_dict, context=None)
```

Internal steps:

1. **`flatten_features(features_dict)`** — Converts nested dict to float32 numpy array (43 values)
2. **Extract behavioral/velocity subset** — Using `bev_vel_idx` (precomputed indices at init time)
3. **IForest anomaly score** — `anomaly_score = -iforest.decision_function(bev_vel_subset)[0]`
4. **Append anomaly score** — Creates 44-element input for LightGBM
5. **LightGBM predict** — Get both raw score and SHAP contributions in one call
6. **Calibrate** — `fraud_probability = calibrator.predict([raw_pred])[0]`
7. **Format response** — Compute ml_score (0–100), risk_level, top_reasons, feature_importances

### Risk Levels

| ml_score Range | Risk Level |
|---|---|
| 0–39 | LOW |
| 40–69 | MEDIUM |
| 70–84 | HIGH |
| 85–100 | CRITICAL |

### Feature Importance Grouping

The engine uses LightGBM's `pred_contrib=True` (SHAP-style contributions) to produce per-feature importance values for each individual prediction. These are aggregated into the six feature families and normalised to sum to 100:

```json
{
    "behavioral": 42.3,
    "identity": 31.1,
    "payment": 15.7,
    "device": 8.2,
    "address": 1.4,
    "velocity": 1.3
}
```

The top 5 features by positive SHAP contribution are returned as human-readable `top_reasons` strings (e.g., `"High risk driven by identity_is_new_device"`).

### Degraded Mode

If the model files don't exist (e.g., `artifacts/v1/` is empty before training), the engine enters **degraded mode** and returns a safe MEDIUM-risk response:

```json
{
    "fraud_probability": 0.5,
    "ml_score": 50.0,
    "risk_level": "MEDIUM",
    "top_reasons": ["ml_engine_degraded"]
}
```

This ensures the rest of the system never crashes because the ML component failed to load. The `degraded` attribute is exposed and checked in `service/app.py`'s `/health` endpoint.

---

## 8. Serving Layer — `service/`

`service/app.py` is a **FastAPI** application that wraps the `FraudEngine` as an HTTP microservice running on **port 8001**.

### Endpoints

| Method | Path | Caller | Response |
|---|---|---|---|
| `GET` | `/health` | Any | `{status, mock_mode, model_loaded, model_version}` |
| `GET` | `/model-info` | Debug/Dev | Full feature spec and thresholds |
| `POST` | `/score` | **Node.js** | Full: `fraud_probability`, `ml_score`, `feature_importances`, `top_reasons`, `anomaly_score`, `model_version`, `scoring_ms` |
| `POST` | `/predict` | **Django** | Slim: `fraud_probability`, `risk_score`, `risk_level`, `top_reasons` |
| `POST` | `/feedback` | Either | Records ground-truth label to `data/out/feedback.jsonl` for future retraining |

**Request body for `/score` and `/predict`:**
```json
{
    "shipment_id": "booking-uuid-here",
    "features": {
        "behavioral": { "weight_z_score": 0.1, ... },
        "identity": { "is_new_device": false, ... },
        "payment": { ... },
        "device": { ... },
        "address": { ... },
        "velocity": { ... }
    },
    "context": {}
}
```

### Mock Mode

Set `ML_MOCK_MODE=true` in the environment to bypass the ML model entirely and return static low-risk dummy responses. This allows the Node.js and Django backends to work even when the ML model hasn't been trained yet (e.g., during frontend development or CI environments without the ML service running).

---

## 9. Saved Artifacts — `artifacts/v1/`

| File | Size | Content |
|---|---|---|
| `model.txt` | ~139 KB | LightGBM booster in native text format. Human-readable tree structures. Contains all learned decision trees. |
| `iforest.joblib` | ~836 KB | Serialised Isolation Forest (100 estimators × feature subsets). Large because each tree stores feature splits. |
| `calibrator.joblib` | ~1 KB | Isotonic Regression calibrator. Tiny — just a monotone lookup table mapping raw LightGBM scores to probabilities. |
| `feature_spec.json` | ~2 KB | Snapshot of `FEATURE_SPEC` at training time. Useful for detecting schema drift between model and current feature generation. |
| `thresholds.json` | 75 bytes | `{"fraud_probability_high": 0.5, "fraud_probability_critical": 0.8}` — used by the engine for risk level assignment. |
| `metadata.json` | 250 bytes | `{"model_version": "v1.0.0", "train_date_range": [...], "metrics": {"test_pr_auc": 0.789, "test_roc_auc": 0.913}, "seed": 42}` |

**Model version:** `v1.0.0`, trained on data from `2026-04-05` to `2026-08-03`.

---

## 10. Integration Layer — `integration/`

This folder contains everything needed to connect the ML microservice to the existing Node.js and Django codebases. These files are to be **copied into** the other services — they are not used by the ML service itself.

### Node.js Integration

**File:** `integration/fraudModel.js.new`

A **drop-in replacement** for `src/ml/fraudModel.js`. The public API is identical:

```javascript
const { scoreShipment } = require('./fraudModel');
// Same signature, but now async
const result = await scoreShipment(features, booking.id);
```

Internally it:
1. Checks `ML_MOCK_MODE` env var — returns local mock if `true`
2. Makes a `POST /score` call to `ML_SERVICE_URL` with a strict **2-second timeout**
3. On any failure (network error, timeout, non-200) — **gracefully falls back** to the original local mock logic
4. Marks the model version as `fraud-xgb-v1-mock-fallback` so you can distinguish real vs. fallback in logs

**To apply:**
```powershell
copy src\ml\fraudModel.js src\ml\fraudModel.js.bak  # backup
copy ml\integration\fraudModel.js.new src\ml\fraudModel.js
```

### Django Integration

**File:** `integration/ml_service_RealMLAdapter.py.snippet`

A Python class that makes HTTP calls to `POST /predict`. Paste it into `intelligence/services/ml_service.py` and switch `get_ml_service()` to return `RealMLAdapter()` instead of `MockMLAdapter()`.

**Env vars to add (both services):**
```
ML_SERVICE_URL=http://localhost:8001
ML_MOCK_MODE=false
USE_MOCK_ML=false
```

---

## 11. Scripts — `scripts/`

### demo_scenarios.py — The 7-Scenario Smoke Test

`scripts/demo_scenarios.py` runs 7 hard-coded fraud scenarios directly through `FraudEngine.score()` (no HTTP call). Each scenario has an `expected_range` for the ml_score:

| Scenario | Description | Expected Score |
|---|---|---|
| NORMAL | Typical legitimate shipment, 120 history, known device | 0–30 |
| ACCOUNT_TAKEOVER | New device + payment + destination + recent password change + 2 AM booking | 60–100 |
| VOLUME_SPIKE | 8.2× normal daily volume on a known account | 50–100 |
| PAYMENT_FRAUD | Flagged payment, 5 prior frauds, foreign card, billing mismatch | 70–100 |
| DESTINATION_ANOMALY | High-risk reshipping hub, weight 3× avg, low address confidence | 50–100 |
| FRAUD_RING | Device linked to 5 accounts + confirmed fraud, new account, unverified | 70–100 |
| SEASONAL_LEGIT_SPIKE | Trusted shipper, 7× volume (Diwali surge) — **should NOT be high risk** | 0–50 |

The output is colour-coded (green = PASS, red = FAIL) and prints the top contributing reason for each scenario.

```powershell
python ml\scripts\demo_scenarios.py
# Expected: "All 7 scenarios passed!"
```

---

## 12. Tests — `tests/`

### test_leakage.py — The Critical Correctness Test

`tests/test_leakage.py` is the most important test in the codebase. It verifies the **no-future-leakage invariant** of the `ShipperState` digital twin:

```python
# Timeline: D1 used on day 1, D2 used on day 3

# Day 1: D1 is first-ever booking → empty history, is_new_device = False (no prior state)
f1 = s.compute_features(r1_with_D1, dt1, ...)
s.update(r1, dt1)  # NOW D1 is in history

# Day 2: D1 used again → NOT new (D1 was seen on day 1)
f2 = s.compute_features(r2_with_D1, dt2, ...)
assert f2['identity']['is_new_device'] == False  # ✓

# Day 3: D2 used → IS new (D2 never seen before)
f3 = s.compute_features(r3_with_D2, dt3, ...)
assert f3['identity']['is_new_device'] == True   # ✓
s.update(r3, dt3)  # NOW D2 is in history

# Day 4: D2 used again → no longer new
f4 = s.compute_features(r4_with_D2, dt4, ...)
assert f4['identity']['is_new_device'] == False  # ✓
```

If this test fails, the entire 50 MB dataset is contaminated with lookahead bias and all model metrics are meaningless.

### test_basic.py

A minimal import smoke test that verifies the Python module structure is intact after any code changes.

---

## 13. Configuration — `config.py`

`config.py` is the single source of truth for all paths, ports, and seeds. All other files import from here rather than hardcoding paths:

```python
BASE_DIR      = Path(__file__).resolve().parent    # ml/
DATA_DIR      = BASE_DIR / "data" / "out"          # ml/data/out/
ARTIFACTS_DIR = BASE_DIR / "artifacts"             # ml/artifacts/
DOCS_DIR      = BASE_DIR / "docs"                  # ml/docs/

PORT            = int(os.getenv("PORT", 8001))
MODEL_VERSION   = "v1"
DEFAULT_SEED    = 42
FRAUD_THRESHOLD = 0.5
```

`DATA_DIR` and `ARTIFACTS_DIR` are automatically created if they don't exist (via `mkdir(parents=True, exist_ok=True)` at import time).

---

## 14. Dependencies — `requirements.txt`

All dependencies are **version-pinned** for reproducibility:

| Package | Version | Role |
|---|---|---|
| `numpy` | 1.26.4 | Array operations, feature vectors |
| `pandas` | 2.2.1 | DataFrame operations for data generation and evaluation |
| `scikit-learn` | 1.4.1 | IsolationForest, IsotonicRegression, evaluation metrics |
| `lightgbm` | 4.3.0 | Primary fraud classifier |
| `fastapi` | 0.110.0 | HTTP microservice framework |
| `uvicorn` | 0.27.1 | ASGI server for FastAPI |
| `pydantic` | 2.6.4 | Request/response validation in FastAPI |
| `joblib` | 1.3.2 | Model serialisation (IForest, Calibrator) |
| `matplotlib` | 3.8.3 | Cost curve plot generation |
| `pytest` | 8.1.1 | Test runner |
| `httpx` | 0.27.0 | Async HTTP client (for testing FastAPI) |

Additionally requires `pyarrow` (not pinned) for Parquet file support in pandas.

---

## 15. How to Run Everything

### One-time Setup

```powershell
# From the project root
python -m venv ml\venv
ml\venv\Scripts\activate
pip install -r ml\requirements.txt
pip install pyarrow
```

### Generate Data

```powershell
# ~5 minutes. Generates ml/data/out/bookings.parquet (~50 MB)
python -m ml.data.generate --n-shippers 2000 --days 180 --out ml\data\out
```

### Train Models

```powershell
# ~2 minutes. Saves artifacts to ml/artifacts/v1/
# Logs ablation study results (Rules vs IForest vs Full Stack)
python -m ml.models.train
```

### Evaluate (Optional, generates EVAL.md)

```powershell
# Generates ml/docs/EVAL.md and ml/docs/figures/cost_curve.png
python -m ml.models.evaluate
```

### Smoke Test

```powershell
# Runs all 7 scenarios through the engine directly (no HTTP). Colour-coded output.
python ml\scripts\demo_scenarios.py
```

### Start the API Service

```powershell
# Keep this running in its own terminal
uvicorn ml.service.app:app --host 0.0.0.0 --port 8001

# Verify it's alive
curl http://localhost:8001/health
# → {"status":"ok","mock_mode":false,"model_loaded":true,"model_version":"v1"}

# To run in mock mode (no model needed)
$env:ML_MOCK_MODE='true'
uvicorn ml.service.app:app --host 0.0.0.0 --port 8001
```

### Run Tests

```powershell
pytest ml\tests\
```

### Rollback

If anything breaks, set mock mode and restart — zero effect on the ML model or data:

```powershell
$env:ML_MOCK_MODE='true'
# Restart uvicorn — system returns to original mock behaviour instantly
```

---

## 16. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FraudShield System                           │
│                                                                         │
│  ┌───────────────────────┐         ┌──────────────────────────────┐    │
│  │   Node.js Backend      │         │      Django Backend           │    │
│  │   (PORT 3000)          │         │      (PORT 8000)              │    │
│  │                       │         │                              │    │
│  │  featureGenerator.js  │         │  intelligence/               │    │
│  │       ↓               │         │  services/ml_service.py      │    │
│  │  fraudModel.js        │         │       ↓                      │    │
│  │  POST /score     ─────┼─────────┼── RealMLAdapter              │    │
│  │                       │         │  POST /predict  ──────────┐  │    │
│  └───────────────────────┘         └──────────────────────────┼──┘    │
│                                                               │         │
│                                                               ▼         │
│                    ┌──────────────────────────────────────────────────┐ │
│                    │         ML Microservice (PORT 8001)              │ │
│                    │                                                  │ │
│                    │  FastAPI app  (service/app.py)                   │ │
│                    │      ↓                                           │ │
│                    │  FraudEngine  (engine.py)                        │ │
│                    │      ├─ features/transform.py → float32 array    │ │
│                    │      ├─ IsolationForest → anomaly_score          │ │
│                    │      ├─ LightGBM → raw_pred + SHAP contribs      │ │
│                    │      └─ IsotonicRegression → fraud_probability   │ │
│                    │                                                  │ │
│                    │  Loaded from artifacts/v1/ at startup:           │ │
│                    │      model.txt / iforest.joblib / calibrator.joblib│ │
│                    └──────────────────────────────────────────────────┘ │
│                                                                         │
│  Training Pipeline (offline):                                           │
│  data/generate.py → data/out/bookings.parquet                          │
│       ↓                                                                 │
│  models/train.py → artifacts/v1/{model, iforest, calibrator}           │
│       ↓                                                                 │
│  models/evaluate.py → docs/EVAL.md + docs/figures/cost_curve.png       │
└─────────────────────────────────────────────────────────────────────────┘

Inference data flow for a new booking:
   Node/Django collects features
         → POST /score or /predict to port 8001
         → flatten_features() → 43 float32 values
         → IForest.decision_function() → anomaly_score (44th feature)
         → LightGBM.predict() → raw_pred + SHAP contributions
         → calibrator.predict() → fraud_probability ∈ [0, 1]
         → risk_level + top_reasons + feature_importances
         → JSON response back to caller
```

---

*Generated by reading every file in `ml/` end-to-end. All metrics are real numbers from the trained model.*
