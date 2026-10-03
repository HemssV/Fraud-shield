# Codebase Audit (Phase 0)

## 1. Actual File Map
The system is divided into four main components:
- **`frontend/`**: React + Vite SPA. Contains components for screening, dashboards, and investigations (`src/pages/Screening.jsx`, etc.).
- **`src/`**: Node.js / Express screening engine (Core Pipeline, Port 3000).
  - `src/server.js`: Express entry point.
  - `src/services/fraudScreeningService.js`: Core pipeline orchestration.
  - `src/features/featureGenerator.js`: Feature computation logic.
  - `src/rules/ruleEngine.js`: Deterministic rules.
  - `src/ml/fraudModel.js`: Interface to ML service.
  - `src/db/`: Neon PostgreSQL repository and connection logic.
- **`ml/`**: FastAPI Python service (Port 8001) for LightGBM and Isolation Forest inference.
- **`intelligence/`** (Django): Python backend (Port 8000) for GenAI Copilot (Gemini), graph analytics, and case management.

## 2. Feature Computation and Ordering
**How they are computed:** Features are generated in `src/features/featureGenerator.js` by calling separate functions for behavioral, identity, payment, device, address, and velocity signals. 
**Order:** They are returned as a nested object (grouped by category), not as a canonical ordered array of 41 items. Some features like `days_until_departure` and `route_entropy` are missing entirely.
**Clipping/Bounding:** Currently missing.

## 3. Score Combination (Rules/ML/Graph)
Located in `src/services/fraudScreeningService.js -> aggregateRisk()`:
```javascript
const ruleComponent = ruleResult.rule_score * 0.40;
const mlComponent = mlResult.ml_score * 0.40;
const graphComponent = (deviceSignals?.risk_score || 0) * 0.20;
let riskScore = ruleComponent + mlComponent + graphComponent;
```
Hard overrides (is_suspended, blacklisted IP/device, previous_fraud_cases >= 3) apply a max operation (e.g. `Math.max(riskScore, 85)`).
**Missing:** Handling degraded mode (when ML fails, it currently assumes 0 or crashes, rather than re-normalizing weights to 0.4/0.6 and 0.2/0.6).

## 4. Frontend Demo Buttons
In `frontend/src/pages/Screening.jsx`, the demo buttons are backed by a hardcoded `PRESETS` array. Clicking a preset triggers `loadPreset()`, which populates the React form state (`formData`). The form is then submitted as a single booking request to the backend. It does NOT use CSV files or uploads.

## 5. CSV Upload Status
**Missing entirely.** There is no CSV upload API endpoint in the Node backend, no `POST /api/csv/upload` route, and no CSV handling logic in the frontend.

## 6. Issues Handled vs. Missing
- **1.1 Null safety:** Missing robust handling; relies on mockData fallbacks.
- **1.2 Time math / 1.3 Route entropy / 1.4 Velocity z-scores:** Missing or heavily simplified.
- **1.5 Feature bounds / 1.6 Canonical order:** Missing.
- **1.7 Score combination fallback:** Missing proper renormalization.
- **1.8 Advisory locks:** Missing.
- **2.1 Shared Validator / 2.2 Past departure dates / 2.3 Structured errors:** Missing.
- **3.1 Pool config / 3.2 Audit log table migration / 3.3 Health checks:** Missing.
- **3.4 Security basics:** Partially missing (Helmet, rate limits, CORS).
- **4.x ML Training/Parity:** Synthetic data generator, parity script, metadata.json are missing.
- **5.x Adaptive Profiling:** Missing max age limit and familiar discounts logic.
- **6.x Rules Engine Constants / Tests:** Rules are hardcoded, unit tests missing.
- **7.x CSV Upload:** Completely missing.
- **8.x Automated Tests:** Missing.
