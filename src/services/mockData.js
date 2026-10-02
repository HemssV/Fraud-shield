// src/services/mockData.js
//
// Centralized mock data store that provides the "Shipper Digital Twin"
// and all upstream service responses. In production, these would be
// replaced by calls to real account, payment, and fraud-signal systems.
//
// The mock data is designed to demonstrate multi-signal fraud detection:
//   Account + Payment + Device + Address → Signal Fusion → Risk Score

// ─── ACCOUNTS (Shipper Digital Twins) ────────────────────────────────

const accounts = {
  // ── Legitimate high-volume business shipper ──
  S1001: {
    shipper_id: 'S1001',
    account_status: 'ACTIVE',
    account_tier: 'BUSINESS',
    account_created_at: '2023-04-12',
    account_age_days: 1268,
    verified: true,

    historical_profile: {
      total_shipments: 842,
      avg_shipments_per_day: 2.4,
      avg_weight: 8.6,
      max_historical_weight: 32.0,
      usual_origins: ['Chennai'],
      usual_destinations: ['Bangalore', 'Hyderabad', 'Mumbai'],
      usual_service_types: ['GROUND', 'EXPRESS'],
      usual_booking_hours: [9, 10, 11, 14, 15, 16],
    },

    security: {
      last_password_change: '2026-09-28T10:30:00Z',
      last_profile_update: '2026-09-30T18:15:00Z',
      known_devices: ['D12', 'D31'],
      known_payment_ids: ['P03', 'P07'],
    },

    historical_fraud: {
      previous_fraud_cases: 0,
      previous_review_cases: 1,
    },
  },

  // ── Small individual shipper — low history ──
  S2002: {
    shipper_id: 'S2002',
    account_status: 'ACTIVE',
    account_tier: 'INDIVIDUAL',
    account_created_at: '2026-08-15',
    account_age_days: 47,
    verified: true,

    historical_profile: {
      total_shipments: 12,
      avg_shipments_per_day: 0.3,
      avg_weight: 2.1,
      max_historical_weight: 5.0,
      usual_origins: ['Mumbai'],
      usual_destinations: ['Pune', 'Nashik'],
      usual_service_types: ['GROUND'],
      usual_booking_hours: [10, 11, 12, 18, 19],
    },

    security: {
      last_password_change: '2026-08-15T12:00:00Z',
      last_profile_update: '2026-08-15T12:00:00Z',
      known_devices: ['D55'],
      known_payment_ids: ['P11'],
    },

    historical_fraud: {
      previous_fraud_cases: 0,
      previous_review_cases: 0,
    },
  },

  // ── Enterprise shipper — trusted, high volume ──
  S3003: {
    shipper_id: 'S3003',
    account_status: 'ACTIVE',
    account_tier: 'ENTERPRISE',
    account_created_at: '2020-01-10',
    account_age_days: 2456,
    verified: true,

    historical_profile: {
      total_shipments: 28540,
      avg_shipments_per_day: 38.5,
      avg_weight: 15.3,
      max_historical_weight: 150.0,
      usual_origins: ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Kolkata'],
      usual_destinations: ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad'],
      usual_service_types: ['GROUND', 'EXPRESS', 'EXPRESS_SAVER', 'FREIGHT'],
      usual_booking_hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    },

    security: {
      last_password_change: '2026-07-01T09:00:00Z',
      last_profile_update: '2026-09-15T11:30:00Z',
      known_devices: ['D01', 'D02', 'D03', 'D04', 'D05'],
      known_payment_ids: ['P01', 'P02'],
    },

    historical_fraud: {
      previous_fraud_cases: 0,
      previous_review_cases: 3,
    },
  },

  // ── Suspended account — known fraud ──
  S4004: {
    shipper_id: 'S4004',
    account_status: 'SUSPENDED',
    account_tier: 'INDIVIDUAL',
    account_created_at: '2026-06-20',
    account_age_days: 103,
    verified: false,

    historical_profile: {
      total_shipments: 45,
      avg_shipments_per_day: 5.6,
      avg_weight: 22.5,
      max_historical_weight: 50.0,
      usual_origins: ['Kolkata'],
      usual_destinations: ['Delhi', 'Jaipur', 'Lucknow'],
      usual_service_types: ['EXPRESS'],
      usual_booking_hours: [22, 23, 0, 1, 2],
    },

    security: {
      last_password_change: '2026-09-25T03:45:00Z',
      last_profile_update: '2026-09-25T03:50:00Z',
      known_devices: ['D77', 'D78', 'D79'],
      known_payment_ids: ['P15', 'P16', 'P17'],
    },

    historical_fraud: {
      previous_fraud_cases: 3,
      previous_review_cases: 5,
    },
  },

  // ── New account with minimal history — under investigation ──
  S5005: {
    shipper_id: 'S5005',
    account_status: 'UNDER_INVESTIGATION',
    account_tier: 'INDIVIDUAL',
    account_created_at: '2026-09-28',
    account_age_days: 3,
    verified: false,

    historical_profile: {
      total_shipments: 8,
      avg_shipments_per_day: 2.7,
      avg_weight: 18.0,
      max_historical_weight: 30.0,
      usual_origins: ['Hyderabad'],
      usual_destinations: ['Delhi', 'Gurgaon'],
      usual_service_types: ['EXPRESS'],
      usual_booking_hours: [1, 2, 3, 22, 23],
    },

    security: {
      last_password_change: '2026-09-28T22:00:00Z',
      last_profile_update: '2026-09-28T22:05:00Z',
      known_devices: ['D90'],
      known_payment_ids: ['P20'],
    },

    historical_fraud: {
      previous_fraud_cases: 0,
      previous_review_cases: 2,
    },
  },
};


// ─── PAYMENTS ────────────────────────────────────────────────────────

const payments = {
  // ── Legitimate, well-established payment method ──
  P03: {
    payment_id: 'P03',
    payment_type: 'CREDIT_CARD',
    status: 'ACTIVE',
    card: {
      last4: '1234',
      issuer_country: 'IN',
      cardholder_name: 'ABC Logistics Pvt Ltd',
      cardholder_match: true,
    },
    history: {
      first_seen: '2023-04-12T10:00:00Z',
      previous_transactions: 320,
      previous_shipments: 310,
      amount_spend_30d: 45200.0,
    },
    risk: {
      new_payment_method: false,
      billing_shipping_match: true,
      previous_fraud_count: 0,
    },
  },

  P07: {
    payment_id: 'P07',
    payment_type: 'BANK_TRANSFER',
    status: 'ACTIVE',
    card: {
      last4: null,
      issuer_country: 'IN',
      cardholder_name: 'ABC Logistics Pvt Ltd',
      cardholder_match: true,
    },
    history: {
      first_seen: '2024-01-15T08:30:00Z',
      previous_transactions: 520,
      previous_shipments: 520,
      amount_spend_30d: 72000.0,
    },
    risk: {
      new_payment_method: false,
      billing_shipping_match: true,
      previous_fraud_count: 0,
    },
  },

  P11: {
    payment_id: 'P11',
    payment_type: 'DEBIT_CARD',
    status: 'ACTIVE',
    card: {
      last4: '5678',
      issuer_country: 'IN',
      cardholder_name: 'Ramesh Kumar',
      cardholder_match: true,
    },
    history: {
      first_seen: '2026-08-15T12:00:00Z',
      previous_transactions: 12,
      previous_shipments: 12,
      amount_spend_30d: 1800.0,
    },
    risk: {
      new_payment_method: false,
      billing_shipping_match: true,
      previous_fraud_count: 0,
    },
  },

  // ── Suspicious — brand new, mismatched cardholder ──
  P19: {
    payment_id: 'P19',
    payment_type: 'CREDIT_CARD',
    status: 'ACTIVE',
    card: {
      last4: '4821',
      issuer_country: 'IN',
      cardholder_name: 'ABC Logistics Pvt Ltd',
      cardholder_match: false,
    },
    history: {
      first_seen: '2026-10-01T22:55:00Z',
      previous_transactions: 0,
      previous_shipments: 0,
      amount_spend_30d: 0.0,
    },
    risk: {
      new_payment_method: true,
      billing_shipping_match: false,
      previous_fraud_count: 0,
    },
  },

  // ── Flagged payment — fraud history ──
  P15: {
    payment_id: 'P15',
    payment_type: 'CREDIT_CARD',
    status: 'ACTIVE',
    card: {
      last4: '9999',
      issuer_country: 'NG',
      cardholder_name: 'Unknown Name',
      cardholder_match: false,
    },
    history: {
      first_seen: '2026-06-20T00:00:00Z',
      previous_transactions: 40,
      previous_shipments: 38,
      amount_spend_30d: 125000.0,
    },
    risk: {
      new_payment_method: false,
      billing_shipping_match: false,
      previous_fraud_count: 3,
    },
  },

  P20: {
    payment_id: 'P20',
    payment_type: 'WALLET',
    status: 'ACTIVE',
    card: {
      last4: null,
      issuer_country: 'IN',
      cardholder_name: 'Digital Wallet User',
      cardholder_match: false,
    },
    history: {
      first_seen: '2026-09-28T22:00:00Z',
      previous_transactions: 3,
      previous_shipments: 3,
      amount_spend_30d: 8500.0,
    },
    risk: {
      new_payment_method: true,
      billing_shipping_match: false,
      previous_fraud_count: 0,
    },
  },
};


// ─── FRAUD SIGNALS (indexed by device_id) ────────────────────────────

const fraudSignals = {
  // ── Known legitimate devices ──
  D12: {
    device_id: 'D12',
    device: {
      status: 'ACTIVE',
      first_seen: '2023-04-12T10:00:00Z',
      known_device: true,
      accounts_linked: 1,
    },
    ip: {
      address: '203.45.67.89',
      country: 'IN',
      reputation: 'CLEAN',
      vpn_detected: false,
      proxy_detected: false,
    },
    fraud_signals: {
      device_blacklisted: false,
      ip_blacklisted: false,
      device_linked_to_fraud: false,
      linked_fraud_accounts: [],
    },
    risk_score: 5,
  },

  D31: {
    device_id: 'D31',
    device: {
      status: 'ACTIVE',
      first_seen: '2024-06-10T09:30:00Z',
      known_device: true,
      accounts_linked: 1,
    },
    ip: {
      address: '203.45.67.90',
      country: 'IN',
      reputation: 'CLEAN',
      vpn_detected: false,
      proxy_detected: false,
    },
    fraud_signals: {
      device_blacklisted: false,
      ip_blacklisted: false,
      device_linked_to_fraud: false,
      linked_fraud_accounts: [],
    },
    risk_score: 3,
  },

  D55: {
    device_id: 'D55',
    device: {
      status: 'ACTIVE',
      first_seen: '2026-08-15T12:00:00Z',
      known_device: true,
      accounts_linked: 1,
    },
    ip: {
      address: '49.36.12.44',
      country: 'IN',
      reputation: 'CLEAN',
      vpn_detected: false,
      proxy_detected: false,
    },
    fraud_signals: {
      device_blacklisted: false,
      ip_blacklisted: false,
      device_linked_to_fraud: false,
      linked_fraud_accounts: [],
    },
    risk_score: 8,
  },

  // ── Suspicious device — linked to multiple accounts + fraud ──
  D88: {
    device_id: 'D88',
    device: {
      status: 'ACTIVE',
      first_seen: '2026-10-01T22:45:00Z',
      known_device: false,
      accounts_linked: 7,
    },
    ip: {
      address: '103.21.45.18',
      country: 'IN',
      reputation: 'SUSPICIOUS',
      vpn_detected: true,
      proxy_detected: false,
    },
    fraud_signals: {
      device_blacklisted: false,
      ip_blacklisted: false,
      device_linked_to_fraud: true,
      linked_fraud_accounts: ['S2088', 'S3012'],
    },
    risk_score: 78,
  },

  // ── Blacklisted device ──
  D77: {
    device_id: 'D77',
    device: {
      status: 'ACTIVE',
      first_seen: '2026-06-20T00:00:00Z',
      known_device: true,
      accounts_linked: 4,
    },
    ip: {
      address: '185.220.101.42',
      country: 'RO',
      reputation: 'HIGH_RISK',
      vpn_detected: true,
      proxy_detected: true,
    },
    fraud_signals: {
      device_blacklisted: true,
      ip_blacklisted: true,
      device_linked_to_fraud: true,
      linked_fraud_accounts: ['S4004', 'S6006', 'S7007'],
    },
    risk_score: 95,
  },

  D90: {
    device_id: 'D90',
    device: {
      status: 'ACTIVE',
      first_seen: '2026-09-28T22:00:00Z',
      known_device: false,
      accounts_linked: 3,
    },
    ip: {
      address: '45.33.32.156',
      country: 'US',
      reputation: 'SUSPICIOUS',
      vpn_detected: true,
      proxy_detected: false,
    },
    fraud_signals: {
      device_blacklisted: false,
      ip_blacklisted: false,
      device_linked_to_fraud: true,
      linked_fraud_accounts: ['S5005', 'S8008'],
    },
    risk_score: 65,
  },
};


// ─── ADDRESS CONFIDENCE ──────────────────────────────────────────────

const addressConfidence = {
  // ── Well-known destinations with good delivery history ──
  Bangalore: {
    location: 'Bangalore',
    address_valid: true,
    confidence_score: 0.95,
    risk_tier: 'LOW',
    delivery_history: { successful_deliveries: 8420, failed_deliveries: 102 },
    signals: ['High delivery confidence', 'Strong historical relationship with shipper'],
  },

  Hyderabad: {
    location: 'Hyderabad',
    address_valid: true,
    confidence_score: 0.93,
    risk_tier: 'LOW',
    delivery_history: { successful_deliveries: 6250, failed_deliveries: 88 },
    signals: ['High delivery confidence', 'Strong historical relationship with shipper'],
  },

  Mumbai: {
    location: 'Mumbai',
    address_valid: true,
    confidence_score: 0.96,
    risk_tier: 'LOW',
    delivery_history: { successful_deliveries: 12400, failed_deliveries: 150 },
    signals: ['Very high delivery confidence', 'Major shipping hub'],
  },

  Pune: {
    location: 'Pune',
    address_valid: true,
    confidence_score: 0.91,
    risk_tier: 'LOW',
    delivery_history: { successful_deliveries: 4500, failed_deliveries: 65 },
    signals: ['High delivery confidence'],
  },

  Chennai: {
    location: 'Chennai',
    address_valid: true,
    confidence_score: 0.94,
    risk_tier: 'LOW',
    delivery_history: { successful_deliveries: 9100, failed_deliveries: 120 },
    signals: ['High delivery confidence', 'Major origin hub'],
  },

  // ── Moderate confidence destinations ──
  Delhi: {
    location: 'Delhi',
    address_valid: true,
    confidence_score: 0.61,
    risk_tier: 'MEDIUM',
    delivery_history: { successful_deliveries: 1284, failed_deliveries: 47 },
    signals: ['Moderate delivery confidence', 'Limited historical relationship with shipper'],
  },

  Kolkata: {
    location: 'Kolkata',
    address_valid: true,
    confidence_score: 0.72,
    risk_tier: 'MEDIUM',
    delivery_history: { successful_deliveries: 3200, failed_deliveries: 180 },
    signals: ['Moderate delivery confidence'],
  },

  Jaipur: {
    location: 'Jaipur',
    address_valid: true,
    confidence_score: 0.58,
    risk_tier: 'MEDIUM',
    delivery_history: { successful_deliveries: 890, failed_deliveries: 95 },
    signals: ['Moderate delivery confidence', 'Higher than average failed deliveries'],
  },

  // ── Higher risk / unknown destinations ──
  Gurgaon: {
    location: 'Gurgaon',
    address_valid: true,
    confidence_score: 0.42,
    risk_tier: 'HIGH',
    delivery_history: { successful_deliveries: 320, failed_deliveries: 85 },
    signals: ['Lower delivery confidence', 'High commercial address density', 'Elevated reshipper activity'],
  },

  Lucknow: {
    location: 'Lucknow',
    address_valid: true,
    confidence_score: 0.55,
    risk_tier: 'MEDIUM',
    delivery_history: { successful_deliveries: 650, failed_deliveries: 72 },
    signals: ['Moderate delivery confidence'],
  },

  Nashik: {
    location: 'Nashik',
    address_valid: true,
    confidence_score: 0.88,
    risk_tier: 'LOW',
    delivery_history: { successful_deliveries: 1200, failed_deliveries: 25 },
    signals: ['Good delivery confidence'],
  },

  // ── Specific address IDs (for the more realistic approach) ──
  ADDR991: {
    address_id: 'ADDR991',
    address_valid: true,
    confidence_score: 0.61,
    risk_tier: 'MEDIUM',
    signals: {
      new_for_shipper: true,
      previous_deliveries: 2,
      delivery_success_rate: 0.5,
    },
  },

  ADDR100: {
    address_id: 'ADDR100',
    address_valid: true,
    confidence_score: 0.95,
    risk_tier: 'LOW',
    signals: {
      new_for_shipper: false,
      previous_deliveries: 450,
      delivery_success_rate: 0.98,
    },
  },
};


// ─── DECISION FRAMEWORK THRESHOLDS ──────────────────────────────────

const decisionThresholds = {
  version: 'v1',
  allow_max: 30,       // 0-30   → ALLOW
  monitor_max: 50,     // 30-50  → ALLOW_MONITOR
  verify_max: 70,      // 50-70  → VERIFY (step-up verification)
  review_max: 85,      // 70-85  → HOLD FOR REVIEW
                        // 85-100 → BLOCK
};


module.exports = {
  accounts,
  payments,
  fraudSignals,
  addressConfidence,
  decisionThresholds,
};
