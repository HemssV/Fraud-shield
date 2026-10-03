import json
import logging
from typing import Dict, Any, Optional

import joblib
import lightgbm as lgb
import numpy as np

from ml.config import ARTIFACTS_DIR
from ml.features.schema import ORDERED_FEATURE_NAMES, FEATURE_SPEC
from ml.features.transform import flatten_features

log = logging.getLogger(__name__)

class FraudEngine:
    def __init__(self, version="v1"):
        self.version = version
        model_dir = ARTIFACTS_DIR / version
        
        if not model_dir.exists():
            log.warning(f"Model dir {model_dir} not found. Running in degradation mode.")
            self.degraded = True
            return
            
        self.lgb_model = lgb.Booster(model_file=str(model_dir / "model.txt"))
        self.iforest = joblib.load(model_dir / "iforest.joblib")
        self.calibrator = joblib.load(model_dir / "calibrator.joblib")
        
        with open(model_dir / "thresholds.json") as f:
            self.thresholds = json.load(f)
            
        self.degraded = False
        self.bev_vel_idx = [i for i, f in enumerate(ORDERED_FEATURE_NAMES) if f.startswith('behavioral_') or f.startswith('velocity_')]
        
    def _get_top_reasons(self, flat_features: np.ndarray, pred_contrib: np.ndarray) -> list:
        # pred_contrib has shape (num_features + 1,) where the last is the base value
        feature_contributions = pred_contrib[:-1]
        top_indices = np.argsort(feature_contributions)[::-1][:5]
        
        reasons = []
        for idx in top_indices:
            if feature_contributions[idx] > 0:
                fname = (ORDERED_FEATURE_NAMES + ['anomaly_score'])[idx]
                reasons.append(f"High risk driven by {fname}")
        return reasons if reasons else ["No strong single feature"]

    def _get_feature_importances(self, pred_contrib: np.ndarray) -> dict:
        contributions = pred_contrib[:-1]
        f_names = ORDERED_FEATURE_NAMES + ['anomaly_score']
        
        family_scores = {
            "behavioral": 0.0,
            "identity": 0.0,
            "payment": 0.0,
            "device": 0.0,
            "address": 0.0,
            "velocity": 0.0
        }
        
        for i, val in enumerate(contributions):
            if val <= 0: continue
            fname = f_names[i]
            family = fname.split('_')[0]
            if family == 'anomaly': family = 'behavioral'
            if family in family_scores:
                family_scores[family] += float(val)
                
        # Normalize
        total = sum(family_scores.values())
        if total > 0:
            for k in family_scores:
                family_scores[k] = round((family_scores[k] / total) * 100, 1)
                
        return family_scores

    def score(self, features: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        import time
        start_ms = time.time() * 1000
        
        if self.degraded:
            return {
                "fraud_probability": 0.5,
                "ml_score": 50.0,
                "risk_score": 50.0,
                "risk_level": "MEDIUM",
                "top_reasons": ["ml_engine_degraded"],
                "reason_details": [],
                "feature_importances": {},
                "anomaly_score": 0.5,
                "suggested_fraud_type": "OTHER",
                "model_version": "degraded",
                "scoring_ms": int((time.time() * 1000) - start_ms)
            }
            
        try:
            # 1. Transform features with tolerance for missing/extra
            flat_feat = flatten_features(features)
            
            # 2. Anomaly score
            bev_vel = flat_feat[self.bev_vel_idx].reshape(1, -1)
            anomaly_score = -self.iforest.decision_function(bev_vel)[0]
            
            # 3. LGBM
            full_feat = np.append(flat_feat, anomaly_score).reshape(1, -1)
            raw_pred = self.lgb_model.predict(full_feat)[0]
            pred_contrib = self.lgb_model.predict(full_feat, pred_contrib=True)[0]
            
            # 4. Calibration
            fraud_prob = float(self.calibrator.predict([raw_pred])[0])
            fraud_prob = max(0.0, min(1.0, fraud_prob))
            
            # 5. Formulate response
            ml_score = round(fraud_prob * 100, 1)
            ml_score = max(0.0, min(100.0, ml_score))
            
            if ml_score >= 85: risk_level = "CRITICAL"
            elif ml_score >= 70: risk_level = "HIGH"
            elif ml_score >= 40: risk_level = "MEDIUM"
            else: risk_level = "LOW"
            
            return {
                "fraud_probability": round(fraud_prob, 4),
                "ml_score": ml_score,
                "risk_score": ml_score,
                "risk_level": risk_level,
                "top_reasons": self._get_top_reasons(full_feat[0], pred_contrib),
                "reason_details": [], # Optional elaboration
                "feature_importances": self._get_feature_importances(pred_contrib),
                "anomaly_score": round(float(anomaly_score), 4),
                "suggested_fraud_type": "OTHER",
                "model_version": self.version,
                "scoring_ms": int((time.time() * 1000) - start_ms)
            }
            
        except Exception as e:
            log.exception("Error scoring shipment")
            return {
                "fraud_probability": 0.5,
                "ml_score": 50.0,
                "risk_score": 50.0,
                "risk_level": "MEDIUM",
                "top_reasons": ["ml_input_invalid"],
                "reason_details": [],
                "feature_importances": {},
                "anomaly_score": 0.5,
                "suggested_fraud_type": "OTHER",
                "model_version": self.version,
                "scoring_ms": int((time.time() * 1000) - start_ms)
            }
