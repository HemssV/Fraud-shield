import json
import os
import time
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ml.config import DATA_DIR
from ml.engine import FraudEngine

app = FastAPI(title="FraudShield ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = FraudEngine()
MOCK_MODE = os.getenv("ML_MOCK_MODE", "false").lower() == "true"

class ScoreRequest(BaseModel):
    shipment_id: str
    features: Dict[str, Any]
    context: Optional[Dict[str, Any]] = None

class FeedbackRequest(BaseModel):
    shipment_id: str
    label: int
    fraud_type: Optional[str] = None


def _service_status() -> dict:
    return {
        "service": "FraudShield ML Service",
        "status": "ok",
        "mock_mode": MOCK_MODE,
        "model_loaded": not engine.degraded,
        "model_version": engine.version,
        "endpoints": {
            "health": "GET /health",
            "model_info": "GET /model-info",
            "score": "POST /score",
            "predict": "POST /predict",
            "feedback": "POST /feedback",
            "openapi": "GET /openapi.json",
            "docs": "GET /docs",
        },
    }


@app.get("/")
def root(request: Request):
    """Browser-friendly landing; JSON for API clients."""
    accept = request.headers.get("accept", "")
    if "text/html" in accept and "application/json" not in accept:
        status = _service_status()
        loaded = "yes" if status["model_loaded"] else "no (degraded)"
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>FraudShield ML Service</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }}
    h1 {{ font-size: 1.35rem; }}
    code {{ background: #f4f4f5; padding: 0.1rem 0.35rem; border-radius: 4px; }}
    a {{ color: #2563eb; }}
    .ok {{ color: #16a34a; font-weight: 600; }}
  </style>
</head>
<body>
  <h1>FraudShield ML Service</h1>
  <p class="ok">Running — model {status["model_version"]} loaded: {loaded}</p>
  <ul>
    <li><a href="/docs">Interactive API docs</a> (<code>/docs</code>)</li>
    <li><a href="/health">Health check</a> (<code>/health</code>)</li>
    <li><a href="/model-info">Model info</a> (<code>/model-info</code>)</li>
  </ul>
  <p>Scoring: <code>POST /score</code> · Django adapter: <code>POST /predict</code></p>
</body>
</html>"""
        return HTMLResponse(html)
    return _service_status()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "mock_mode": MOCK_MODE,
        "model_loaded": not engine.degraded,
        "model_version": engine.version
    }

@app.get("/model-info")
def model_info():
    from ml.features.schema import FEATURE_SPEC
    return {
        "version": engine.version,
        "mock_mode": MOCK_MODE,
        "thresholds": getattr(engine, 'thresholds', {}),
        "feature_spec": FEATURE_SPEC
    }

@app.post("/score")
def score(req: ScoreRequest):
    if MOCK_MODE:
        time.sleep(0.01)
        return {
            "fraud_probability": 0.15,
            "ml_score": 15.0,
            "risk_score": 15.0,
            "risk_level": "LOW",
            "top_reasons": ["mock_mode_active"],
            "feature_importances": {"behavioral": 20, "identity": 20, "payment": 20, "device": 20, "address": 20},
            "anomaly_score": 0.1,
            "suggested_fraud_type": "OTHER",
            "model_version": "mock-v1",
            "scoring_ms": 10
        }
    return engine.score(req.features, req.context)

@app.post("/predict")
def predict(req: ScoreRequest):
    # Django shape
    if MOCK_MODE:
        time.sleep(0.01)
        return {
            "fraud_probability": 0.15,
            "risk_score": 15.0,
            "risk_level": "LOW",
            "top_reasons": ["mock_mode_active"]
        }
        
    res = engine.score(req.features, req.context)
    return {
        "fraud_probability": res["fraud_probability"],
        "risk_score": res["risk_score"],
        "risk_level": res["risk_level"],
        "top_reasons": res["top_reasons"]
    }

def append_feedback(req: FeedbackRequest):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fb_file = DATA_DIR / "feedback.jsonl"
    with open(fb_file, "a") as f:
        f.write(req.model_dump_json() + "\n")

@app.post("/feedback")
def feedback(req: FeedbackRequest, bg: BackgroundTasks):
    bg.add_task(append_feedback, req)
    return {"status": "recorded"}

if __name__ == "__main__":
    import uvicorn
    # Allow running directly for debug
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8001)))
