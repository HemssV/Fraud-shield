# ML Integration Plan — FraudShield

> **Status:** Pre-integration audit complete. Ready to execute.
> **Scope:** Wire `ml/` (trained Python model) into the live Node.js and Django backends.
> **Risk:** Very low. Every change has a working fallback/rollback path.

---

## 0. What I Found: The Current State

### The project has three running processes:
| Process | Port | Language | Role |
|---|---|---|---|
| **Node.js backend** | 3000 | JS (Express) | Booking ingestion, fraud screening pipeline, DB persistence |
| **Django backend** | 8000 | Python (Django REST) | Intelligence dashboard, case management, simulators |
| **ML microservice** | 8001 | Python (FastAPI) | **Trained model — currently NOT started, NOT connected** |

### What the Node.js backend currently does at screening time:
In [`src/services/fraudScreeningService.js`](file:///c:/Users/HP/Desktop/SNUC/Hackathon/Fraud-shield/src/services/fraudScreeningService.js), line 62:
```javascript
// ─── STEP 5: Run ML Model ─────────────────────────────────────────────────
const mlResult = scoreShipment(features);
```
This calls [`src/ml/fraudModel.js`](file:///c:/Users/HP/Desktop/SNUC/Hackathon/Fraud-shield/src/ml/fraudModel.js) which is a **pure heuristic mock** — a hand-written scoring function using if-statements. It runs synchronously, returns fake probabilities, and has `model_version: 'fraud-xgb-v1'` as a string lie. **No trained model is called anywhere.**

### What the Django backend currently does:
In [`intelligence/services/ml_service.py`](file:///c:/Users/HP/Desktop/SNUC/Hackathon/Fraud-shield/intelligence/services/ml_service.py), the `RealMLAdapter.predict()` method raises:
```python
raise NotImplementedError("RealMLAdapter is not yet configured...")
```
Django is using `MockMLAdapter` because `USE_MOCK_ML=true` in `.env`. The `RealMLAdapter` body is a placeholder with an example comment. **No trained model is called anywhere.**

### What the ML module has:
- ✅ A **trained LightGBM model** + **Isolation Forest** + **Isotonic Calibrator** in `ml/artifacts/v1/`
- ✅ A **FastAPI service** in `ml/service/app.py` that loads and serves the model on port 8001
- ✅ A **drop-in replacement** for `src/ml/fraudModel.js` already written in `ml/integration/fraudModel.js.new`
- ✅ A **Django adapter class** already written in `ml/integration/ml_service_RealMLAdapter.py.snippet`
- ✅ Features from `featureGenerator.js` are **already in the exact shape** the ML service expects — the `features` dict with `behavioral`, `identity`, `payment`, `device`, `address`, `velocity` sub-objects is what `flatten_features()` in `ml/features/transform.py` reads

### The gap:
The integration code is written, sitting in `ml/integration/`. The connective tissue just hasn't been applied to the live files yet.

---

## 1. Integration Architecture (After)

```
User → POST /api/bookings (Node.js :3000)
           │
           ▼
   fraudScreeningService.js
           │
           ├── generateFeatures()       ← already correct, no change
           ├── evaluateRules()          ← already correct, no change
           │
           ▼
   fraudModel.js  [CHANGED]
      └── async scoreShipment()
              │ POST http://localhost:8001/score
              ▼
      ML Microservice (:8001) [NEW — start this process]
              └── FraudEngine.score()
                      ├── IsolationForest anomaly score
                      ├── LightGBM predict + SHAP contributions
                      └── Isotonic calibration → fraud_probability
              │
              ← returns: fraud_probability, ml_score, risk_level,
                         top_reasons, feature_importances, model_version
           │
           ▼
   aggregateRisk()              ← no change needed
   makeDecision()               ← no change needed
   saveRiskAssessment() to DB   ← no change needed


User → Django intelligence dashboard (:8000)
           │
           ▼
   simulator_service.py → get_ml_service().predict()
           │
           ▼
   ml_service.py  [CHANGED]
      └── RealMLAdapter.predict()
              │ POST http://localhost:8001/predict
              ▼
      ML Microservice (:8001) [same process as above]
              └── returns: fraud_probability, risk_score, risk_level, top_reasons
```

---

## 2. Exact Files That Will Change

| # | File | What changes | Lines affected |
|---|---|---|---|
| 1 | `src/ml/fraudModel.js` | **Replace entirely** with async version that calls ML service | All 172 lines → new 80-line file |
| 2 | `intelligence/services/ml_service.py` | **Replace `RealMLAdapter` class body** (4 lines → 35 lines) | Lines 122–146 |
| 3 | `fraudshield/settings.py` | **Add `ML_SERVICE_URL` setting** | 1 new line after line 113 |
| 4 | `.env.example` | **Add `ML_SERVICE_URL` and `ML_MOCK_MODE` vars** | 3 new lines |

That's it. 4 files. Nothing else in the project needs to change.

---

## 3. Step-by-Step Execution Plan

### Step 1 — Start the ML service (new terminal)
```powershell
cd "C:\Users\HP\Desktop\SNUC\Hackathon\Fraud-shield"
ml\venv\Scripts\activate
uvicorn ml.service.app:app --host 0.0.0.0 --port 8001
```
**Verify:** `curl http://localhost:8001/health`
Expected: `{"status":"ok","mock_mode":false,"model_loaded":true,"model_version":"v1"}`

> If `model_loaded` is `false`, the model files are missing. Run `python -m ml.models.train` first.

---

### Step 2 — Replace `src/ml/fraudModel.js` (Node.js side)

**File:** [`src/ml/fraudModel.js`](file:///c:/Users/HP/Desktop/SNUC/Hackathon/Fraud-shield/src/ml/fraudModel.js)

**What it is now:** A synchronous mock heuristic. The call at line 62 of `fraudScreeningService.js` is:
```javascript
const mlResult = scoreShipment(features);   // synchronous ❌
```

**What it will become:** An async function that calls `POST /score` on the ML service, with a 2-second timeout and automatic fallback to the local heuristic if the service is down.

**The new `fraudModel.js` will:**
1. Export `async function scoreShipment(features, shipment_id)` — same name, different signature (now async)
2. Read `ML_SERVICE_URL` and `ML_MOCK_MODE` from `process.env`
3. If `ML_MOCK_MODE=true` → run the local heuristic (unchanged, kept inside the file)
4. Otherwise → `axios.post(url + '/score', { shipment_id, features }, { timeout: 2000 })`
5. Map response fields to the shape `fraudScreeningService.js` expects: `{ fraud_probability, ml_score, feature_importances, model_version, scoring_ms }`
6. On any error → log a warning, run local heuristic as fallback, append `-fallback` to `model_version`

**One call-site change required in `fraudScreeningService.js` line 62:**
```javascript
// BEFORE (line 62):
const mlResult = scoreShipment(features);

// AFTER:
const mlResult = await scoreShipment(features, booking.shipment_id || bookingRef);
```
The parent function `screenShipment` is already `async` (it does DB calls), so `await` works with zero other changes.

**Source:** The content is already written in `ml/integration/fraudModel.js.new` — it just needs to be applied.

---

### Step 3 — Wire `RealMLAdapter` in Django (Django side)

**File:** [`intelligence/services/ml_service.py`](file:///c:/Users/HP/Desktop/SNUC/Hackathon/Fraud-shield/intelligence/services/ml_service.py)

**What it is now:** Lines 122–146 — `RealMLAdapter.predict()` raises `NotImplementedError`.

**What it will become:** A real implementation that:
1. Reads `settings.ML_SERVICE_URL` (e.g., `http://localhost:8001`)
2. Makes a `urllib.request` POST to `/predict` with `{ shipment_id, features }` payload
3. Has a 2-second timeout
4. On `URLError` → logs and re-raises (caught by `FraudMLService.predict()` which degrades to MEDIUM risk)
5. Returns `MLOutput(fraud_probability, risk_score, risk_level, top_reasons, raw=result)`

**The source content** is already written in `ml/integration/ml_service_RealMLAdapter.py.snippet`. It uses only `urllib` (stdlib) — no new dependencies.

**One settings change required in `fraudshield/settings.py` line 114:**
```python
# Add after ML_FRAUD_THRESHOLD line:
ML_SERVICE_URL = config('ML_SERVICE_URL', default='http://localhost:8001')
```

**One env flag change to activate it:**
In `.env` (or your actual env file): set `USE_MOCK_ML=false`

---

### Step 4 — Update `.env.example` and add your actual `.env` entries

Add to `.env.example` (documentation):
```
# ML Microservice
ML_SERVICE_URL=http://localhost:8001
ML_MOCK_MODE=false
USE_MOCK_ML=false
```

Add the same to your actual `.env` file (which isn't committed to git).

---

### Step 5 — Restart Node.js server

The Node.js server (`npm run dev` or `node src/server.js`) needs to be restarted so it picks up:
- The new `fraudModel.js` (async version)
- The new env vars (`ML_SERVICE_URL`, `ML_MOCK_MODE`)

---

### Step 6 — Verify end-to-end

**Test 1 — Normal booking through Node.js:**
```bash
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "shipper_id": "S1001",
    "origin": "Chennai",
    "destination": "Delhi",
    "weight": 10.0,
    "service_type": "GROUND",
    "payment_id": "P1",
    "device_id": "D1",
    "package_count": 1
  }'
```
**Expected:** `fraud_assessment.model.model_version` should be `"v1"` (not `"fraud-xgb-v1"` or `"mock"`).

**Test 2 — High-risk booking through Node.js:**
```bash
curl -X POST http://localhost:3000/api/fraud/screen \
  -H "Content-Type: application/json" \
  -d '{
    "shipper_id": "S9999",
    "origin": "Chennai",
    "destination": "Unknown City",
    "weight": 500.0,
    "service_type": "EXPRESS",
    "payment_id": "STOLEN_PAY_1",
    "device_id": "ATTACKER_DEV_1",
    "package_count": 50,
    "booking_timestamp": "2026-10-03T02:00:00Z"
  }'
```
**Expected:** `fraud_assessment.risk.fraud_probability > 0.5`, `decision.action` = `REVIEW` or `BLOCK`.

**Test 3 — Django simulator:**
Run a scenario from the Django admin/API — `ACCOUNT_TAKEOVER` should now return real model scores with `model_version: "v1"`.

---

## 4. Feature Shape Compatibility — Why This Works Without Glue Code

This is the key question: does the feature shape from `featureGenerator.js` match what the ML model expects?

**Answer: Yes — by design.** Here is the proof:

The ML model was built to consume the exact output of `featureGenerator.js`. Compare:

**`featureGenerator.js` output structure:**
```json
{
  "behavioral": { "weight_z_score": 0.1, "weight_ratio_to_avg": 1.0, ... },
  "identity":   { "is_new_device": false, "account_age_days": 365, ... },
  "payment":    { "payment_found": true, "is_new_payment_method": false, ... },
  "device":     { "device_found": true, "known_device": true, ... },
  "address":    { "address_found": true, "confidence_score": 0.95, ... },
  "velocity":   { "booking_hour": 14, "volume_spike_detected": false, ... },
  "_meta":      { "feature_generation_ms": 2 }
}
```

**`ml/features/schema.py` FEATURE_SPEC — what the model reads:**
```python
{
  "behavioral": { "weight_z_score": 0.0, "weight_ratio_to_avg": 1.0, ... },
  "identity":   { "is_new_device": False, "account_age_days": 0, ... },
  "payment":    { "payment_found": False, "is_new_payment_method": True, ... },
  "device":     { "device_found": False, "known_device": False, ... },
  "address":    { "address_found": False, "confidence_score": 0.30, ... },
  "velocity":   { "booking_hour": 12, "volume_spike_detected": False, ... }
}
```

Every key matches. `_meta` is ignored by `flatten_features()` because it's not in `FEATURE_SPEC`. Missing keys fall back to safe defaults. String-type features (`account_status`, `ip_country`, `risk_tier`) are skipped by the model (it only uses scalars). **Zero glue code needed.**

---

## 5. Rollback Plan (If Anything Goes Wrong)

Every change is independently reversible:

| Change | Rollback |
|---|---|
| `src/ml/fraudModel.js` replaced | Restore from `src/ml/fraudModel.js.bak` (we create this before replacing) |
| `USE_MOCK_ML=false` in `.env` | Set `USE_MOCK_ML=true` — Django instantly returns to `MockMLAdapter` |
| `ML_MOCK_MODE=false` in `.env` | Set `ML_MOCK_MODE=true` — Node.js instantly returns to local heuristic |
| ML service crashes | Node.js `fraudModel.js` auto-falls back to local heuristic within 2 seconds |
| ML service not started | Same auto-fallback in 2 seconds |

**The system degrades gracefully in every failure scenario.** Nothing breaks if the ML service is down.

---

## 6. What Does NOT Change

These files are untouched:

- `src/features/featureGenerator.js` — feature shape is already correct
- `src/services/fraudScreeningService.js` — only line 62 gets `await` added
- `src/rules/ruleEngine.js` — entirely separate pipeline component
- `intelligence/services/simulator_service.py` — already calls `get_ml_service()` correctly
- `intelligence/services/case_service.py`, `analytics_service.py`, etc. — unaffected
- All Django models, migrations, views — unaffected
- The frontend — unaffected (it only reads the JSON that Node.js returns)
- The database schema — unaffected

---

## 7. Post-Integration: What the Live System Will Do Differently

| Scenario | Before Integration | After Integration |
|---|---|---|
| Normal booking | Heuristic mock score (~15) | LightGBM calibrated probability (typically <0.3 → score <30) |
| Account takeover signals | Mock assigns fixed point values | LightGBM learned from 278 training examples; SHAP explains exactly which feature drove the score |
| Volume attack (50x normal) | Mock applies `volume_spike` rule | IForest detects anomaly → LightGBM scores ≥0.7 → BLOCK decision |
| Fraud ring (shared device) | Mock adds `device_linked` points | `accounts_linked=5 + device_linked_to_fraud=True` → LightGBM scores ~1.0 |
| Trusted shipper Diwali surge | Mock flags as high risk | Model learned from hard negatives → scores LOW/MEDIUM correctly |
| `model_version` in DB | `"fraud-xgb-v1"` (lie) | `"v1"` (real model version from metadata.json) |
| Scoring latency | ~0ms (pure JS math) | ~5–15ms (HTTP to localhost + LightGBM inference) |
| `feature_importances` returned | Raw point breakdown from mock | Normalised SHAP contribution percentages from LightGBM |

---

## 8. Files I Will Actually Edit (Summary)

### Edit 1 — `src/ml/fraudModel.js`
**Action:** Replace entire file with async version.
**Source content:** `ml/integration/fraudModel.js.new` (already written).
**Backup:** Will create `src/ml/fraudModel.js.bak` first.

### Edit 2 — `src/services/fraudScreeningService.js` line 62
**Action:** Add `await` to the `scoreShipment()` call.
**Change:** `const mlResult = scoreShipment(features);` → `const mlResult = await scoreShipment(features, booking.shipment_id || bookingRef);`
**One line change.**

### Edit 3 — `intelligence/services/ml_service.py` lines 122–146
**Action:** Replace `RealMLAdapter.predict()` stub with real HTTP implementation.
**Source content:** `ml/integration/ml_service_RealMLAdapter.py.snippet` (already written).

### Edit 4 — `fraudshield/settings.py` line 114
**Action:** Add `ML_SERVICE_URL = config('ML_SERVICE_URL', default='http://localhost:8001')`.
**One line addition.**

### Edit 5 — `.env.example` (documentation)
**Action:** Add `ML_SERVICE_URL`, `ML_MOCK_MODE`, and update `USE_MOCK_ML` default note.

### Step — Start ML service process
**Action:** Run `uvicorn ml.service.app:app --host 0.0.0.0 --port 8001` in a new terminal with the venv active.
**This is not a code change — it's a new process to run alongside Node.js and Django.**

---

## 9. Checklist to Confirm Everything Works

After executing all steps above:

- [ ] `curl http://localhost:8001/health` → `"model_loaded": true`
- [ ] Node.js `POST /api/bookings` (normal) → `fraud_assessment.model.model_version = "v1"`
- [ ] Node.js `POST /api/bookings` (normal) → `fraud_assessment.risk.fraud_probability < 0.3`
- [ ] Node.js `POST /api/fraud/screen` (high risk) → `decision.action` = `REVIEW` or `BLOCK`
- [ ] `feature_importances` in Node.js response has non-zero `behavioral`, `identity`, `payment`, `device` keys
- [ ] Django simulator `ACCOUNT_TAKEOVER` returns `risk_level: HIGH` or `CRITICAL`
- [ ] Kill the ML service → next Node.js booking succeeds with `model_version: "v1-mock-fallback"` (graceful degradation)
- [ ] Set `ML_MOCK_MODE=true` → Node.js returns `model_version: "fraud-xgb-v1-mock"` instantly

---

*Ready to execute. All integration code is pre-written and sitting in `ml/integration/`. The plan above is purely mechanical application of those files to the live codebase.*
