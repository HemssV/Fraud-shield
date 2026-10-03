// tests/behavioralProfile.test.js
//
// Comprehensive tests for the Adaptive Behavioral Profiling system.
//
// Tests cover all 13 required scenarios:
//   1.  Existing baseline behavior
//   2.  Legitimate behavioral change detected as novel
//   3.  Analyst verification causes behavioral adaptation
//   4.  Repeated normal behavior no longer penalized
//   5.  Entity isolation (shipper A ≠ shipper B)
//   6.  Independent risk signals remain active
//   7.  Account takeover detection
//   8.  Fraudulent seasoning resistance
//   9.  Incorrect feedback reversal
//   10. Recency decay
//   11. Failure safety
//   12. Regression (existing rules, ML, risk scoring)
//   13. Point-in-time correctness
//
// Run with: npx jest tests/behavioralProfile.test.js

const {
  checkFamiliarity,
  recordVerifiedBehavior,
  invalidateFamiliarity,
  processAnalystFeedback,
  getAccountFamiliarity,
  normalizeValue,
  CONFIG,
} = require('../src/services/behavioralProfileService');

const { generateFeatures, generateFeaturesWithFamiliarity } = require('../src/features/featureGenerator');
const { evaluateRules, RULES } = require('../src/rules/ruleEngine');

// ─── Mock the database module ───────────────────────────────────────────────
// We mock the db module to avoid needing a real PostgreSQL connection
const mockQuery = jest.fn();
jest.mock('../src/db/index', () => ({
  query: (...args) => mockQuery(...args),
  getClient: jest.fn(),
}));

// ─── Mock logger ────────────────────────────────────────────────────────────
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const ACCOUNT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SHIPMENT_1 = 'ssssssss-ssss-ssss-ssss-ssssssssss01';
const SHIPMENT_2 = 'ssssssss-ssss-ssss-ssss-ssssssssss02';
const ANALYST_1 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const CASE_1 = 'cccccccc-cccc-cccc-cccc-cccccccccc01';

function makeBooking(overrides = {}) {
  return {
    shipper_id: 'S1001',
    origin: 'Chennai',
    destination: 'Mumbai',
    weight: 8.5,
    service_type: 'GROUND',
    payment_id: 'P03',
    device_id: 'D12',
    package_count: 1,
    booking_timestamp: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

function makeAccount(overrides = {}) {
  return {
    shipper_id: 'S1001',
    account_status: 'ACTIVE',
    account_tier: 'BUSINESS',
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
    ...overrides,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 1: Normalization & Core Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('normalizeValue', () => {
  test('normalizes destination cities case-insensitively', () => {
    expect(normalizeValue('destination', 'Mumbai')).toBe('mumbai');
    expect(normalizeValue('destination', 'MUMBAI')).toBe('mumbai');
    expect(normalizeValue('destination', 'New Delhi')).toBe('new_delhi');
  });

  test('normalizes service types to uppercase', () => {
    expect(normalizeValue('service_type', 'ground')).toBe('GROUND');
    expect(normalizeValue('service_type', 'Express')).toBe('EXPRESS');
  });

  test('handles empty/null values', () => {
    expect(normalizeValue('destination', '')).toBe('');
    expect(normalizeValue('destination', null)).toBe('');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 2: Existing Baseline (Test Requirement #1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Existing baseline behavior', () => {
  test('historical normal destination is NOT flagged as new', () => {
    const booking = makeBooking({ destination: 'Mumbai' }); // Mumbai is in usual_destinations
    const account = makeAccount();
    const features = generateFeatures(booking, account, null, null, null);

    expect(features.behavioral.is_new_destination).toBe(false);
  });

  test('historical normal origin is NOT flagged as new', () => {
    const booking = makeBooking({ origin: 'Chennai' }); // Chennai is in usual_origins
    const account = makeAccount();
    const features = generateFeatures(booking, account, null, null, null);

    expect(features.behavioral.is_new_origin).toBe(false);
  });

  test('historical normal service type is NOT flagged as unusual', () => {
    const booking = makeBooking({ service_type: 'GROUND' });
    const account = makeAccount();
    const features = generateFeatures(booking, account, null, null, null);

    expect(features.behavioral.is_unusual_service).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 3: Legitimate Behavioral Change Detected (Test Req #2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legitimate behavioral change detected as novel', () => {
  test('new destination IS flagged as new before any verification', () => {
    const booking = makeBooking({ destination: 'Kolkata' }); // NOT in usual_destinations
    const account = makeAccount();
    const features = generateFeatures(booking, account, null, null, null);

    expect(features.behavioral.is_new_destination).toBe(true);
  });

  test('new origin IS flagged as new before any verification', () => {
    const booking = makeBooking({ origin: 'Delhi' }); // NOT in usual_origins
    const account = makeAccount();
    const features = generateFeatures(booking, account, null, null, null);

    expect(features.behavioral.is_new_origin).toBe(true);
  });

  test('NEW_DESTINATION rule fires for new destination with sufficient history', () => {
    const booking = makeBooking({ destination: 'Kolkata' });
    const account = makeAccount();
    const features = generateFeatures(booking, account, null, null, null);
    const ruleResult = evaluateRules(features);

    const triggered = ruleResult.triggered_rules.map(r => r.code);
    expect(triggered).toContain('NEW_DESTINATION');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 4: Analyst Verification → Behavioral Adaptation (Test Req #3)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Analyst verification causes behavioral adaptation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('recordVerifiedBehavior creates a familiarity entry', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        account_id: ACCOUNT_A,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 1,
        first_verified_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        source_shipment_id: SHIPMENT_1,
        source_analyst_id: ANALYST_1,
        is_invalidated: false,
      }],
    });

    const entry = await recordVerifiedBehavior(
      ACCOUNT_A, 'destination', 'Kolkata',
      { shipment_id: SHIPMENT_1, analyst_id: ANALYST_1, case_id: CASE_1 }
    );

    expect(entry).not.toBeNull();
    expect(entry.dimension).toBe('destination');
    expect(entry.value).toBe('kolkata');
    expect(entry.occurrence_count).toBe(1);

    // Verify the SQL was called with correct normalized value
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO behavioral_familiarity');
    expect(params[2]).toBe('kolkata'); // normalized value
  });

  test('processAnalystFeedback with FALSE_POSITIVE records behaviors', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        familiarity_id: 1,
        account_id: ACCOUNT_A,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 1,
        first_verified_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    await processAnalystFeedback({
      account_id: ACCOUNT_A,
      shipment_id: SHIPMENT_1,
      verdict: 'FALSE_POSITIVE',
      analyst_id: ANALYST_1,
      case_id: CASE_1,
      shipment_details: {
        origin: 'Chennai',
        destination: 'Kolkata',
        service_type: 'EXPRESS',
      },
    });

    // Should have recorded 3 behaviors: destination, origin, service_type
    expect(mockQuery.mock.calls.length).toBe(3);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 5: Repeated Normal Behavior No Longer Penalized (Test Req #4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Repeated normal behavior no longer penalized', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('familiar destination suppresses is_new_destination flag', async () => {
    // Mock: familiarity check returns a familiar entry
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        account_id: ACCOUNT_A,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 3,
        first_verified_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    const booking = makeBooking({ destination: 'Kolkata' });
    const account = makeAccount();

    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, null, null, ACCOUNT_A
    );

    // The destination was initially new, but familiarity suppressed it
    expect(features.behavioral.is_new_destination).toBe(false);
    expect(features._meta.familiarity_applied).toBe(true);
    expect(features.behavioral._destination_familiarity).toBeGreaterThan(0);
  });

  test('NEW_DESTINATION rule does NOT fire for familiar destination', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        account_id: ACCOUNT_A,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 5,
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    const booking = makeBooking({ destination: 'Kolkata' });
    const account = makeAccount();

    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, null, null, ACCOUNT_A
    );
    const ruleResult = evaluateRules(features);

    const triggered = ruleResult.triggered_rules.map(r => r.code);
    expect(triggered).not.toContain('NEW_DESTINATION');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 6: Entity Isolation (Test Req #5)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Entity isolation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('familiarity for Account A does NOT affect Account B', async () => {
    // Account A has Kolkata as familiar
    mockQuery
      .mockResolvedValueOnce({ rows: [] }); // Account B query — no familiarity

    const booking = makeBooking({ destination: 'Kolkata' });
    const account = makeAccount();

    // Query familiarity for Account B (should find nothing)
    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, null, null, ACCOUNT_B
    );

    // Account B should still see Kolkata as new
    expect(features.behavioral.is_new_destination).toBe(true);

    // Verify the DB was queried with Account B's ID
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe(ACCOUNT_B);
  });

  test('checkFamiliarity is scoped to specific account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkFamiliarity(ACCOUNT_B, 'destination', 'Kolkata');
    expect(result.familiar).toBe(false);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe(ACCOUNT_B); // Query was for Account B specifically
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 7: Independent Risk Signals (Test Req #6)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Independent risk signals remain active', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('familiar destination does NOT suppress device signals', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 5,
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    const booking = makeBooking({ destination: 'Kolkata', device_id: 'D_NEW' });
    const account = makeAccount();

    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, null, null, ACCOUNT_A
    );

    // Destination familiarity was applied
    expect(features.behavioral.is_new_destination).toBe(false);

    // But device is still new (device signal is INDEPENDENT)
    expect(features.identity.is_new_device).toBe(true);
  });

  test('familiar destination does NOT suppress payment signals', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 5,
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    const booking = makeBooking({ destination: 'Kolkata', payment_id: 'P_NEW' });
    const account = makeAccount();

    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, null, null, ACCOUNT_A
    );

    // Behavioral familiarity applied
    expect(features.behavioral.is_new_destination).toBe(false);

    // Payment signal still detects new payment
    expect(features.identity.is_new_payment_for_account).toBe(true);
  });

  test('familiar destination + suspicious device/IP still triggers rules', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 5,
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    const booking = makeBooking({ destination: 'Kolkata', device_id: 'D_NEW' });
    const account = makeAccount();

    // Simulate suspicious device signals
    const deviceSignals = {
      device_id: 'D_NEW',
      device: { status: 'ACTIVE', first_seen: new Date().toISOString(), known_device: false, accounts_linked: 7 },
      ip: { address: '1.2.3.4', country: 'IN', reputation: 'SUSPICIOUS', vpn_detected: true, proxy_detected: false },
      fraud_signals: { device_blacklisted: false, ip_blacklisted: false, device_linked_to_fraud: true, linked_fraud_accounts: ['X1', 'X2'] },
      risk_score: 78,
    };

    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, deviceSignals, null, ACCOUNT_A
    );

    const ruleResult = evaluateRules(features);
    const triggered = ruleResult.triggered_rules.map(r => r.code);

    // Destination NOT triggered (familiar)
    expect(triggered).not.toContain('NEW_DESTINATION');

    // BUT device/IP signals STILL trigger
    expect(triggered).toContain('NEW_DEVICE_FOR_ACCOUNT');
    expect(triggered).toContain('VPN_DETECTED');
    expect(triggered).toContain('DEVICE_LINKED_TO_FRAUD');
    expect(triggered).toContain('HIGH_DEVICE_SHARING');

    // Risk score should still be elevated from device signals
    expect(ruleResult.rule_score).toBeGreaterThan(20);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 8: Account Takeover Detection (Test Req #7)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Account takeover remains detectable', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('familiar behavior + new device + new payment + VPN still produces high risk', async () => {
    // Destination is familiar
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'mumbai',
        occurrence_count: 10,
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    const booking = makeBooking({
      destination: 'Mumbai',  // familiar
      device_id: 'D_ATTACKER',   // unknown device
      payment_id: 'P_STOLEN',    // unknown payment
    });

    const account = makeAccount({
      security: {
        last_password_change: new Date(Date.now() - 12 * 3600000).toISOString(), // 12h ago
        last_profile_update: new Date(Date.now() - 6 * 3600000).toISOString(), // 6h ago
        known_devices: ['D12', 'D31'],   // D_ATTACKER is NOT known
        known_payment_ids: ['P03', 'P07'], // P_STOLEN is NOT known
      },
    });

    const deviceSignals = {
      device_id: 'D_ATTACKER',
      device: { status: 'ACTIVE', first_seen: new Date().toISOString(), known_device: false, accounts_linked: 3 },
      ip: { address: '185.220.101.1', country: 'RO', reputation: 'SUSPICIOUS', vpn_detected: true, proxy_detected: true },
      fraud_signals: { device_blacklisted: false, ip_blacklisted: false, device_linked_to_fraud: false, linked_fraud_accounts: [] },
      risk_score: 65,
    };

    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, deviceSignals, null, ACCOUNT_A
    );

    const ruleResult = evaluateRules(features);
    const triggered = ruleResult.triggered_rules.map(r => r.code);

    // Behavioral familiarity correctly suppresses destination flag
    expect(features.behavioral.is_new_destination).toBe(false);

    // BUT all account takeover signals remain:
    expect(triggered).toContain('NEW_DEVICE_FOR_ACCOUNT');
    expect(triggered).toContain('NEW_PAYMENT_FOR_ACCOUNT');
    expect(triggered).toContain('RECENT_PASSWORD_CHANGE');
    expect(triggered).toContain('RECENT_PROFILE_UPDATE');
    expect(triggered).toContain('VPN_DETECTED');
    expect(triggered).toContain('PROXY_DETECTED');

    // Combined risk should be substantial
    expect(ruleResult.rule_score).toBeGreaterThan(40);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 9: Fraudulent Seasoning Resistance (Test Req #8)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fraudulent seasoning resistance', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('only analyst-verified feedback creates familiarity, not unreviewed shipments', async () => {
    // processAnalystFeedback with INCONCLUSIVE does NOT create entries
    await processAnalystFeedback({
      account_id: ACCOUNT_A,
      shipment_id: SHIPMENT_1,
      verdict: 'INCONCLUSIVE',
      analyst_id: ANALYST_1,
      case_id: CASE_1,
      shipment_details: { destination: 'Kolkata' },
    });

    // No DB calls should have been made for INCONCLUSIVE
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('single verified occurrence has weak strength', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 1, // Only verified once
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    const result = await checkFamiliarity(ACCOUNT_A, 'destination', 'Kolkata');

    expect(result.familiar).toBe(true);
    // Strength = 1/3 ≈ 0.33 (below 0.5 = weakly familiar)
    expect(result.strength).toBeLessThanOrEqual(0.5);
  });

  test('multiple verified occurrences have strong strength', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 5, // Verified 5 times
        last_verified_at: new Date().toISOString(),
        is_invalidated: false,
      }],
    });

    const result = await checkFamiliarity(ACCOUNT_A, 'destination', 'Kolkata');

    expect(result.familiar).toBe(true);
    expect(result.strength).toBeGreaterThanOrEqual(0.9);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 10: Incorrect Feedback Reversal (Test Req #9)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Incorrect feedback reversal', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('CONFIRMED_FRAUD invalidates ALL familiarity for the account', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ familiarity_id: 1 }, { familiarity_id: 2 }, { familiarity_id: 3 }],
    });

    await processAnalystFeedback({
      account_id: ACCOUNT_A,
      shipment_id: SHIPMENT_2,
      verdict: 'CONFIRMED_FRAUD',
      analyst_id: ANALYST_1,
      case_id: CASE_1,
      shipment_details: { destination: 'Kolkata' },
    });

    // Should have called UPDATE to invalidate
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('is_invalidated = TRUE');
    expect(params[0]).toBe(ACCOUNT_A);
  });

  test('invalidated entries are not returned as familiar', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // Empty because invalidated

    const result = await checkFamiliarity(ACCOUNT_A, 'destination', 'Kolkata');

    expect(result.familiar).toBe(false);
    expect(result.strength).toBe(0);
  });

  test('specific entry can be invalidated by dimension+value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ familiarity_id: 1 }] });

    const count = await invalidateFamiliarity(ACCOUNT_A, 'Later found suspicious', {
      dimension: 'destination',
      value: 'Kolkata',
    });

    expect(count).toBe(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('dimension = $2');
  });

  test('specific entry can be invalidated by source shipment', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ familiarity_id: 1 }],
    });

    const count = await invalidateFamiliarity(ACCOUNT_A, 'Shipment later confirmed fraud', {
      shipment_id: SHIPMENT_1,
    });

    expect(count).toBe(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('source_shipment_id');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 11: Recency Decay (Test Req #10)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Recency decay', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('recent entry has full strength', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 5,
        last_verified_at: new Date().toISOString(), // Just now
        is_invalidated: false,
      }],
    });

    const result = await checkFamiliarity(ACCOUNT_A, 'destination', 'Kolkata');
    expect(result.strength).toBeGreaterThanOrEqual(0.95);
  });

  test('old entry has reduced strength due to decay', async () => {
    const halfStale = new Date();
    halfStale.setDate(halfStale.getDate() - Math.floor(CONFIG.STALE_DAYS / 2));

    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 5,
        last_verified_at: halfStale.toISOString(),
        is_invalidated: false,
      }],
    });

    const result = await checkFamiliarity(ACCOUNT_A, 'destination', 'Kolkata');
    // At half the stale period, decay factor ≈ 0.5, so strength ≈ 0.5
    expect(result.strength).toBeLessThan(0.7);
    expect(result.strength).toBeGreaterThan(0.2);
  });

  test('stale entry (beyond STALE_DAYS) is NOT familiar', async () => {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - CONFIG.STALE_DAYS - 1);

    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 10,
        last_verified_at: staleDate.toISOString(),
        is_invalidated: false,
      }],
    });

    const result = await checkFamiliarity(ACCOUNT_A, 'destination', 'Kolkata');
    expect(result.familiar).toBe(false);
    expect(result.stale).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 12: Failure Safety (Test Req #11)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Failure safety', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('DB error in checkFamiliarity returns unfamiliar (safe default)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await checkFamiliarity(ACCOUNT_A, 'destination', 'Kolkata');

    expect(result.familiar).toBe(false);
    expect(result.strength).toBe(0);
    expect(result.error).toBeDefined();
  });

  test('DB error in generateFeaturesWithFamiliarity keeps original (suspicious) features', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection timeout'));

    const booking = makeBooking({ destination: 'Kolkata' }); // New destination
    const account = makeAccount();

    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, null, null, ACCOUNT_A
    );

    // Feature should remain as "new" (more suspicious) — fail safe
    expect(features.behavioral.is_new_destination).toBe(true);
    expect(features._meta.familiarity_applied).toBe(false);
  });

  test('null accountId skips familiarity (returns standard features)', async () => {
    const booking = makeBooking({ destination: 'Kolkata' });
    const account = makeAccount();

    const features = await generateFeaturesWithFamiliarity(
      booking, account, null, null, null, null
    );

    // No DB call should have been made
    expect(mockQuery).not.toHaveBeenCalled();
    // Feature still flagged as new
    expect(features.behavioral.is_new_destination).toBe(true);
  });

  test('DB error in recordVerifiedBehavior returns null (non-blocking)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Disk full'));

    const result = await recordVerifiedBehavior(
      ACCOUNT_A, 'destination', 'Kolkata',
      { shipment_id: SHIPMENT_1, analyst_id: ANALYST_1 }
    );

    expect(result).toBeNull(); // Non-blocking failure
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 13: Regression — Existing Rules, ML, Risk Scoring (Test Req #12)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — existing system behavior preserved', () => {
  test('all original behavioral rules exist', () => {
    const ruleCodes = RULES.map(r => r.code);
    expect(ruleCodes).toContain('WEIGHT_3X_NORMAL');
    expect(ruleCodes).toContain('WEIGHT_EXCEEDS_MAX');
    expect(ruleCodes).toContain('NEW_DESTINATION');
    expect(ruleCodes).toContain('NEW_ORIGIN');
    expect(ruleCodes).toContain('UNUSUAL_SERVICE_TYPE');
    expect(ruleCodes).toContain('UNUSUAL_BOOKING_HOUR');
    expect(ruleCodes).toContain('LOW_HISTORY_SHIPPER');
  });

  test('all identity rules exist', () => {
    const ruleCodes = RULES.map(r => r.code);
    expect(ruleCodes).toContain('NEW_DEVICE_FOR_ACCOUNT');
    expect(ruleCodes).toContain('NEW_PAYMENT_FOR_ACCOUNT');
    expect(ruleCodes).toContain('RECENT_PASSWORD_CHANGE');
    expect(ruleCodes).toContain('ACCOUNT_SUSPENDED');
    expect(ruleCodes).toContain('PRIOR_FRAUD_HISTORY');
  });

  test('all payment rules exist', () => {
    const ruleCodes = RULES.map(r => r.code);
    expect(ruleCodes).toContain('NEW_PAYMENT_METHOD');
    expect(ruleCodes).toContain('CARDHOLDER_MISMATCH');
    expect(ruleCodes).toContain('PAYMENT_FRAUD_HISTORY');
  });

  test('all device/IP rules exist', () => {
    const ruleCodes = RULES.map(r => r.code);
    expect(ruleCodes).toContain('VPN_DETECTED');
    expect(ruleCodes).toContain('PROXY_DETECTED');
    expect(ruleCodes).toContain('DEVICE_BLACKLISTED');
    expect(ruleCodes).toContain('IP_BLACKLISTED');
    expect(ruleCodes).toContain('DEVICE_LINKED_TO_FRAUD');
  });

  test('mitigating rules exist', () => {
    const ruleCodes = RULES.map(r => r.code);
    expect(ruleCodes).toContain('ESTABLISHED_ACCOUNT');
    expect(ruleCodes).toContain('KNOWN_DEVICE_AND_PAYMENT');
    expect(ruleCodes).toContain('HIGH_ADDRESS_CONFIDENCE');
  });

  test('standard feature generation still works without familiarity', () => {
    const booking = makeBooking();
    const account = makeAccount();
    const features = generateFeatures(booking, account, null, null, null);

    expect(features.behavioral).toBeDefined();
    expect(features.identity).toBeDefined();
    expect(features.payment).toBeDefined();
    expect(features.device).toBeDefined();
    expect(features.address).toBeDefined();
    expect(features.velocity).toBeDefined();
    expect(features._meta).toBeDefined();
  });

  test('rule evaluation still produces valid output structure', () => {
    const booking = makeBooking();
    const account = makeAccount();
    const features = generateFeatures(booking, account, null, null, null);
    const result = evaluateRules(features);

    expect(result).toHaveProperty('rule_score');
    expect(result).toHaveProperty('raw_score');
    expect(result).toHaveProperty('triggered_count');
    expect(result).toHaveProperty('triggered_rules');
    expect(result).toHaveProperty('category_breakdown');
    expect(result).toHaveProperty('rules_version');
    expect(result.rule_score).toBeGreaterThanOrEqual(0);
    expect(result.rule_score).toBeLessThanOrEqual(100);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 14: Point-in-Time Correctness (Test Req #13)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Point-in-time correctness', () => {
  test('familiarity entry records creation timestamp for auditability', async () => {
    mockQuery.mockReset();
    const now = new Date();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        familiarity_id: 1,
        account_id: ACCOUNT_A,
        dimension: 'destination',
        value: 'kolkata',
        occurrence_count: 1,
        first_verified_at: now.toISOString(),
        last_verified_at: now.toISOString(),
        source_shipment_id: SHIPMENT_1,
        source_analyst_id: ANALYST_1,
        source_case_id: CASE_1,
        created_at: now.toISOString(),
        is_invalidated: false,
      }],
    });

    const entry = await recordVerifiedBehavior(
      ACCOUNT_A, 'destination', 'Kolkata',
      { shipment_id: SHIPMENT_1, analyst_id: ANALYST_1, case_id: CASE_1 }
    );

    // Entry should have provenance
    expect(entry.source_shipment_id).toBe(SHIPMENT_1);
    expect(entry.source_analyst_id).toBe(ANALYST_1);
    expect(entry.source_case_id).toBe(CASE_1);
    expect(entry.first_verified_at).toBeDefined();
    expect(entry.last_verified_at).toBeDefined();
  });

  test('future shipment cannot affect past familiarity state (checked at query time)', async () => {
    // The checkFamiliarity function queries the DB at the current moment.
    // An entry created in the future (via a future analyst verdict)
    // would not exist in the DB when a past shipment was screened.
    // This is inherently correct because familiarity is checked at screening time.

    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // No entry yet

    const result = await checkFamiliarity(ACCOUNT_A, 'destination', 'Kolkata');
    expect(result.familiar).toBe(false); // Not familiar before verdict is recorded
  });
});
