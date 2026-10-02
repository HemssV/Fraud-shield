# FraudShield ML Module — Merge Guide

> This guide is written for the Node.js teammate and the Django teammate.
> The ML engineer has verified all steps on a fresh Windows machine (Python 3.12, PowerShell).
> Everything is self-contained inside `ml/`. You touch **exactly 3 files** outside `ml/`.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Python | 3.10 or 3.11 | `python --version` |
| pip | latest | `python -m pip --version` |
| PowerShell | 5.1+ | (default on Win 10/11) |
| Node.js | already running | — |
| npm | already running | — |

---

## 2. Set Up the ML Service (One-time)

Open a **new PowerShell terminal** in the project root.

```powershell
# 1. Create and activate venv
python -m venv ml\venv
ml\venv\Scripts\activate

# 2. Install dependencies
pip install -r ml\requirements.txt
pip install pyarrow   # Needed for Parquet support

# 3. Generate training data (~5 min for 2000 shippers x 180 days)
python -m ml.data.generate --n-shippers 2000 --days 180 --out ml\data\out

# 4. Train models (~2 min)
python -m ml.models.train

# 5. Verify: run all 7 demo scenarios
python ml\scripts\demo_scenarios.py
# Expected: "All 7 scenarios passed!"
```

---

## 3. Run the API Service

```powershell
# Keep this running in its own terminal
uvicorn ml.service.app:app --host 0.0.0.0 --port 8001

# To run in mock mode (skip ML, return dummy scores):
$env:ML_MOCK_MODE='true'; uvicorn ml.service.app:app --host 0.0.0.0 --port 8001
```

Verify it's alive:
```powershell
curl http://localhost:8001/health
```

Expected response:
```json
{"status":"ok","mock_mode":false,"model_loaded":true,"model_version":"v1"}
```

---

## 4. Node.js Backend Changes (3 files, low-risk)

### Step 1: Replace `src/ml/fraudModel.js`

```powershell
# Backup the original (safe — no git required)
copy src\ml\fraudModel.js src\ml\fraudModel.js.bak

# Apply the new version
copy ml\integration\fraudModel.js.new src\ml\fraudModel.js
```

The new file is a **drop-in replacement**. The function signature is identical:
```
scoreShipment(features, shipment_id?) → Promise<MLResult>
```
The only behavioral change: it calls `http://localhost:8001/score` first, then **gracefully falls back** to the original mock logic if the ML service is down or slow.

### Step 2: Install `axios` (if not already present)

```powershell
npm list axios || npm install axios
```

### Step 3: Add env vars to `.env`

Append to your `.env` file:
```
ML_SERVICE_URL=http://localhost:8001
ML_MOCK_MODE=false
```

### Step 4: Verify the call site is `async`

Check wherever `scoreShipment(features)` is called in `src/` — it must be `await`ed:
```javascript
// Before (if synchronous):
const mlResult = scoreShipment(features);

// After (must be):
const mlResult = await scoreShipment(features, booking.id);
```
The parent function must be `async`. See `ml/integration/node_patch.md` for details.

---

## 5. Django Backend Changes (1 file)

### Step 1: Add `ML_SERVICE_URL` to Django settings

In `intelligence/settings.py` (or wherever `USE_MOCK_ML` is defined), add:
```python
ML_SERVICE_URL = os.getenv('ML_SERVICE_URL', 'http://localhost:8001')
```

### Step 2: Swap `MockMLAdapter` → `RealMLAdapter`

Open `intelligence/services/ml_service.py`.

1. Copy the class from `ml/integration/ml_service_RealMLAdapter.py.snippet` and paste it into the file.
2. In `get_ml_service()`, change the condition:
```python
# Before:
if settings.USE_MOCK_ML:
    return MockMLAdapter()
return MockMLAdapter()  # ← was placeholder

# After:
if settings.USE_MOCK_ML:
    return MockMLAdapter()
return RealMLAdapter()  # ← now real
```

### Step 3: Add env var to `.env`
```
ML_SERVICE_URL=http://localhost:8001
USE_MOCK_ML=false
```

---

## 6. Rollback Plan

If anything breaks, **the ML service has zero effect** when `ML_MOCK_MODE=true`. Set this env var and restart — the system will return to the original mock behavior instantly.

For Node.js: restore `fraudModel.js` from the backup:
```powershell
copy src\ml\fraudModel.js.bak src\ml\fraudModel.js
```

---

## 7. Verification Checklist

After merging, run through this checklist:

- [ ] `curl http://localhost:8001/health` returns `"status":"ok"`
- [ ] `POST /api/bookings` with a normal payload returns `fraud_probability < 0.3`
- [ ] `POST /api/fraud/screen` with a high-risk payload returns `fraud_probability > 0.7`
- [ ] Restart `uvicorn` after `npm install` — they are independent processes
- [ ] Set `ML_MOCK_MODE=true`, confirm Node fallback works (no ML service needed)
- [ ] Set `USE_MOCK_ML=true` in Django, confirm fallback works

---

## 8. ML Module File Map

```
ml/
├── README.md                          # Setup & commands
├── config.py                          # Paths, ports, seeds
├── requirements.txt                   # Frozen Python deps
├── engine.py                          # FraudEngine class (IForest + LightGBM + Calibration)
├── data/
│   ├── generate.py                    # Synthetic data generator (no-DB)
│   └── out/                           # Generated CSVs/Parquets (gitignored)
├── features/
│   ├── schema.py                      # FEATURE_SPEC dict + ORDERED_FEATURE_NAMES
│   └── transform.py                  # Flatten nested features dict → numpy array
├── models/
│   ├── train.py                       # Train IForest + LightGBM + Calibrator
│   ├── evaluate.py                    # Metrics, cost curve, EVAL.md
│   └── policy.py                      # (placeholder for future threshold tuning)
├── service/
│   └── app.py                         # FastAPI service with /health, /score, /predict, /feedback
├── artifacts/
│   └── v1/
│       ├── model.txt                  # LightGBM model
│       ├── iforest.joblib             # Isolation Forest
│       ├── calibrator.joblib          # Isotonic Regression calibrator
│       ├── feature_spec.json          # Feature schema snapshot
│       ├── thresholds.json            # Risk thresholds
│       └── metadata.json             # Train metadata + metrics
├── integration/
│   ├── fraudModel.js.new              # Drop-in replacement for src/ml/fraudModel.js
│   ├── ml_service_RealMLAdapter.py.snippet  # Django RealMLAdapter class
│   ├── node_patch.md                  # Node.js call site notes
│   ├── env_additions.txt              # New env vars for .env
│   └── OPTIONAL_booking_schema_additions.md
├── scripts/
│   ├── demo_scenarios.py              # 7-scenario smoke test (color-coded output)
│   └── retrain.py                     # (placeholder)
├── tests/
│   ├── test_basic.py                  # Import smoke test
│   └── test_leakage.py               # Verifies no future data leakage
└── docs/
    ├── RECON.md                       # Phase 0: codebase analysis
    ├── ASSUMPTIONS.md                 # Design decisions
    ├── EVAL.md                        # Generated evaluation report
    └── figures/
        └── cost_curve.png             # Cost vs Threshold plot
```
