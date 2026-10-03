const { evaluateRules } = require('../src/rules/ruleEngine');

describe('Rule Engine', () => {
  const baseFeatures = {
    behavioral: {
      weight_ratio_to_avg: 1,
      total_historical_shipments: 10,
      weight_exceeds_max: false,
      weight_z_score: 0,
      is_new_origin: false,
      is_new_destination: false,
      is_unusual_service: false,
      is_unusual_hour: false,
      booking_hour: 12,
      is_low_history: false,
    },
    identity: {
      is_new_device: false,
      is_new_payment_for_account: false,
      password_changed_recently: false,
      profile_updated_recently: false,
      is_suspended: false,
      is_under_investigation: false,
      is_new_account: false,
      account_age_days: 100,
      is_verified: true,
      previous_fraud_cases: 0,
    },
    payment: {
      is_new_payment_method: false,
      payment_found: true,
      cardholder_match: true,
      billing_shipping_match: true,
      previous_fraud_count: 0,
      foreign_card: false,
    },
    device: {
      vpn_detected: false,
      proxy_detected: false,
      device_blacklisted: false,
      ip_blacklisted: false,
      device_linked_to_fraud: false,
      linked_fraud_account_count: 0,
      accounts_linked: 1,
      ip_reputation: 'GOOD',
    },
    address: {
      confidence_score: 0.9,
      risk_tier: 'LOW',
      address_valid: true,
    },
    velocity: {
      is_late_night: false,
      booking_hour: 12,
      volume_spike_detected: false,
    }
  };

  test('should return 0 score and negative points for safe established account', () => {
    const safeFeatures = JSON.parse(JSON.stringify(baseFeatures));
    safeFeatures.identity.account_age_days = 400;
    safeFeatures.behavioral.total_historical_shipments = 150;
    
    const result = evaluateRules(safeFeatures);
    
    // -10 for ESTABLISHED_ACCOUNT, -8 for KNOWN_DEVICE_AND_PAYMENT, -5 for HIGH_ADDRESS_CONFIDENCE
    // raw score will be -23, but rule_score clamps at 0.
    expect(result.raw_score).toBe(-23);
    expect(result.rule_score).toBe(0);
    expect(result.triggered_rules.some(r => r.code === 'ESTABLISHED_ACCOUNT')).toBe(true);
    expect(result.triggered_rules.some(r => r.code === 'KNOWN_DEVICE_AND_PAYMENT')).toBe(true);
    expect(result.triggered_rules.some(r => r.code === 'HIGH_ADDRESS_CONFIDENCE')).toBe(true);
  });

  test('should detect EXTREME_WEIGHT and WEIGHT_3X_NORMAL', () => {
    const suspiciousFeatures = JSON.parse(JSON.stringify(baseFeatures));
    suspiciousFeatures.behavioral.weight_z_score = 6;
    suspiciousFeatures.behavioral.weight_ratio_to_avg = 4;
    suspiciousFeatures.behavioral.weight_exceeds_max = true;
    
    const result = evaluateRules(suspiciousFeatures);
    
    expect(result.triggered_rules.some(r => r.code === 'EXTREME_WEIGHT')).toBe(true);
    expect(result.triggered_rules.some(r => r.code === 'WEIGHT_3X_NORMAL')).toBe(true);
    expect(result.triggered_rules.some(r => r.code === 'WEIGHT_EXCEEDS_MAX')).toBe(true);
    // Score should be 15 + 15 + 10 = 40, minus mitigating rules
  });

  test('should detect HIGH_RISK_ROUTE', () => {
    const routeFeatures = JSON.parse(JSON.stringify(baseFeatures));
    routeFeatures.behavioral.is_new_origin = true;
    routeFeatures.behavioral.is_new_destination = true;
    
    const result = evaluateRules(routeFeatures);
    
    expect(result.triggered_rules.some(r => r.code === 'HIGH_RISK_ROUTE')).toBe(true);
    expect(result.triggered_rules.some(r => r.code === 'NEW_ORIGIN')).toBe(true);
    expect(result.triggered_rules.some(r => r.code === 'NEW_DESTINATION')).toBe(true);
  });
  
  test('should clamp rule score to max 100', () => {
    const badFeatures = JSON.parse(JSON.stringify(baseFeatures));
    badFeatures.identity.is_suspended = true; // 30
    badFeatures.device.device_blacklisted = true; // 30
    badFeatures.device.ip_blacklisted = true; // 25
    badFeatures.identity.previous_fraud_cases = 5; // 25
    badFeatures.identity.is_under_investigation = true; // 20
    // Raw score > 100
    
    const result = evaluateRules(badFeatures);
    
    expect(result.raw_score).toBeGreaterThan(100);
    expect(result.rule_score).toBe(100);
  });
});
