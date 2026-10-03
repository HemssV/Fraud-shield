// src/ml/fraudModel.js
//
// Mock ML Model — simulates an XGBoost fraud detection model
// In production: this would call a deployed ML model (e.g., SageMaker, Vertex AI)
//
// The mock model uses a weighted heuristic that roughly simulates what a
// trained model would output, based on the engineered features.
// This is sufficient for the prototype to demonstrate the signal fusion concept.
//
// The key principle: the ML model is ONE input to the Risk Aggregator,
// not the final decision maker.

const logger = require('../utils/logger');

/**
 * Score a shipment using the mock ML model.
 *
 * @param {object} features - Engineered features from the Feature Generator
 * @returns {object} ML scoring result with fraud_probability and feature importances
 */
function scoreShipment(features) {
  const startTime = Date.now();

  // ── Calculate component scores ──
  // Each component uses a weighted combination of relevant features,
  // roughly simulating what an XGBoost model would learn.

  let score = 0;
  const importances = {};

  // Behavioral anomaly score (0-25 points)
  const behavioralScore = computeBehavioralScore(features.behavioral);
  score += behavioralScore;
  importances.behavioral = behavioralScore;

  // Identity risk score (0-25 points)
  const identityScore = computeIdentityScore(features.identity);
  score += identityScore;
  importances.identity = identityScore;

  // Payment risk score (0-20 points)
  const paymentScore = computePaymentScore(features.payment);
  score += paymentScore;
  importances.payment = paymentScore;

  // Device risk score (0-20 points)
  const deviceScore = computeDeviceScore(features.device);
  score += deviceScore;
  importances.device = deviceScore;

  // Address risk score (0-10 points)
  const addressScore = computeAddressScore(features.address);
  score += addressScore;
  importances.address = addressScore;

  // Normalize to 0-1 probability
  const fraudProbability = Math.min(1.0, Math.max(0.0, score / 100));

  const result = {
    fraud_probability: Math.round(fraudProbability * 10000) / 10000,
    ml_score: Math.round(score * 100) / 100,
    feature_importances: importances,
    model_version: 'fraud-xgb-v1',
    scoring_ms: Date.now() - startTime,
  };

  logger.debug('ML model scored', {
    probability: result.fraud_probability,
    ml_score: result.ml_score,
    duration_ms: result.scoring_ms,
  });

  return result;
}


function computeBehavioralScore(behavioral) {
  let score = 0;

  // Weight anomaly is a strong signal
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


function computeIdentityScore(identity) {
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

  // Mitigating: well-established account
  if (identity.account_age_days > 365 && identity.previous_fraud_cases === 0) {
    score -= 8;
  }

  return Math.max(0, Math.min(25, score));
}


function computePaymentScore(payment) {
  let score = 0;

  if (!payment.payment_found) score += 10;
  if (payment.is_new_payment_method) score += 7;
  if (!payment.cardholder_match && payment.payment_found) score += 5;
  if (!payment.billing_shipping_match && payment.payment_found) score += 4;
  if (payment.previous_fraud_count > 0) score += 15;
  if (payment.foreign_card) score += 3;

  // Mitigating: well-used payment
  if (payment.previous_transactions > 50) score -= 5;

  return Math.max(0, Math.min(20, score));
}


function computeDeviceScore(device) {
  let score = 0;

  if (!device.known_device) score += 5;
  if (device.device_blacklisted) score += 18;
  if (device.ip_blacklisted) score += 15;
  if (device.device_linked_to_fraud) score += 10;
  if (device.vpn_detected) score += 5;
  if (device.proxy_detected) score += 7;
  if (device.accounts_linked >= 5) score += 6;
  if (['SUSPICIOUS', 'HIGH_RISK'].includes(device.ip_reputation)) score += 5;

  // Mitigating: known device
  if (device.known_for_this_account) score -= 5;

  return Math.max(0, Math.min(20, score));
}


function computeAddressScore(address) {
  let score = 0;

  if (!address.address_valid) score += 8;
  if (address.risk_tier === 'HIGH') score += 6;
  else if (address.risk_tier === 'MEDIUM') score += 3;

  if (address.confidence_score < 0.5) score += 5;
  else if (address.confidence_score < 0.7) score += 2;

  // Mitigating: high confidence
  if (address.confidence_score >= 0.9) score -= 3;

  return Math.max(0, Math.min(10, score));
}


module.exports = { scoreShipment };
