# FraudShield — Backend Person B: Intelligence & Operations API

> **"The fraud engine has already assessed the shipment. This service makes the result explainable, investigable, auditable, actionable, and useful for the operations team."**

---

## What This Service Implements

| Area | Responsibility |
|------|---------------|
| **ML Integration** | Clean adapter wrapping Person 1's model; mock available out-of-the-box |
| **GenAI Fraud Copilot** | Gemini-powered natural language explanation of fraud signals |
| **Fraud Graph** | PostgreSQL + NetworkX entity relationship graph; fraud ring detection |
| **Investigation / Cases** | Full case lifecycle: open → assign → review → decide → close |
| **Analyst Decision** | Override/confirm automated decisions with preserved audit chain |
| **Audit Log** | Hash-chained, append-only audit trail for every operation |
| **Analyst Feedback** | Stores outcome data for ML model retraining |
| **Dashboard Analytics** | Summary, daily trend, review queue, recent alerts, fraud type breakdown |
| **Scenario Simulator** | 7 named fraud scenarios run through the real pipeline (not hardcoded) |

---

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env as needed (defaults work for SQLite dev mode)
```

### 3. Run migrations

```bash
python manage.py migrate
```

### 4. Start the server

```bash
python manage.py runserver
```

### 5. Run tests

```bash
python manage.py test intelligence -v 2
```

All **48 tests** should pass.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | dev key | Django secret key |
| `DEBUG` | `True` | Debug mode |
| `ALLOWED_HOSTS` | `127.0.0.1,localhost` | Comma-separated allowed hosts |
| `DATABASE_URL` | `sqlite:///fraudshield_dev.db` | PostgreSQL or SQLite URL |
| `USE_MOCK_ML` | `true` | Use deterministic mock ML (no model needed) |
| `USE_MOCK_GENAI` | `true` | Use deterministic mock explanation (no API key needed) |
| `GEMINI_API_KEY` | _(empty)_ | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model to use |
| `ML_FRAUD_THRESHOLD` | `0.5` | Fraud probability threshold |

---

## Database

This service maps to the **FraudShield PostgreSQL schema** (the DDL file is the source of truth).

### Using PostgreSQL (production/full demo)

```env
DATABASE_URL=postgres://fraudshield:password@localhost:5432/fraudshield
```

Run the DDL SQL first, then:

```bash
python manage.py migrate --fake-initial  # tells Django the tables already exist
```

### Using SQLite (dev/test)

```env
DATABASE_URL=sqlite:///fraudshield_dev.db
```

```bash
python manage.py migrate  # creates all tables fresh
```

---

## API Endpoints

All endpoints are under `/api/v1/`.

### ML Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/ml/predict/` | Predict fraud probability from features |

**Request:**
```json
{
  "shipment_id": "S1002",
  "features": {
    "volume_ratio": 8.2,
    "new_device": true,
    "new_destination": true,
    "new_payment": true,
    "weight_deviation": 2.4
  }
}
```

**Response:**
```json
{
  "fraud_probability": 0.87,
  "risk_score": 87.0,
  "risk_level": "HIGH",
  "top_reasons": ["volume_spike", "new_device", "new_destination"]
}
```

---

### GenAI Fraud Copilot

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/fraud/explain/` | Generate natural language fraud explanation |

**Request:**
```json
{ "assessment_id": "uuid-here" }
```

**Response:**
```json
{
  "explanation_id": "...",
  "assessment_id": "...",
  "llm_model": "mock",
  "summary": "This shipment received a HIGH risk score of 87/100...",
  "recommended_actions": ["Verify account ownership.", "Confirm payment method."],
  "grounded_reason_ids": [1, 2, 3],
  "generated_at": "2026-10-01T..."
}
```

---

### Fraud Graph

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/fraud-graph/account/{account_id}/` | Account entity relationship graph |
| `POST` | `/api/v1/fraud-graph/detect-rings/` | Trigger fraud ring detection |

---

### Cases / Investigation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/cases/` | List cases (filter by `?status=OPEN`) |
| `GET` | `/api/v1/cases/{case_id}/` | Full investigation bundle |
| `POST` | `/api/v1/cases/{case_id}/assign/` | Assign to analyst |
| `POST` | `/api/v1/cases/{case_id}/decision/` | Record analyst decision |
| `POST` | `/api/v1/cases/{case_id}/close/` | Close case |

**Assign request:**
```json
{ "staff_user_id": "uuid-here" }
```

**Decision request:**
```json
{
  "verdict": "CONFIRMED_FRAUD",
  "action": "BLOCK",
  "reason": "Account takeover confirmed via device fingerprint match.",
  "notes": "Device and payment shared with 2 other flagged accounts.",
  "fraud_type": "ACCOUNT_TAKEOVER",
  "staff_user_id": "uuid-here"
}
```

Valid verdicts: `CONFIRMED_FRAUD` | `FALSE_POSITIVE` | `INCONCLUSIVE`  
Valid actions: `ALLOW` | `ALLOW_MONITOR` | `VERIFY` | `REVIEW` | `BLOCK`

---

### Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/audit/shipment/{shipment_id}/` | Chronological audit trail |

---

### Dashboard Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/dashboard/summary/` | KPI summary |
| `GET` | `/api/v1/dashboard/daily/?days=7` | Daily trend |
| `GET` | `/api/v1/dashboard/review-queue/` | Cases needing analyst attention |
| `GET` | `/api/v1/dashboard/recent-alerts/` | Latest high-risk assessments |
| `GET` | `/api/v1/dashboard/fraud-types/` | Confirmed fraud type breakdown |

---

### Scenario Simulator

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/simulator/run/` | Run a named fraud scenario |

**Request:**
```json
{ "scenario": "ACCOUNT_TAKEOVER" }
```

Valid scenarios: `NORMAL` | `ACCOUNT_TAKEOVER` | `VOLUME_SPIKE` | `PAYMENT_FRAUD` | `DESTINATION_ANOMALY` | `FRAUD_RING` | `SEASONAL_LEGIT_SPIKE`

---

## Person A Integration Instructions

Backend Person A owns the core fraud screening pipeline. Here is exactly where to plug in.

### 1. ML Model Integration

**File:** `intelligence/services/ml_service.py`

Implement `RealMLAdapter.predict()`:

```python
class RealMLAdapter:
    def predict(self, ml_input: MLInput) -> MLOutput:
        # Import your model here
        import joblib
        model = joblib.load('/path/to/your/model.pkl')
        
        feature_values = list(ml_input.features.values())
        prob = model.predict_proba([feature_values])[0][1]
        
        return MLOutput(
            fraud_probability=prob,
            top_reasons=['volume_spike', 'new_device'],  # from SHAP or feature importance
        )
```

Then in `.env`:
```env
USE_MOCK_ML=false
```

That's it. No other code changes needed.

### 2. Risk Assessment Integration

When Person A's pipeline produces a risk assessment + decision, save them to:
- `risk_assessments` table
- `risk_reasons` table  
- `decisions` table

Backend B automatically picks them up for:
- Case management (`fraud_cases`)
- GenAI explanation (`genai_explanations`)
- Dashboard metrics
- Audit trail

### 3. Agreed Integration Contract

```json
{
  "shipment_id": "S1002",
  "risk_score": 87,
  "risk_level": "HIGH",
  "action": "BLOCK",
  "reasons": [
    {"code": "NEW_DEVICE", "points": 20, "description": "New device detected."}
  ],
  "ml_probability": 0.87
}
```

---

## Frontend Integration Instructions

**Base URL:** `http://localhost:8000/api/v1/`

### Main Demo Flow

1. `POST /api/v1/simulator/run/` → `{"scenario": "ACCOUNT_TAKEOVER"}`
2. Grab `assessment_id` and `case_id` from response
3. `GET /api/v1/cases/{case_id}/` → full investigation bundle
4. `GET /api/v1/fraud-graph/account/{account_id}/` → graph data
5. `POST /api/v1/fraud/explain/` → `{"assessment_id": "..."}` → GenAI summary
6. `POST /api/v1/cases/{case_id}/decision/` → analyst confirms fraud
7. `GET /api/v1/audit/shipment/{shipment_id}/` → full audit trail
8. `GET /api/v1/dashboard/summary/` → updated dashboard metrics

### Dashboard Polling

```js
// Refresh every 5 seconds during demo
setInterval(() => fetch('/api/v1/dashboard/summary/'), 5000)
```

### Error Format

All errors return:
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Fraud case does not exist."
  }
}
```

---

## Demo Instructions

### Start the server

```bash
cp .env.example .env   # use defaults
python manage.py migrate
python manage.py runserver
```

### Scenario 1 — Normal shipment (expect ALLOW)

```bash
curl -s -X POST http://localhost:8000/api/v1/simulator/run/ \
  -H "Content-Type: application/json" \
  -d '{"scenario": "NORMAL"}'
```

### Scenario 2 — Volume spike (expect HIGH risk)

```bash
curl -s -X POST http://localhost:8000/api/v1/simulator/run/ \
  -H "Content-Type: application/json" \
  -d '{"scenario": "VOLUME_SPIKE"}'
```

### Scenario 3 — Account takeover (expect HIGH risk + case opened)

```bash
curl -s -X POST http://localhost:8000/api/v1/simulator/run/ \
  -H "Content-Type: application/json" \
  -d '{"scenario": "ACCOUNT_TAKEOVER"}'
```

Copy the `case_id` from the response, then:

```bash
# View full investigation
curl -s http://localhost:8000/api/v1/cases/{case_id}/

# Generate GenAI explanation
curl -s -X POST http://localhost:8000/api/v1/fraud/explain/ \
  -H "Content-Type: application/json" \
  -d '{"assessment_id": "{assessment_id}"}'

# Analyst confirms fraud
curl -s -X POST http://localhost:8000/api/v1/cases/{case_id}/decision/ \
  -H "Content-Type: application/json" \
  -d '{
    "verdict": "CONFIRMED_FRAUD",
    "action": "BLOCK",
    "reason": "Account takeover confirmed",
    "fraud_type": "ACCOUNT_TAKEOVER"
  }'
```

### Scenario 4 — Fraud ring (3 accounts, shared device + payment)

```bash
curl -s -X POST http://localhost:8000/api/v1/simulator/run/ \
  -H "Content-Type: application/json" \
  -d '{"scenario": "FRAUD_RING"}'
```

### Dashboard (after running scenarios)

```bash
curl -s http://localhost:8000/api/v1/dashboard/summary/
curl -s http://localhost:8000/api/v1/dashboard/review-queue/
```

### Enable real GenAI

```env
USE_MOCK_GENAI=false
GEMINI_API_KEY=your-key-here
```

---

## Project Structure

```
fraudshield/          ← Django project config
  settings.py
  urls.py

intelligence/         ← Backend Person B Django app
  models.py           ← All FraudShield models (maps to PostgreSQL schema)
  tests.py            ← 48 tests

  api/
    views.py          ← 17 API endpoints
    serializers.py    ← Input validation
    urls.py           ← URL routing
    exceptions.py     ← Structured error responses

  services/
    ml_service.py         ← ML adapter (mock/real switching)
    genai_service.py      ← Gemini integration (grounded explanation only)
    fraud_graph_service.py ← NetworkX graph + fraud ring detection
    case_service.py       ← Case lifecycle management
    audit_service.py      ← Hash-chained audit log
    analytics_service.py  ← Dashboard metrics
    simulator_service.py  ← 7 fraud scenario runners

  migrations/
    0001_initial.py
```
