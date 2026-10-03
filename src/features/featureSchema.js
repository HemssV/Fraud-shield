// src/features/featureSchema.js

const CATEGORIES = ['behavioral', 'identity', 'payment', 'device', 'address', 'velocity'];

const FEATURE_SPEC = {
  behavioral: [
    'weight_z_score', 'weight_ratio_to_avg', 'weight_exceeds_max',
    'is_unusual_hour', 'booking_hour', 'is_new_destination',
    'is_new_origin', 'is_unusual_service', 'package_count_ratio',
    'total_historical_shipments', 'is_low_history',
    'days_until_departure', 'departure_in_past', 'route_entropy',
    'is_new_route', 'route_count'
  ],
  identity: [
    'is_new_device', 'is_new_payment_for_account', 'password_changed_recently',
    'profile_updated_recently', 'account_age_days', 'is_new_account',
    'account_status', 'is_suspended', 'is_under_investigation',
    'is_verified', 'previous_fraud_cases', 'previous_review_cases'
  ],
  payment: [
    'payment_found', 'is_new_payment_method', 'cardholder_match',
    'billing_shipping_match', 'previous_transactions', 'previous_shipments',
    'amount_spend_30d', 'previous_fraud_count', 'foreign_card', 'payment_type'
  ],
  device: [
    'device_found', 'known_device', 'known_for_this_account', 'accounts_linked',
    'device_risk_score', 'ip_country', 'ip_reputation', 'vpn_detected',
    'proxy_detected', 'device_blacklisted', 'ip_blacklisted',
    'device_linked_to_fraud', 'linked_fraud_account_count', 'linked_fraud_accounts'
  ],
  address: [
    'address_found', 'address_valid', 'confidence_score', 'risk_tier',
    'is_new_destination_for_shipper', 'delivery_success_rate', 'signals'
  ],
  velocity: [
    'booking_hour', 'is_late_night', 'is_weekend', 'avg_daily_volume',
    'account_velocity_z', 'device_velocity_z', 'payment_velocity_z',
    'ip_velocity_z', 'volume_spike_detected'
  ]
};

function flattenFeatures(nestedFeatures) {
  const flat = {};
  
  for (const category of CATEGORIES) {
    if (!nestedFeatures[category]) {
      throw new Error(`Missing feature category: ${category}`);
    }
    
    const catFeatures = nestedFeatures[category];
    const expectedKeys = FEATURE_SPEC[category];
    
    // Check for missing features
    for (const key of expectedKeys) {
      if (catFeatures[key] === undefined) {
        throw new Error(`Missing feature: ${category}.${key}`);
      }
      flat[`${category}_${key}`] = catFeatures[key];
    }
    
    // Check for unexpected features
    for (const key of Object.keys(catFeatures)) {
      if (!expectedKeys.includes(key)) {
        throw new Error(`Unexpected feature found: ${category}.${key}`);
      }
    }
  }
  
  return flat;
}

function get1DVector(nestedFeatures) {
  const flat = flattenFeatures(nestedFeatures);
  const vector = [];
  for (const category of CATEGORIES) {
    for (const key of FEATURE_SPEC[category]) {
      const val = flat[`${category}_${key}`];
      // Convert booleans to 1/0, nulls to 0, handle types as needed
      if (typeof val === 'boolean') {
        vector.push(val ? 1.0 : 0.0);
      } else if (typeof val === 'number') {
        vector.push(val);
      } else {
        // String categorical? For 1D vector it typically needs to be numeric.
        // Let's just push the value and let the ML adapter handle encoding.
        vector.push(val);
      }
    }
  }
  return vector;
}

module.exports = {
  FEATURE_SPEC,
  CATEGORIES,
  flattenFeatures,
  get1DVector
};
