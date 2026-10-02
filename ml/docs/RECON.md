# FraudShield ML Reconnaissance

## (a) Feature Schema

The exact output from `src/features/featureGenerator.js`, which forms the input contract for the ML model.

| Feature Family | Feature Name | Type | Description / Range | Default |
|---|---|---|---|---|
| **behavioral** | `weight_z_score` | Float | Z-score of shipment weight vs history | 0.0 |
| | `weight_ratio_to_avg` | Float | Ratio of weight to historical average | 1.0 |
| | `weight_exceeds_max` | Boolean | If weight > historical maximum | False |
| | `is_unusual_hour` | Boolean | Booking outside usual hours | False |
| | `booking_hour` | Int | UTC hour of booking (0-23) | Current Hour |
| | `is_new_destination` | Boolean | True if destination not in usual list | False |
| | `is_new_origin` | Boolean | True if origin not in usual list | False |
| | `is_unusual_service` | Boolean | Service type deviates from normal | False |
| | `package_count_ratio` | Float | `package_count` / `avg_shipments_per_day` | 1.0 |
| | `total_historical_shipments` | Int | Count of past shipments | 0 |
| | `is_low_history` | Boolean | `total_shipments < 10` | True |
| **identity** | `is_new_device` | Boolean | Booking device not in `known_devices` | False |
| | `is_new_payment_for_account`| Boolean | Payment not in `known_payment_ids` | False |
| | `password_changed_recently` | Boolean | Password changed in last 72h | False |
| | `profile_updated_recently` | Boolean | Profile updated in last 48h | False |
| | `account_age_days` | Int | Age of the account in days | 0 |
| | `is_new_account` | Boolean | `account_age_days < 30` | False |
| | `account_status` | String | E.g., 'ACTIVE', 'SUSPENDED' | 'UNKNOWN' |
| | `is_suspended` | Boolean | True if status is 'SUSPENDED' | False |
| | `is_under_investigation` | Boolean | True if status is 'UNDER_INVESTIGATION' | False |
| | `is_verified` | Boolean | False if explicitly `verified === false` | True |
| | `previous_fraud_cases` | Int | Historical confirmed fraud cases | 0 |
| | `previous_review_cases` | Int | Historical reviewed cases | 0 |
| **payment** | `payment_found` | Boolean | Was payment data provided? | False |
| | `is_new_payment_method` | Boolean | Derived from `payment.risk` | True |
| | `cardholder_match` | Boolean | Names on account and card match | False |
| | `billing_shipping_match` | Boolean | Billing address = origin address | False |
| | `previous_transactions` | Int | Total previous uses of payment | 0 |
| | `previous_shipments` | Int | Total shipments paid with this method | 0 |
| | `amount_spend_30d` | Float | Amount spent in last 30 days | 0.0 |
| | `previous_fraud_count` | Int | Number of prior frauds on payment | 0 |
| | `foreign_card` | Boolean | Issuer country != 'IN' | False |
| | `payment_type` | String | E.g., 'CREDIT_CARD', 'BANK_TRANSFER' | null |
| **device** | `device_found` | Boolean | Was device data provided? | False |
| | `known_device` | Boolean | Is device known system-wide? | False |
| | `known_for_this_account` | Boolean | Device in account's known devices | False |
| | `accounts_linked` | Int | Count of accounts using this device | 0 |
| | `device_risk_score` | Int | Third-party device risk score | 40 |
| | `ip_country` | String | Country from IP | null |
| | `ip_reputation` | String | E.g., 'CLEAN', 'SUSPICIOUS' | null |
| | `vpn_detected` | Boolean | Is IP a VPN? | False |
| | `proxy_detected` | Boolean | Is IP a proxy? | False |
| | `device_blacklisted` | Boolean | Is device blacklisted? | False |
| | `ip_blacklisted` | Boolean | Is IP blacklisted? | False |
| | `device_linked_to_fraud` | Boolean | Has device committed fraud? | False |
| | `linked_fraud_account_count`| Int | Length of `linked_fraud_accounts` array | 0 |
| | `linked_fraud_accounts` | Array | List of flagged account IDs | [] |
| **address** | `address_found` | Boolean | Was address data provided? | False |
| | `address_valid` | Boolean | Validated by mapping service? | False |
| | `confidence_score` | Float | Deliverability confidence | 0.30 |
| | `risk_tier` | String | 'LOW', 'MEDIUM', 'HIGH' | 'HIGH' |
| | `is_new_destination_for_shipper`| Boolean| Destination not in historical usuals | True |
| | `delivery_success_rate` | Float | Historical delivery success rate at address| null |
| | `signals` | Array | Extra text signals | [] |
| **velocity** | `booking_hour` | Int | UTC hour of booking | Current Hour |
| | `is_late_night` | Boolean | Between 22:00 and 04:00 | False |
| | `is_weekend` | Boolean | Sunday (0) or Saturday (6) | False |
| | `avg_daily_volume` | Float | Historical daily shipment volume | 0.0 |
| | `estimated_daily_rate` | Int | Current booking's `package_count` | 1 |
| | `volume_spike_detected` | Boolean | `package_count > avg_daily * 3` | False |


## (b) Node Expected Response Shape (`src/ml/fraudModel.js`)

```json
{
  "fraud_probability": 0.0,
  "ml_score": 0.0,
  "feature_importances": {
    "behavioral": 0,
    "identity": 0,
    "payment": 0,
    "device": 0,
    "address": 0
  },
  "model_version": "string",
  "scoring_ms": 0
}
```

## (c) Django Expected Response Shape (`intelligence/services/ml_service.py`)

```json
{
  "fraud_probability": 0.0,
  "risk_score": 0.0,
  "risk_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "top_reasons": ["string"]
}
```

## (d) 7 Scenario Payloads (`intelligence/services/simulator_service.py`)

The simulator generates synthetic entities and features on the fly. 

1. **NORMAL**: Legitimate shipment. Volume ratio 1.1, no new devices or payments, minor weight deviation.
2. **ACCOUNT_TAKEOVER**: New device + new payment + new destination + recent profile change + high volume ratio (2.5) + weight deviation (1.8).
3. **VOLUME_SPIKE**: Volume ratio 8.2x normal. Multiple shipments generated at once.
4. **PAYMENT_FRAUD**: Flagged payment instrument with multiple failed authorization attempts (5) + new destination.
5. **DESTINATION_ANOMALY**: Known high-risk reshipper address + unusual weight deviation (2.1) + new destination.
6. **FRAUD_RING**: Multiple accounts sharing a single device and single payment instrument + high volume ratio (3.0) + new device/destination/payment.
7. **SEASONAL_LEGIT_SPIKE**: High volume ratio (7.0x) but from a Trusted Shipper (`is_trusted=True`) during a known seasonal peak.

## (e) Ports and Env Vars

- **Node backend**: PORT=3000
- **Django backend**: Port 8000 (standard for manage.py runserver, assumed from postgres URL `localhost:5432`)
- **ML Service (this project)**: PORT=8001
- **Key Env Vars** (`.env.example`):
  - `USE_MOCK_ML=true` (Toggle for real vs mock ML output in Django)
  - `DATABASE_URL=postgres://fraudshield:password@localhost:5432/fraudshield`
  - (Will need to add `ML_SERVICE_URL=http://localhost:8001` for Node and Django integrations).

## (f) Gaps and Inconsistencies

1. **Feature Importances keys**: Node expects `behavioral, identity, payment, device, address` but misses `velocity`, despite `generateFeatures` producing a `velocity` group.
2. **Git**: Git is not available in the current PowerShell terminal, so `ml/fraudshield-ml` branch could not be locally created by the script (must be created manually by user, or assuming I work in the directory).
3. **Node vs Django integration**: Node expects `{ shipment_id, features }` payload to `POST /score` and returns `ml_score, fraud_probability, feature_importances`. Django expects `POST /predict` yielding `fraud_probability, risk_score, risk_level, top_reasons`. We will support both by returning a superset in `/score` or defining both endpoints in FastAPI.
