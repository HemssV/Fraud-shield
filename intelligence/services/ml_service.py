"""
ML Service — Backend Person B

Wraps the ML fraud model behind a clean interface.
The application ONLY talks to FraudMLService; it never imports the model directly.

Usage:
    USE_MOCK_ML=true   → MockMLAdapter (deterministic, no model needed)
    USE_MOCK_ML=false  → RealMLAdapter (calls the model Person 1 provides)

Person A / ML person: to plug in the real model, implement RealMLAdapter.predict()
in this file and set USE_MOCK_ML=false in .env.
"""
from __future__ import annotations
import logging
from typing import Any

from django.conf import settings

log = logging.getLogger(__name__)


# ─── Data contracts ──────────────────────────────────────────────────────────

class MLInput:
    """Features produced by Backend Person A's feature-engineering pipeline."""
    def __init__(self, shipment_id: str, features: dict[str, Any]):
        self.shipment_id = shipment_id
        self.features = features


class MLOutput:
    """
    Fraud probability + top explanatory features.
    This is the agreed contract between ML Person and Backend Person B.
    """
    def __init__(
        self,
        fraud_probability: float,
        top_reasons: list[str],
        risk_score: float | None = None,
        risk_level: str | None = None,
        raw: dict | None = None,
    ):
        self.fraud_probability = round(float(fraud_probability), 4)
        self.top_reasons = top_reasons
        self.risk_score = risk_score if risk_score is not None else round(fraud_probability * 100, 1)
        self.risk_level = risk_level or self._derive_level(self.risk_score)
        self.raw = raw or {}

    @staticmethod
    def _derive_level(score: float) -> str:
        if score <= 30:
            return 'LOW'
        if score <= 50:
            return 'MEDIUM'
        if score <= 85:
            return 'HIGH'
        return 'CRITICAL'

    def to_dict(self) -> dict:
        return {
            'fraud_probability': self.fraud_probability,
            'risk_score': self.risk_score,
            'risk_level': self.risk_level,
            'top_reasons': self.top_reasons,
        }


# ─── Adapters ────────────────────────────────────────────────────────────────

class MockMLAdapter:
    """
    Deterministic mock ML adapter.
    Returns realistic fraud scores based on simple feature heuristics
    so the demo runs without a real model.
    """

    def predict(self, ml_input: MLInput) -> MLOutput:
        features = ml_input.features
        score = 0.0
        reasons = []

        volume_ratio = float(features.get('volume_ratio', 1.0))
        if volume_ratio > 5:
            score += 0.35
            reasons.append('volume_spike')
        elif volume_ratio > 2:
            score += 0.15
            reasons.append('moderate_volume_increase')

        if features.get('new_device'):
            score += 0.20
            reasons.append('new_device')

        if features.get('new_destination'):
            score += 0.15
            reasons.append('new_destination')

        if features.get('new_payment'):
            score += 0.15
            reasons.append('new_payment')

        weight_dev = float(features.get('weight_deviation', 0))
        if weight_dev > 2.0:
            score += 0.10
            reasons.append('unusual_weight')

        if features.get('recent_profile_change'):
            score += 0.15
            reasons.append('recent_account_change')

        # Cap at 0.97
        score = min(score, 0.97)
        log.debug(
            "MockML: shipment=%s score=%.4f reasons=%s",
            ml_input.shipment_id, score, reasons
        )
        return MLOutput(fraud_probability=score, top_reasons=reasons or ['no_signals'])


class RealMLAdapter:
    """
    Pluggable adapter for Person 1's trained model.

    TO INTEGRATE THE REAL MODEL:
    1. Import your model / prediction function here.
    2. Implement the predict() method to call it.
    3. Set USE_MOCK_ML=false in .env.

    Example using a scikit-learn style model:

        import joblib
        _model = joblib.load(settings.ML_MODEL_PATH)

        def predict(self, ml_input: MLInput) -> MLOutput:
            X = [list(ml_input.features.values())]
            prob = _model.predict_proba(X)[0][1]
            return MLOutput(fraud_probability=prob, top_reasons=[])
    """

    def predict(self, ml_input: MLInput) -> MLOutput:
        raise NotImplementedError(
            "RealMLAdapter is not yet configured. "
            "Set USE_MOCK_ML=true or implement RealMLAdapter.predict()."
        )


# ─── Service facade ──────────────────────────────────────────────────────────

class FraudMLService:
    """
    The one and only entry point the application uses for ML inference.
    Switches between mock and real based on USE_MOCK_ML setting.
    """

    def __init__(self):
        if getattr(settings, 'USE_MOCK_ML', True):
            log.info("FraudMLService: using MockMLAdapter")
            self._adapter = MockMLAdapter()
        else:
            log.info("FraudMLService: using RealMLAdapter")
            self._adapter = RealMLAdapter()

    def predict(self, shipment_id: str, features: dict[str, Any]) -> MLOutput:
        """
        Predict fraud probability for a shipment.

        Args:
            shipment_id: The shipment being scored (for logging/tracing).
            features:    Dict of engineered features from Person A's pipeline.

        Returns:
            MLOutput with fraud_probability and top_reasons.

        Raises:
            ValueError: if features dict is empty or invalid.
        """
        if not features:
            raise ValueError("features dict must not be empty")

        ml_input = MLInput(shipment_id=str(shipment_id), features=features)

        try:
            result = self._adapter.predict(ml_input)
        except NotImplementedError:
            raise
        except Exception as exc:
            log.exception("ML adapter error for shipment %s: %s", shipment_id, exc)
            # Graceful degradation: return medium risk with an explicit reason
            result = MLOutput(
                fraud_probability=0.50,
                top_reasons=['ml_service_error'],
                risk_level='MEDIUM',
            )
        return result


# Module-level singleton
_ml_service: FraudMLService | None = None


def get_ml_service() -> FraudMLService:
    global _ml_service
    if _ml_service is None:
        _ml_service = FraudMLService()
    return _ml_service
