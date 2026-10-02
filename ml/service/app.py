import json
import os
import time
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
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
