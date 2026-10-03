// src/services/fraudScreeningService.js
//
// FRAUD SCREENING SERVICE — orchestrates the complete fraud detection pipeline
// and NOW PERSISTS results to Neon PostgreSQL.
//
// Pipeline:
//   Booking → Upsert entities → Generate features → Rules + ML → Aggregate → Decision
//           → Save RiskAssessment + Reasons → Save Decision → Open FraudCase if REVIEW/BLOCK
//           → Write entity_links → Audit log

const { v4: uuidv4 } = require('uuid');
const repo = require('../db/repository');
const { generateFeatures } = require('../features/featureGenerator');
const { evaluateRules } = require('../rules/ruleEngine');
const { scoreShipment } = require('../ml/fraudModel');
const { decisionThresholds, accounts: mockAccounts, payments: mockPayments, fraudSignals: mockFraudSignals, addressConfidence: mockAddressConfidence } = require('./mockData');
const logger = require('../utils/logger');

// ─── DECISION THRESHOLDS ─────────────────────────────────────────────────────
const WEIGHTS = { rules: 0.40, ml: 0.40, graph: 0.20 };

// ─── PUBLIC: screenShipment ──────────────────────────────────────────────────

/**
 * Screen a shipment for fraud — the complete pipeline with DB persistence.
 *
 * @param {object} booking - The booking request data
 * @returns {object} Complete fraud assessment
 */
async function screenShipment(booking) {
  const pipelineStart = Date.now();
  const bookingRef = booking.shipment_id || `SH${uuidv4().split('-')[0].toUpperCase()}`;

  logger.info('🔍 Fraud screening started', { booking_ref: bookingRef, shipper_id: booking.shipper_id });

  // ─── STEP 1: Upsert all entities into Neon ─────────────────────────────────
  let dbIds = {};
  let accountProfile = null;
  let deviceSignalData = null;
  const featuresMeta = { missing_entities: {} };

  try {
    dbIds = await _persistEntities(booking, bookingRef, featuresMeta);
    accountProfile = dbIds.accountProfile;
    deviceSignalData = dbIds.deviceSignalData;
  } catch (dbErr) {
    if (dbErr.name === 'EntityNotFoundError') throw dbErr;
    logger.warn('DB entity lookup/upsert failed', { error: dbErr.message });
    throw dbErr; // Or we can return a 503 Service Unavailable, but let it throw for now
  }

  // ─── STEP 2: Build upstream signal objects (from DB or mock fallback) ───────
  // Note: we removed the mockData fallbacks since Phase 1.1 dictates DB lookup or throw.
  const account = _buildAccountSignal(booking, accountProfile);
  const payment = _buildPaymentSignal(booking, dbIds.paymentRow);
  const deviceSignals = _buildDeviceSignal(booking, dbIds.deviceRow, deviceSignalData);
  const addressData = _buildAddressSignal(booking, dbIds.destAddressRow);

  // ─── STEP 3: Generate engineered features ─────────────────────────────────
  const features = generateFeatures(booking, account, payment, deviceSignals, addressData);
  Object.assign(features._meta, featuresMeta);

  // ─── STEP 4: Run Rule Engine ───────────────────────────────────────────────
  const ruleResult = evaluateRules(features);

  // ─── STEP 5: Run ML Model ─────────────────────────────────────────────────
  const mlResult = await scoreShipment(features, booking.shipment_id || bookingRef);

  // ─── STEP 6: Risk Aggregation ─────────────────────────────────────────────
  const aggregatedRisk = aggregateRisk(ruleResult, mlResult, deviceSignals, features);

  // ─── STEP 7: Decision Engine ──────────────────────────────────────────────
  const decision = makeDecision(aggregatedRisk.risk_score, aggregatedRisk.risk_level);

  // ─── STEP 8: Generate top reasons ─────────────────────────────────────────
  const topReasons = generateTopReasons(ruleResult, mlResult, features);

  // ─── STEP 9: Signal breakdown ─────────────────────────────────────────────
  const signalBreakdown = computeSignalBreakdown(ruleResult, mlResult);

  // ─── STEP 10: Persist assessment + decision to Neon ───────────────────────
  let assessment_id = null;
  if (dbIds.shipmentId) {
    try {
      assessment_id = await repo.saveRiskAssessment({
        shipment_id: dbIds.shipmentId,
        risk_score: aggregatedRisk.risk_score,
        risk_level: aggregatedRisk.risk_level,
        fraud_probability: mlResult.fraud_probability,
        rule_score: ruleResult.rule_score,
        ml_score: mlResult.ml_score,
        rule_set_version: ruleResult.rules_version,
        model_version: mlResult.model_version,
        features: { behavioral: features.behavioral, identity: features.identity, payment: features.payment },
        triggered_rules: ruleResult.triggered_rules,
      });

      // Status mapping
      const statusMap = {
        ALLOW: 'ALLOWED', ALLOW_MONITOR: 'ALLOWED',
        VERIFY: 'SCREENING', REVIEW: 'HELD', BLOCK: 'BLOCKED',
      };

      const promises = [
        repo.saveDecision({
          shipment_id: dbIds.shipmentId,
          assessment_id,
          action: decision.action,
          reason: decision.reason,
        }),
        repo.updateShipmentStatus(dbIds.shipmentId, statusMap[decision.action] || 'SCREENING'),
        repo.logAuditEvent({
          action: 'SCREENED',
          entity_type: 'SHIPMENT',
          entity_id: dbIds.shipmentId,
          shipment_id: dbIds.shipmentId,
          after_state: { 
            risk_score: aggregatedRisk.risk_score, 
            action: decision.action,
            missing_entities: features._meta.missing_entities
          },
        }),
      ];

      // Auto-open fraud case for REVIEW or BLOCK
      if (decision.action === 'REVIEW' || decision.action === 'BLOCK') {
        promises.push(
          repo.openFraudCase({
            shipment_id: dbIds.shipmentId,
            assessment_id,
            account_id: dbIds.accountId,
            risk_level: aggregatedRisk.risk_level,
          })
        );
      }

      // Write entity links to fraud graph
      if (dbIds.accountId && dbIds.deviceId) {
        promises.push(
          repo.upsertEntityLink({
            src_type: 'ACCOUNT', src_id: dbIds.accountId,
            dst_type: 'DEVICE', dst_id: dbIds.deviceId, link_type: 'USES_DEVICE',
          })
        );
      }
      if (dbIds.accountId && dbIds.paymentId) {
        promises.push(
          repo.upsertEntityLink({
            src_type: 'ACCOUNT', src_id: dbIds.accountId,
            dst_type: 'PAYMENT', dst_id: dbIds.paymentId, link_type: 'USES_PAYMENT',
          })
        );
      }
      if (dbIds.accountId && dbIds.shipmentId) {
        promises.push(
          repo.upsertEntityLink({
            src_type: 'ACCOUNT', src_id: dbIds.accountId,
            dst_type: 'SHIPMENT', dst_id: dbIds.shipmentId, link_type: 'SHIPS_TO',
          })
        );
      }

      await Promise.all(promises);

      // Update shipper profile in background
      if (dbIds.accountId) {
        repo.upsertShipperProfile(dbIds.accountId).catch(() => {});
      }
    } catch (persistErr) {
      logger.error('Failed to persist assessment to DB', { error: persistErr.message });
    }
  }

  const totalMs = Date.now() - pipelineStart;

  logger.info('🛡️ Fraud screening completed', {
    booking_ref: bookingRef,
    risk_score: aggregatedRisk.risk_score,
    risk_level: aggregatedRisk.risk_level,
    decision: decision.action,
    assessment_id,
    latency_ms: totalMs,
  });

  return {
    shipment_id: bookingRef,
    db_ids: { shipment_id: dbIds.shipmentId, assessment_id },
    risk: {
      fraud_probability: mlResult.fraud_probability,
      risk_score: aggregatedRisk.risk_score,
      risk_level: aggregatedRisk.risk_level,
    },
    decision: { action: decision.action, reason: decision.reason },
    signals: signalBreakdown,
    top_reasons: topReasons,
    component_scores: {
      rule_score: ruleResult.rule_score,
      ml_score: mlResult.ml_score,
      device_risk_score: deviceSignals?.risk_score || 0,
      address_confidence: addressData?.confidence_score || 0,
    },
    triggered_rules: ruleResult.triggered_rules,
    model: { model_version: mlResult.model_version, rules_version: ruleResult.rules_version },
    pipeline: {
      signal_gather_ms: 0,
      feature_generation_ms: features._meta?.feature_generation_ms || 0,
      rule_evaluation_ms: ruleResult.evaluation_ms || 0,
      ml_scoring_ms: mlResult.scoring_ms || 0,
      total_latency_ms: totalMs,
    },
    _input_snapshot: booking,
    _features: features,
    _account_found: !!account,
    _payment_found: !!payment,
  };
}


// ─── ENTITY PERSISTENCE ───────────────────────────────────────────────────────

async function _persistEntities(booking, bookingRef, featuresMeta) {
  const autocreate = process.env.DEMO_AUTOCREATE_ENTITIES === 'true';
  let shipperId, accountId, deviceRow, paymentRow, originAddr, destAddr, accountProfile;
  let deviceId = null, paymentId = null;

  if (autocreate) {
    shipperId = await repo.upsertShipper({ external_ref: booking.shipper_id, company_name: booking.shipper_id });
    accountId = await repo.upsertAccount({ shipper_id: shipperId, account_number: booking.shipper_id });
    
    [deviceRow, paymentRow, originAddr, destAddr, accountProfile] = await Promise.all([
      repo.upsertDevice({ fingerprint_hash: booking.device_id || `unknown-${Date.now()}`, device_type: 'api-client' }),
      booking.payment_id ? repo.upsertPayment({ payment_token: booking.payment_id, method_type: 'CREDIT_CARD' }) : Promise.resolve(null),
      repo.upsertAddress({ city: booking.origin || 'Unknown', country: 'IN' }),
      repo.upsertAddress({ city: booking.destination || 'Unknown', country: 'IN' }),
      repo.getAccountProfile(booking.shipper_id),
    ]);
    deviceId = deviceRow.device_id;
    paymentId = paymentRow ? paymentRow.payment_id : null;
  } else {
    // Normal mode: do not autocreate shipper/account/device/payment.
    accountProfile = await repo.getAccountProfile(booking.shipper_id);
    if (!accountProfile) {
      const { EntityNotFoundError } = require('../utils/errors');
      throw new EntityNotFoundError(`Account ${booking.shipper_id} not found.`);
    }
    accountId = accountProfile.account_id;
    shipperId = accountProfile.shipper_ref; // Wait, actually getAccountProfile doesn't return shipper_id UUID, but we need it for shipments table.
    
    // Let's get actual shipper_id from accounts table via getAccountProfile? No, we need to modify getAccountProfile to return shipper_id.
    // For now, I'll add a quick query if needed. Or I can just fetch it:
    
    [deviceRow, paymentRow] = await Promise.all([
      repo.getDevice(booking.device_id || ''),
      booking.payment_id ? repo.getPayment(booking.payment_id) : Promise.resolve(null)
    ]);
    
    deviceId = deviceRow ? deviceRow.device_id : null;
    paymentId = paymentRow ? paymentRow.payment_id : null;
    
    if (!deviceRow) featuresMeta.missing_entities = { ...featuresMeta.missing_entities, device: true };
    if (!paymentRow && booking.payment_id) featuresMeta.missing_entities = { ...featuresMeta.missing_entities, payment: true };

    // We STILL need to upsert addresses because addresses are ephemeral per shipment usually
    [originAddr, destAddr] = await Promise.all([
      repo.upsertAddress({ city: booking.origin || 'Unknown', country: 'IN' }),
      repo.upsertAddress({ city: booking.destination || 'Unknown', country: 'IN' }),
    ]);
  }

  // Link device/payment and fetch signals in parallel
  let deviceSignalData = null;
  if (deviceId) {
    const promises = [repo.getDeviceFraudSignals(deviceId)];
    if (autocreate) {
      promises.push(repo.linkDeviceToAccount(accountId, deviceId).catch(() => {}));
      if (paymentId) promises.push(repo.linkPaymentToAccount(accountId, paymentId, null).catch(() => {}));
    }
    const results = await Promise.all(promises);
    deviceSignalData = results[0];
  }

  // 7. Shipment
  // 7. Shipment (We need shipper_id! getAccountProfile needs to return it.)
  const shipmentRow = await repo.createShipment({
    booking_ref: bookingRef,
    account_id: accountId,
    shipper_id: autocreate ? shipperId : accountProfile.shipper_id, 
    device_id: deviceId,
    payment_id: paymentId,
    origin_address_id: originAddr.address_id,
    dest_address_id: destAddr.address_id,
    service: booking.service_type || 'GROUND',
    weight_kg: booking.weight || 1,
    package_count: booking.package_count || 1,
    ip_address: booking.ip_address,
    booked_at: booking.booking_timestamp || new Date().toISOString(),
  });

  return {
    shipperId: autocreate ? shipperId : accountProfile.shipper_id, accountId, deviceId,
    paymentId, deviceRow, paymentRow,
    originAddressRow: originAddr, destAddressRow: destAddr,
    shipmentId: shipmentRow.shipment_id,
    accountProfile, deviceSignalData,
  };
}

// ─── SIGNAL BUILDERS (bridge DB data → mock-compatible format) ────────────────

function _buildAccountSignal(booking, dbProfile) {
  if (!dbProfile) {
    // Unknown shipper — treat as new account (genuinely high risk)
    return {
      shipper_id: booking.shipper_id,
      account_status: 'ACTIVE',
      account_tier: 'BUSINESS',
      account_age_days: 0,
      verified: false,
      historical_profile: {
        total_shipments: 0, avg_shipments_per_day: 0, avg_weight: 0,
        max_historical_weight: 0, usual_origins: [], usual_destinations: [],
        usual_service_types: [], usual_booking_hours: [],
      },
      security: {
        last_password_change: null, last_profile_update: null,
        known_devices: [], known_payment_ids: [],
      },
      historical_fraud: { previous_fraud_cases: 0, previous_review_cases: 0 },
    };
  }

  // ── mockData.js format (has historical_profile, security, historical_fraud directly) ──
  if (dbProfile.historical_profile) {
    return dbProfile;   // already in the right shape — pass straight through
  }

  // ── PostgreSQL DB row format ──
  return {
    shipper_id: booking.shipper_id,
    account_status: dbProfile.status || 'ACTIVE',
    account_tier: dbProfile.account_type || 'BUSINESS',
    account_age_days: dbProfile.opened_at
      ? Math.floor((Date.now() - new Date(dbProfile.opened_at)) / 86400000) : 0,
    verified: true,
    historical_profile: {
      total_shipments: parseInt(dbProfile.total_shipments) || 0,
      avg_shipments_per_day: parseFloat(dbProfile.avg_daily_volume) || 0,
      avg_weight: parseFloat(dbProfile.avg_weight_kg) || 0,
      max_historical_weight: parseFloat(dbProfile.avg_weight_kg) * 3 || 30,
      usual_origins: dbProfile.common_origins || [],
      usual_destinations: dbProfile.common_destinations || [],
      usual_service_types: Object.keys(dbProfile.service_mix || {}),
      usual_booking_hours: dbProfile.hour_histogram
        ? dbProfile.hour_histogram.reduce((acc, v, i) => v > 0 ? [...acc, i] : acc, [])
        : [],
    },
    security: {
      last_password_change: dbProfile.last_password_change_at,
      last_profile_update: dbProfile.last_profile_change_at,
      known_devices: dbProfile.known_devices || [],
      known_payment_ids: dbProfile.known_payments || [],
    },
    historical_fraud: {
      previous_fraud_cases: parseInt(dbProfile.fraud_count) || 0,
      previous_review_cases: 0,
    },
  };
}

function _buildPaymentSignal(booking, paymentRow) {
  if (!booking.payment_id) return null;

  const isNew = paymentRow ? new Date(paymentRow.first_seen_at) > new Date(Date.now() - 3600000) : true;
  return {
    payment_id: booking.payment_id,
    payment_type: 'CREDIT_CARD',
    status: 'ACTIVE',
    card: { last4: null, issuer_country: 'IN', cardholder_name: null, cardholder_match: true },
    history: {
      first_seen: paymentRow?.first_seen_at || new Date().toISOString(),
      previous_transactions: 0,
      previous_shipments: 0,
      amount_spend_30d: 0,
    },
    risk: {
      new_payment_method: isNew !== false,
      billing_shipping_match: true,
      previous_fraud_count: paymentRow?.is_flagged ? 1 : 0,
    },
  };
}

function _buildDeviceSignal(booking, deviceRow, signalData) {
  if (!deviceRow) {
    return {
      device_id: booking.device_id || 'unknown',
      device: { status: 'UNKNOWN', first_seen: new Date().toISOString(), known_device: false, accounts_linked: 0 },
      ip: { address: booking.ip_address, country: 'UNKNOWN', reputation: 'UNKNOWN', vpn_detected: false, proxy_detected: false },
      fraud_signals: { device_blacklisted: false, ip_blacklisted: false, device_linked_to_fraud: false, linked_fraud_accounts: [] },
      risk_score: 40,
    };
  }
  const linkedFraudAccounts = (signalData?.linked_accounts || []);
  return {
    device_id: booking.device_id,
    device: {
      status: deviceRow.is_flagged ? 'FLAGGED' : 'ACTIVE',
      first_seen: deviceRow.first_seen_at,
      known_device: deviceRow.linked_account_count > 0,
      accounts_linked: deviceRow.linked_account_count || 0,
    },
    ip: {
      address: booking.ip_address,
      country: 'IN',
      reputation: deviceRow.is_flagged ? 'SUSPICIOUS' : 'CLEAN',
      vpn_detected: false,
      proxy_detected: false,
    },
    fraud_signals: {
      device_blacklisted: deviceRow.is_flagged || false,
      ip_blacklisted: false,
      device_linked_to_fraud: signalData?.signals?.length > 0 || false,
      linked_fraud_accounts: linkedFraudAccounts,
    },
    risk_score: deviceRow.is_flagged ? 80 : linkedFraudAccounts.length > 0 ? 60 : 10,
  };
}

function _buildAddressSignal(booking, addrRow) {
  const city = booking.destination || 'Unknown';
  const score = addrRow?.confidence_score != null ? addrRow.confidence_score / 100 : 0.7;
  return {
    location: city,
    address_valid: true,
    confidence_score: score,
    risk_tier: score >= 0.8 ? 'LOW' : score >= 0.5 ? 'MEDIUM' : 'HIGH',
    signals: [],
  };
}

// ─── RISK PIPELINE FUNCTIONS ──────────────────────────────────────────────────

function aggregateRisk(ruleResult, mlResult, deviceSignals, features) {
  const ruleComponent = ruleResult.rule_score * WEIGHTS.rules;
  const mlComponent = mlResult.ml_score * WEIGHTS.ml;
  const graphComponent = (deviceSignals?.risk_score || 0) * WEIGHTS.graph;

  let riskScore = ruleComponent + mlComponent + graphComponent;

  if (features.identity?.is_suspended) riskScore = Math.max(riskScore, 85);
  if (features.device?.device_blacklisted || features.device?.ip_blacklisted) riskScore = Math.max(riskScore, 80);
  if (features.identity?.previous_fraud_cases >= 3) riskScore = Math.max(riskScore, 90);

  riskScore = Math.round(Math.min(100, Math.max(0, riskScore)));
  return { risk_score: riskScore, risk_level: getRiskLevel(riskScore) };
}

function getRiskLevel(score) {
  const t = decisionThresholds;
  if (score <= t.allow_max)   return 'LOW';
  if (score <= t.monitor_max) return 'MEDIUM';
  if (score <= t.verify_max)  return 'HIGH';
  if (score <= t.review_max)  return 'HIGH';
  return 'CRITICAL';
}

function makeDecision(riskScore) {
  const t = decisionThresholds;
  if (riskScore <= t.allow_max)   return { action: 'ALLOW', reason: 'Risk score within acceptable range' };
  if (riskScore <= t.monitor_max) return { action: 'ALLOW_MONITOR', reason: 'Low-moderate risk — allow but monitor' };
  if (riskScore <= t.verify_max)  return { action: 'VERIFY', reason: 'Moderate risk — request step-up verification' };
  if (riskScore <= t.review_max)  return { action: 'REVIEW', reason: 'High risk — hold for fraud analyst review' };
  return { action: 'BLOCK', reason: 'Critical risk — multiple high-risk signals detected' };
}

function generateTopReasons(ruleResult, mlResult, features) {
  const reasons = [...ruleResult.triggered_rules]
    .filter(r => r.risk_points > 0)
    .sort((a, b) => b.risk_points - a.risk_points)
    .map(r => r.description);
  return [...new Set(reasons)].slice(0, 5);
}

function computeSignalBreakdown(ruleResult, mlResult) {
  const cats = ruleResult.category_breakdown;
  const map = { BEHAVIOR: 'behavioral', IDENTITY: 'identity', PAYMENT: 'payment', DEVICE: 'device', ADDRESS: 'address', VELOCITY: 'velocity' };
  const breakdown = {};
  for (const [cat, label] of Object.entries(map)) {
    const rc = cats[cat]?.points || 0;
    const mc = mlResult.feature_importances?.[label] || 0;
    breakdown[label] = Math.max(0, Math.round(rc + mc));
  }
  return breakdown;
}

module.exports = { screenShipment };
