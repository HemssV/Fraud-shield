"""
ml/scripts/demo_scenarios.py

Runs all 7 fraud typology scenarios through the ML engine directly (no HTTP).
Prints a color-coded table of risk scores and compares against expected ranges.
"""
import sys
from pathlib import Path

# Needed if running as script rather than module
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ml.engine import FraudEngine

engine = FraudEngine()

SCENARIOS = [
    {
        "name": "NORMAL",
        "desc": "Typical legitimate shipment",
        "features": {
            "behavioral": {"weight_z_score": 0.1, "weight_ratio_to_avg": 1.0, "is_new_destination": False,
                           "is_unusual_hour": False, "booking_hour": 14, "package_count_ratio": 1.0,
                           "total_historical_shipments": 120, "is_low_history": False,
                           "weight_exceeds_max": False, "is_new_origin": False, "is_unusual_service": False},
            "identity": {"is_new_device": False, "is_new_payment_for_account": False,
                         "password_changed_recently": False, "profile_updated_recently": False,
                         "account_age_days": 365, "is_new_account": False, "account_status": "ACTIVE",
                         "is_suspended": False, "is_under_investigation": False, "is_verified": True,
                         "previous_fraud_cases": 0, "previous_review_cases": 0},
            "payment": {"payment_found": True, "is_new_payment_method": False, "cardholder_match": True,
                        "billing_shipping_match": True, "previous_transactions": 40, "previous_shipments": 40,
                        "amount_spend_30d": 4000.0, "previous_fraud_count": 0, "foreign_card": False,
                        "payment_type": "CREDIT_CARD"},
            "device": {"device_found": True, "known_device": True, "known_for_this_account": True,
                       "accounts_linked": 1, "device_risk_score": 5, "ip_country": "IN",
                       "ip_reputation": "CLEAN", "vpn_detected": False, "proxy_detected": False,
                       "device_blacklisted": False, "ip_blacklisted": False,
                       "device_linked_to_fraud": False, "linked_fraud_account_count": 0, "linked_fraud_accounts": []},
            "address": {"address_found": True, "address_valid": True, "confidence_score": 0.95,
                        "risk_tier": "LOW", "is_new_destination_for_shipper": False,
                        "delivery_success_rate": 0.98, "signals": []},
            "velocity": {"booking_hour": 14, "is_late_night": False, "is_weekend": False,
                         "avg_daily_volume": 5.0, "estimated_daily_rate": 5, "volume_spike_detected": False}
        },
        "expected_range": (0, 30)
    },
    {
        "name": "ACCOUNT_TAKEOVER",
        "desc": "New device + payment + destination + recent password change",
        "features": {
            "behavioral": {"weight_z_score": 1.8, "weight_ratio_to_avg": 2.5, "is_new_destination": True,
                           "is_unusual_hour": True, "booking_hour": 2, "package_count_ratio": 2.5,
                           "total_historical_shipments": 50, "is_low_history": False,
                           "weight_exceeds_max": True, "is_new_origin": False, "is_unusual_service": True},
            "identity": {"is_new_device": True, "is_new_payment_for_account": True,
                         "password_changed_recently": True, "profile_updated_recently": True,
                         "account_age_days": 200, "is_new_account": False, "account_status": "ACTIVE",
                         "is_suspended": False, "is_under_investigation": False, "is_verified": True,
                         "previous_fraud_cases": 0, "previous_review_cases": 2},
            "payment": {"payment_found": True, "is_new_payment_method": True, "cardholder_match": False,
                        "billing_shipping_match": False, "previous_transactions": 0, "previous_shipments": 0,
                        "amount_spend_30d": 0.0, "previous_fraud_count": 0, "foreign_card": False,
                        "payment_type": "CREDIT_CARD"},
            "device": {"device_found": True, "known_device": False, "known_for_this_account": False,
                       "accounts_linked": 1, "device_risk_score": 60, "ip_country": "IN",
                       "ip_reputation": "SUSPICIOUS", "vpn_detected": True, "proxy_detected": False,
                       "device_blacklisted": False, "ip_blacklisted": False,
                       "device_linked_to_fraud": False, "linked_fraud_account_count": 0, "linked_fraud_accounts": []},
            "address": {"address_found": True, "address_valid": False, "confidence_score": 0.4,
                        "risk_tier": "HIGH", "is_new_destination_for_shipper": True,
                        "delivery_success_rate": 0.5, "signals": ["no_permanent_resident"]},
            "velocity": {"booking_hour": 2, "is_late_night": True, "is_weekend": False,
                         "avg_daily_volume": 5.0, "estimated_daily_rate": 8, "volume_spike_detected": False}
        },
        "expected_range": (60, 100)
    },
    {
        "name": "VOLUME_SPIKE",
        "desc": "8x normal daily volume on known account",
        "features": {
            "behavioral": {"weight_z_score": 0.3, "weight_ratio_to_avg": 1.1, "is_new_destination": False,
                           "is_unusual_hour": False, "booking_hour": 11, "package_count_ratio": 8.2,
                           "total_historical_shipments": 100, "is_low_history": False,
                           "weight_exceeds_max": False, "is_new_origin": False, "is_unusual_service": False},
            "identity": {"is_new_device": False, "is_new_payment_for_account": False,
                         "password_changed_recently": False, "profile_updated_recently": False,
                         "account_age_days": 300, "is_new_account": False, "account_status": "ACTIVE",
                         "is_suspended": False, "is_under_investigation": False, "is_verified": True,
                         "previous_fraud_cases": 0, "previous_review_cases": 0},
            "payment": {"payment_found": True, "is_new_payment_method": False, "cardholder_match": True,
                        "billing_shipping_match": True, "previous_transactions": 100, "previous_shipments": 100,
                        "amount_spend_30d": 10000.0, "previous_fraud_count": 0, "foreign_card": False,
                        "payment_type": "BANK_TRANSFER"},
            "device": {"device_found": True, "known_device": True, "known_for_this_account": True,
                       "accounts_linked": 1, "device_risk_score": 5, "ip_country": "IN",
                       "ip_reputation": "CLEAN", "vpn_detected": False, "proxy_detected": False,
                       "device_blacklisted": False, "ip_blacklisted": False,
                       "device_linked_to_fraud": False, "linked_fraud_account_count": 0, "linked_fraud_accounts": []},
            "address": {"address_found": True, "address_valid": True, "confidence_score": 0.92,
                        "risk_tier": "LOW", "is_new_destination_for_shipper": False,
                        "delivery_success_rate": 0.96, "signals": []},
            "velocity": {"booking_hour": 11, "is_late_night": False, "is_weekend": False,
                         "avg_daily_volume": 10.0, "estimated_daily_rate": 82, "volume_spike_detected": True}
        },
        "expected_range": (50, 100)
    },
    {
        "name": "PAYMENT_FRAUD",
        "desc": "Flagged payment with multiple failed attempts",
        "features": {
            "behavioral": {"weight_z_score": 0.5, "weight_ratio_to_avg": 1.2, "is_new_destination": True,
                           "is_unusual_hour": False, "booking_hour": 15, "package_count_ratio": 1.5,
                           "total_historical_shipments": 5, "is_low_history": True,
                           "weight_exceeds_max": False, "is_new_origin": False, "is_unusual_service": False},
            "identity": {"is_new_device": False, "is_new_payment_for_account": True,
                         "password_changed_recently": False, "profile_updated_recently": False,
                         "account_age_days": 60, "is_new_account": False, "account_status": "ACTIVE",
                         "is_suspended": False, "is_under_investigation": False, "is_verified": True,
                         "previous_fraud_cases": 0, "previous_review_cases": 0},
            "payment": {"payment_found": True, "is_new_payment_method": True, "cardholder_match": False,
                        "billing_shipping_match": False, "previous_transactions": 1, "previous_shipments": 0,
                        "amount_spend_30d": 0.0, "previous_fraud_count": 5, "foreign_card": True,
                        "payment_type": "CREDIT_CARD"},
            "device": {"device_found": True, "known_device": True, "known_for_this_account": True,
                       "accounts_linked": 1, "device_risk_score": 25, "ip_country": "IN",
                       "ip_reputation": "CLEAN", "vpn_detected": False, "proxy_detected": False,
                       "device_blacklisted": False, "ip_blacklisted": False,
                       "device_linked_to_fraud": False, "linked_fraud_account_count": 0, "linked_fraud_accounts": []},
            "address": {"address_found": True, "address_valid": True, "confidence_score": 0.7,
                        "risk_tier": "MEDIUM", "is_new_destination_for_shipper": True,
                        "delivery_success_rate": 0.8, "signals": []},
            "velocity": {"booking_hour": 15, "is_late_night": False, "is_weekend": False,
                         "avg_daily_volume": 2.0, "estimated_daily_rate": 3, "volume_spike_detected": False}
        },
        "expected_range": (70, 100)
    },
    {
        "name": "DESTINATION_ANOMALY",
        "desc": "High-risk reshipping hub + unusual weight",
        "features": {
            "behavioral": {"weight_z_score": 2.1, "weight_ratio_to_avg": 3.0, "is_new_destination": True,
                           "is_unusual_hour": False, "booking_hour": 12, "package_count_ratio": 1.2,
                           "total_historical_shipments": 30, "is_low_history": False,
                           "weight_exceeds_max": True, "is_new_origin": False, "is_unusual_service": False},
            "identity": {"is_new_device": False, "is_new_payment_for_account": False,
                         "password_changed_recently": False, "profile_updated_recently": False,
                         "account_age_days": 120, "is_new_account": False, "account_status": "ACTIVE",
                         "is_suspended": False, "is_under_investigation": False, "is_verified": True,
                         "previous_fraud_cases": 0, "previous_review_cases": 1},
            "payment": {"payment_found": True, "is_new_payment_method": False, "cardholder_match": True,
                        "billing_shipping_match": True, "previous_transactions": 20, "previous_shipments": 20,
                        "amount_spend_30d": 2000.0, "previous_fraud_count": 0, "foreign_card": False,
                        "payment_type": "CREDIT_CARD"},
            "device": {"device_found": True, "known_device": True, "known_for_this_account": True,
                       "accounts_linked": 1, "device_risk_score": 10, "ip_country": "IN",
                       "ip_reputation": "CLEAN", "vpn_detected": False, "proxy_detected": False,
                       "device_blacklisted": False, "ip_blacklisted": False,
                       "device_linked_to_fraud": False, "linked_fraud_account_count": 0, "linked_fraud_accounts": []},
            "address": {"address_found": True, "address_valid": True, "confidence_score": 0.35,
                        "risk_tier": "HIGH", "is_new_destination_for_shipper": True,
                        "delivery_success_rate": 0.45, "signals": ["known_reshipper", "high_fraud_rate"]},
            "velocity": {"booking_hour": 12, "is_late_night": False, "is_weekend": False,
                         "avg_daily_volume": 4.0, "estimated_daily_rate": 5, "volume_spike_detected": False}
        },
        "expected_range": (50, 100)
    },
    {
        "name": "FRAUD_RING",
        "desc": "Device and payment shared across 5 accounts",
        "features": {
            "behavioral": {"weight_z_score": 0.8, "weight_ratio_to_avg": 1.5, "is_new_destination": True,
                           "is_unusual_hour": False, "booking_hour": 9, "package_count_ratio": 3.0,
                           "total_historical_shipments": 3, "is_low_history": True,
                           "weight_exceeds_max": False, "is_new_origin": False, "is_unusual_service": False},
            "identity": {"is_new_device": True, "is_new_payment_for_account": True,
                         "password_changed_recently": False, "profile_updated_recently": False,
                         "account_age_days": 15, "is_new_account": True, "account_status": "ACTIVE",
                         "is_suspended": False, "is_under_investigation": False, "is_verified": False,
                         "previous_fraud_cases": 0, "previous_review_cases": 0},
            "payment": {"payment_found": True, "is_new_payment_method": True, "cardholder_match": False,
                        "billing_shipping_match": False, "previous_transactions": 4, "previous_shipments": 3,
                        "amount_spend_30d": 500.0, "previous_fraud_count": 0, "foreign_card": False,
                        "payment_type": "PREPAID_CARD"},
            "device": {"device_found": True, "known_device": True, "known_for_this_account": False,
                       "accounts_linked": 5, "device_risk_score": 80, "ip_country": "IN",
                       "ip_reputation": "SUSPICIOUS", "vpn_detected": False, "proxy_detected": False,
                       "device_blacklisted": False, "ip_blacklisted": False,
                       "device_linked_to_fraud": True, "linked_fraud_account_count": 2, "linked_fraud_accounts": ["A1", "A2"]},
            "address": {"address_found": True, "address_valid": True, "confidence_score": 0.5,
                        "risk_tier": "HIGH", "is_new_destination_for_shipper": True,
                        "delivery_success_rate": 0.6, "signals": []},
            "velocity": {"booking_hour": 9, "is_late_night": False, "is_weekend": False,
                         "avg_daily_volume": 1.0, "estimated_daily_rate": 3, "volume_spike_detected": True}
        },
        "expected_range": (70, 100)
    },
    {
        "name": "SEASONAL_LEGIT_SPIKE",
        "desc": "Trusted shipper: 7x volume during Diwali (should NOT be blocked)",
        "features": {
            "behavioral": {"weight_z_score": 0.4, "weight_ratio_to_avg": 1.1, "is_new_destination": False,
                           "is_unusual_hour": False, "booking_hour": 10, "package_count_ratio": 7.0,
                           "total_historical_shipments": 500, "is_low_history": False,
                           "weight_exceeds_max": False, "is_new_origin": False, "is_unusual_service": False},
            "identity": {"is_new_device": False, "is_new_payment_for_account": False,
                         "password_changed_recently": False, "profile_updated_recently": False,
                         "account_age_days": 1500, "is_new_account": False, "account_status": "ACTIVE",
                         "is_suspended": False, "is_under_investigation": False, "is_verified": True,
                         "previous_fraud_cases": 0, "previous_review_cases": 0},
            "payment": {"payment_found": True, "is_new_payment_method": False, "cardholder_match": True,
                        "billing_shipping_match": True, "previous_transactions": 200, "previous_shipments": 200,
                        "amount_spend_30d": 20000.0, "previous_fraud_count": 0, "foreign_card": False,
                        "payment_type": "BANK_TRANSFER"},
            "device": {"device_found": True, "known_device": True, "known_for_this_account": True,
                       "accounts_linked": 1, "device_risk_score": 2, "ip_country": "IN",
                       "ip_reputation": "CLEAN", "vpn_detected": False, "proxy_detected": False,
                       "device_blacklisted": False, "ip_blacklisted": False,
                       "device_linked_to_fraud": False, "linked_fraud_account_count": 0, "linked_fraud_accounts": []},
            "address": {"address_found": True, "address_valid": True, "confidence_score": 0.99,
                        "risk_tier": "LOW", "is_new_destination_for_shipper": False,
                        "delivery_success_rate": 0.99, "signals": []},
            "velocity": {"booking_hour": 10, "is_late_night": False, "is_weekend": False,
                         "avg_daily_volume": 20.0, "estimated_daily_rate": 140, "volume_spike_detected": True}
        },
        "expected_range": (0, 50)  # High volume but trusted — should be LOW/MEDIUM
    }
]


ANSI_GREEN = "\033[92m"
ANSI_YELLOW = "\033[93m"
ANSI_RED = "\033[91m"
ANSI_RESET = "\033[0m"
ANSI_BOLD = "\033[1m"
ANSI_CYAN = "\033[96m"


def color_score(score):
    if score <= 30:
        return f"{ANSI_GREEN}{score:.1f}{ANSI_RESET}"
    elif score <= 70:
        return f"{ANSI_YELLOW}{score:.1f}{ANSI_RESET}"
    else:
        return f"{ANSI_RED}{score:.1f}{ANSI_RESET}"


def main():
    print(f"\n{ANSI_BOLD}{ANSI_CYAN}{'='*70}")
    print("  FraudShield ML Engine — 7 Scenario Demo")
    print(f"{'='*70}{ANSI_RESET}\n")

    all_pass = True

    for s in SCENARIOS:
        result = engine.score(s["features"])

        risk_score = result["ml_score"]
        risk_level = result["risk_level"]
        prob = result["fraud_probability"]
        low, high = s["expected_range"]
        passed = low <= risk_score <= high

        if not passed:
            all_pass = False

        status = f"{ANSI_GREEN}[PASS]{ANSI_RESET}" if passed else f"{ANSI_RED}[FAIL]{ANSI_RESET}"

        print(f"{ANSI_BOLD}{s['name']}{ANSI_RESET}")
        print(f"  {s['desc']}")
        print(f"  Score: {color_score(risk_score)}  Level: {risk_level}  Prob: {prob:.4f}  {status}")
        print(f"  Expected range: [{low}, {high}]")
        if result['top_reasons']:
            print(f"  Top reason: {result['top_reasons'][0]}")
        print()

    print(f"{ANSI_BOLD}{'='*70}{ANSI_RESET}")
    if all_pass:
        print(f"{ANSI_GREEN}{ANSI_BOLD}  All 7 scenarios passed!{ANSI_RESET}")
    else:
        print(f"{ANSI_RED}{ANSI_BOLD}  Some scenarios failed. Review expected_range vs actual scores.{ANSI_RESET}")
    print(f"{ANSI_BOLD}{'='*70}{ANSI_RESET}\n")


if __name__ == "__main__":
    main()
