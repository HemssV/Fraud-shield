// src/ml/fraudModel.js
//
// ML Model Adapter — calls the Python ML Microservice (port 8001).
// Falls back to a local heuristic if the service is unreachable or too slow.
//
// The real model is: IsolationForest anomaly score → LightGBM → Isotonic calibration
// Trained on 180 days × 2000 shippers synthetic data. PR-AUC: 0.789, ROC-AUC: 0.913.
//
// Environment variables:
//   ML_SERVICE_URL  — base URL for the ML microservice (default: http://localhost:8001)
//   ML_MOCK_MODE    — set to "true" to skip the real model and use the local heuristic

const axios = require('axios');
const logger = require('../utils/logger');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8001';
const ML_MOCK_MODE = process.env.ML_MOCK_MODE === 'true';

// ── LOCAL HEURISTIC FALLBACK ─────────────────────────────────────────────────
// Kept verbatim from the original fraudModel.js so fallback is identical.

function _computeBehavioralScore(behavioral) {
  let score = 0;
  if (behavioral.weight_z_score > 3) score += 10;
  else if (behavioral.weight_z_score > 2) score += 6;
  else if (behavioral.weight_z_score > 1) score += 3;
  if (behavioral.is_new_destination) score += 5;
  if (behavioral.is_new_origin) score += 3;
  if (behavioral.is_unusual_service) score += 3;
  if (behavioral.is_unusual_hour) score += 3;
  if (behavioral.is_low_history) score += 5;
  if (behavioral.weight_exceeds_max) score += 4;
  return Math.min(25, score);
}

function _computeIdentityScore(identity) {
  let score = 0;
  if (identity.is_suspended) score += 20;
  if (identity.is_under_investigation) score += 15;
  if (identity.previous_fraud_cases > 0) score += 18;
  if (identity.is_new_device) score += 8;
  if (identity.is_new_payment_for_account) score += 5;
  if (identity.password_changed_recently) score += 7;
  if (identity.profile_updated_recently) score += 4;
  if (identity.is_new_account) score += 6;
  if (!identity.is_verified) score += 5;
  if (identity.account_age_days > 365 && identity.previous_fraud_cases === 0) score -= 8;
  return Math.max(0, Math.min(25, score));
}

function _computePaymentScore(payment) {
  let score = 0;
  if (!payment.payment_found) score += 10;
  if (payment.is_new_payment_method) score += 7;
  if (!payment.cardholder_match && payment.payment_found) score += 5;
  if (!payment.billing_shipping_match && payment.payment_found) score += 4;
  if (payment.previous_fraud_count > 0) score += 15;
  if (payment.foreign_card) score += 3;
  if (payment.previous_transactions > 50) score -= 5;
  return Math.max(0, Math.min(20, score));
}

function _computeDeviceScore(device) {
  let score = 0;
  if (!device.known_device) score += 5;
  if (device.device_blacklisted) score += 18;
  if (device.ip_blacklisted) score += 15;
  if (device.device_linked_to_fraud) score += 10;
  if (device.vpn_detected) score += 5;
  if (device.proxy_detected) score += 7;
  if (device.accounts_linked >= 5) score += 6;
  if (['SUSPICIOUS', 'HIGH_RISK'].includes(device.ip_reputation)) score += 5;
  if (device.known_for_this_account) score -= 5;
  return Math.max(0, Math.min(20, score));
}

function _computeAddressScore(address) {
  let score = 0;
  if (!address.address_valid) score += 8;
  if (address.risk_tier === 'HIGH') score += 6;
  else if (address.risk_tier === 'MEDIUM') score += 3;
  if (address.confidence_score < 0.5) score += 5;
  else if (address.confidence_score < 0.7) score += 2;
  if (address.confidence_score >= 0.9) score -= 3;
  return Math.max(0, Math.min(10, score));
}

function _scoreShipmentLocal(features) {
  const behavioralScore = _computeBehavioralScore(features.behavioral || {});
  const identityScore   = _computeIdentityScore(features.identity || {});
  const paymentScore    = _computePaymentScore(features.payment || {});
  const deviceScore     = _computeDeviceScore(features.device || {});
  const addressScore    = _computeAddressScore(features.address || {});

  const score = behavioralScore + identityScore + paymentScore + deviceScore + addressScore;
  const fraudProbability = Math.min(1.0, Math.max(0.0, score / 100));

  return {
    fraud_probability: Math.round(fraudProbability * 10000) / 10000,
    ml_score: Math.round(score * 100) / 100,
    feature_importances: {
      behavioral: behavioralScore,
      identity:   identityScore,
      payment:    paymentScore,
      device:     deviceScore,
      address:    addressScore,
      velocity:   0,
    },
    model_version: 'fraud-xgb-v1-mock',
    scoring_ms: 1,
  };
}


// ── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Score a shipment using the Python ML Microservice.
 * Falls back to the local heuristic on ANY failure to maintain uptime.
 *
 * NOTE: This function is now ASYNC. The call site must use `await`.
 *
 * @param {object} features    - Engineered features from featureGenerator.js
 * @param {string} shipment_id - Booking ref (for logging & tracing)
 * @returns {Promise<object>}  - ML scoring result
 */
async function scoreShipment(features, shipment_id = 'unknown') {
  const startTime = Date.now();

  // ── Mock mode: skip network call entirely ──
  if (ML_MOCK_MODE) {
    logger.debug('ML Service: mock mode active (ML_MOCK_MODE=true)');
    const result = _scoreShipmentLocal(features);
    result.scoring_ms = Date.now() - startTime;
    return result;
  }

  // ── Call the real ML microservice ──
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/score`,
      { shipment_id, features },
      { timeout: 2000 }   // strict 2-second timeout
    );

    const r = response.data;
    logger.debug('ML Service: real model scored', {
      shipment_id,
      fraud_probability: r.fraud_probability,
      ml_score: r.ml_score,
      model_version: r.model_version,
      scoring_ms: r.scoring_ms,
    });

    return {
      fraud_probability:  r.fraud_probability,
      ml_score:           r.ml_score,
      feature_importances: r.feature_importances || {},
      model_version:      r.model_version || 'v1',
      anomaly_score:      r.anomaly_score,
      top_reasons:        r.top_reasons || [],
      risk_level:         r.risk_level,
      scoring_ms:         Date.now() - startTime,
    };

  } catch (err) {
    // ── Graceful degradation ──
    logger.warn('ML Service unreachable or timed out — falling back to local heuristic', {
      shipment_id,
      error: err.message,
      ml_service_url: ML_SERVICE_URL,
    });

    const fallback = _scoreShipmentLocal(features);
    fallback.model_version = fallback.model_version + '-fallback';
    fallback.scoring_ms = Date.now() - startTime;
    return fallback;
  }
}


module.exports = { scoreShipment };
