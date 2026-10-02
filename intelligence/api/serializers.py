"""
DRF Serializers — Backend Person B.

Input validation for all API endpoints.
"""
from rest_framework import serializers

from intelligence.models import SimScenario, DecisionAction, VerdictType, FraudType


class MLPredictSerializer(serializers.Serializer):
    shipment_id = serializers.CharField(max_length=100)
    features = serializers.DictField(
        child=serializers.JSONField(),
        help_text=(
            "Engineered features from Backend Person A. "
            "Expected keys: volume_ratio, new_device, new_destination, new_payment, "
            "weight_deviation, etc."
        )
    )

    def validate_features(self, value):
        if not value:
            raise serializers.ValidationError("features must not be empty.")
        return value


class ExplainSerializer(serializers.Serializer):
    assessment_id = serializers.UUIDField(
        help_text="UUID of the risk_assessment to explain."
    )


class AssignCaseSerializer(serializers.Serializer):
    staff_user_id = serializers.UUIDField()


class AnalystDecisionSerializer(serializers.Serializer):
    verdict = serializers.ChoiceField(choices=VerdictType.choices)
    action = serializers.ChoiceField(choices=DecisionAction.choices)
    reason = serializers.CharField(max_length=1000, required=False, default='')
    notes = serializers.CharField(max_length=5000, required=False, default='')
    fraud_type = serializers.ChoiceField(
        choices=FraudType.choices, required=False, allow_null=True, default=None
    )


class SimulatorRunSerializer(serializers.Serializer):
    scenario = serializers.ChoiceField(choices=SimScenario.choices)


class CaseListQuerySerializer(serializers.Serializer):
    status = serializers.CharField(required=False, default=None, allow_null=True)
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=20)
