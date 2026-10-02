# ml/features/schema.py
FEATURE_SPEC = {
    "behavioral": {
        "weight_z_score": 0.0,
        "weight_ratio_to_avg": 1.0,
        "weight_exceeds_max": False,
        "is_unusual_hour": False,
        "booking_hour": 12,
        "is_new_destination": False,
        "is_new_origin": False,
        "is_unusual_service": False,
        "package_count_ratio": 1.0,
        "total_historical_shipments": 0,
        "is_low_history": True,
    },
    "identity": {
        "is_new_device": False,
        "is_new_payment_for_account": False,
        "password_changed_recently": False,
        "profile_updated_recently": False,
        "account_age_days": 0,
        "is_new_account": False,
        "account_status": "UNKNOWN",
        "is_suspended": False,
        "is_under_investigation": False,
        "is_verified": True,
        "previous_fraud_cases": 0,
        "previous_review_cases": 0,
    },
    "payment": {
        "payment_found": False,
        "is_new_payment_method": True,
        "cardholder_match": False,
        "billing_shipping_match": False,
        "previous_transactions": 0,
        "previous_shipments": 0,
        "amount_spend_30d": 0.0,
        "previous_fraud_count": 0,
        "foreign_card": False,
        "payment_type": "UNKNOWN",
    },
    "device": {
        "device_found": False,
        "known_device": False,
        "known_for_this_account": False,
        "accounts_linked": 0,
        "device_risk_score": 40,
        "ip_country": "UNKNOWN",
        "ip_reputation": "UNKNOWN",
        "vpn_detected": False,
        "proxy_detected": False,
        "device_blacklisted": False,
        "ip_blacklisted": False,
        "device_linked_to_fraud": False,
        "linked_fraud_account_count": 0,
        "linked_fraud_accounts": [],
    },
    "address": {
        "address_found": False,
        "address_valid": False,
        "confidence_score": 0.30,
        "risk_tier": "HIGH",
        "is_new_destination_for_shipper": True,
        "delivery_success_rate": 0.0,
        "signals": [],
    },
    "velocity": {
        "booking_hour": 12,
        "is_late_night": False,
        "is_weekend": False,
        "avg_daily_volume": 0.0,
        "estimated_daily_rate": 1,
        "volume_spike_detected": False,
    }
}

# The ordered list of scalar features expected by LightGBM
ORDERED_FEATURE_NAMES = []
for category, features in FEATURE_SPEC.items():
    for feature, default_val in features.items():
        if isinstance(default_val, (int, float, bool)):
            ORDERED_FEATURE_NAMES.append(f"{category}_{feature}")
