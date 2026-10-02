// src/services/fraudScreeningService.js
//
// FRAUD SCREENING SERVICE — the heart of FraudShield
//
// This is the orchestration layer that implements the complete fraud detection pipeline:
//
//   Booking → Gather Signals → Generate Features → Rules + ML + Graph → Risk Aggregator → Decision
//
// Architecture principle: upstream services provide SIGNALS, not decisions.
// The Risk Aggregator fuses signals from all sources into a single risk score,
// and the Decision Engine maps that score to an action.
//
// Signal Fusion Flow:
//   Account API  → "Device D88 is new"
//   Payment API  → "Payment P19 is new"
//   Fraud Signal → "D88 linked to flagged accounts"
//   Address API  → "Destination confidence = 61%"
//   Behavior     → "Weight is 3× normal"
//   ML Model     → "Fraud probability = 0.87"
//                    ↓
//            RISK AGGREGATOR
//                    ↓
//           FINAL RISK = 91/100
//                    ↓
//            HOLD FOR REVIEW

const { v4: uuidv4 } = require('uuid');
const { getAccount } = require('./accountService');
const { getPayment } = require('./paymentService');
const { getFraudSignals } = require('./fraudSignalService');
const { getAddressConfidence } = require('./addressService');
const { generateFeatures } = require('../features/featureGenerator');
const { evaluateRules } = require('../rules/ruleEngine');
const { scoreShipment } = require('../ml/fraudModel');
const { decisionThresholds } = require('./mockData');
const logger = require('../utils/logger');


/**
 * Screen a shipment for fraud — the complete pipeline.
 *
 * @param {object} booking - The booking request data
 * @returns {object} Complete fraud assessment with risk score, decision, signals, and reasons
 */
async function screenShipment(booking) {
  const pipelineStart = Date.now();
  const shipmentId = booking.shipment_id || `SH${Date.now()}`;

  logger.info('🔍 Fraud screening started', { shipment_id: shipmentId, shipper_id: booking.shipper_id });

  // ─── STEP 1: Gather upstream signals (parallel in production) ────────
  const gatherStart = Date.now();

  const account = getAccount(booking.shipper_id);
  const payment = getPayment(booking.payment_id);
  const deviceSignals = getFraudSignals(booking.device_id);
  const addressData = getAddressConfidence(
    booking.destination_address_id || booking.destination
  );

  const gatherMs = Date.now() - gatherStart;
  logger.debug('Upstream signals gathered', { duration_ms: gatherMs });

  // ─── STEP 2: Generate engineered features ────────────────────────────
  const features = generateFeatures(booking, account, payment, deviceSignals, addressData);

  // ─── STEP 3: Run Rule Engine ─────────────────────────────────────────
  const ruleResult = evaluateRules(features);

  // ─── STEP 4: Run ML Model ───────────────────────────────────────────
  const mlResult = scoreShipment(features);

  // ─── STEP 5: Risk Aggregation (signal fusion) ───────────────────────
  const aggregatedRisk = aggregateRisk(ruleResult, mlResult, deviceSignals, features);

  // ─── STEP 6: Decision Engine ─────────────────────────────────────────
  const decision = makeDecision(aggregatedRisk.risk_score, aggregatedRisk.risk_level);

  // ─── STEP 7: Generate top reasons ───────────────────────────────────
  const topReasons = generateTopReasons(ruleResult, mlResult, features);

  // ─── STEP 8: Compute signal contribution breakdown ──────────────────
  const signalBreakdown = computeSignalBreakdown(ruleResult, mlResult);

  const totalMs = Date.now() - pipelineStart;

  const assessment = {
    shipment_id: shipmentId,

    risk: {
      fraud_probability: mlResult.fraud_probability,
      risk_score: aggregatedRisk.risk_score,
      risk_level: aggregatedRisk.risk_level,
    },

    decision: {
      action: decision.action,
      reason: decision.reason,
    },

    signals: signalBreakdown,

    top_reasons: topReasons,

    component_scores: {
      rule_score: ruleResult.rule_score,
      ml_score: mlResult.ml_score,
      device_risk_score: deviceSignals?.risk_score || 0,
      address_confidence: addressData?.confidence_score || 0,
    },

    triggered_rules: ruleResult.triggered_rules,

    model: {
      model_version: mlResult.model_version,
      rules_version: ruleResult.rules_version,
    },

    pipeline: {
      signal_gather_ms: gatherMs,
      feature_generation_ms: features._meta.feature_generation_ms,
      rule_evaluation_ms: ruleResult.evaluation_ms,
      ml_scoring_ms: mlResult.scoring_ms,
      total_latency_ms: totalMs,
    },

    // For audit trail reproducibility
    _input_snapshot: booking,
    _features: features,
    _account_found: !!account,
    _payment_found: !!payment,
  };

  logger.info('🛡️ Fraud screening completed', {
    shipment_id: shipmentId,
    risk_score: aggregatedRisk.risk_score,
    risk_level: aggregatedRisk.risk_level,
    decision: decision.action,
    latency_ms: totalMs,
  });

  return assessment;
}


/**
 * Risk Aggregator — fuses signals from rules, ML, and graph into a single risk score.
 *
 * Weights:
 *   Rule Engine:    40%  (deterministic, explainable)
 *   ML Model:       40%  (statistical patterns)
 *   Device/Graph:   20%  (entity relationship signals)
 */
function aggregateRisk(ruleResult, mlResult, deviceSignals, features) {
  const WEIGHTS = {
    rules: 0.40,
    ml: 0.40,
    graph: 0.20,
  };

  const ruleComponent = ruleResult.rule_score * WEIGHTS.rules;
  const mlComponent = mlResult.ml_score * WEIGHTS.ml;
  const graphComponent = (deviceSignals?.risk_score || 0) * WEIGHTS.graph;

  let riskScore = ruleComponent + mlComponent + graphComponent;

  // Apply floor/ceiling adjustments for critical signals
  // These override the weighted average to prevent false negatives
  if (features.identity.is_suspended) {
    riskScore = Math.max(riskScore, 85);
  }
  if (features.device.device_blacklisted || features.device.ip_blacklisted) {
    riskScore = Math.max(riskScore, 80);
  }
  if (features.identity.previous_fraud_cases >= 3) {
    riskScore = Math.max(riskScore, 90);
  }

  riskScore = Math.round(Math.min(100, Math.max(0, riskScore)));

  const riskLevel = getRiskLevel(riskScore);

  return { risk_score: riskScore, risk_level: riskLevel };
}


/**
 * Map risk score to risk level using configurable thresholds.
 *
 * 0 ───────── 30 ───────── 50 ───────── 70 ───────── 85 ───────── 100
 *      LOW         MEDIUM       MEDIUM-HIGH      HIGH         CRITICAL
 */
function getRiskLevel(score) {
  const t = decisionThresholds;
  if (score <= t.allow_max)   return 'LOW';
  if (score <= t.monitor_max) return 'MEDIUM';
  if (score <= t.verify_max)  return 'HIGH';
  if (score <= t.review_max)  return 'HIGH';
  return 'CRITICAL';
}


/**
 * Decision Engine — maps risk level to an action.
 *
 * LOW      → ALLOW          (no friction)
 * MEDIUM   → ALLOW_MONITOR  (allow but flag for pattern analysis)
 * HIGH     → VERIFY         (request step-up verification from account owner)
 * HIGH     → REVIEW         (hold for fraud analyst review)
 * CRITICAL → BLOCK          (block shipment)
 */
function makeDecision(riskScore, riskLevel) {
  const t = decisionThresholds;

  if (riskScore <= t.allow_max) {
    return { action: 'ALLOW', reason: 'Risk score within acceptable range' };
  }
  if (riskScore <= t.monitor_max) {
    return { action: 'ALLOW_MONITOR', reason: 'Low-moderate risk — allow but monitor for patterns' };
  }
  if (riskScore <= t.verify_max) {
    return { action: 'VERIFY', reason: 'Moderate risk — request step-up verification from account owner' };
  }
  if (riskScore <= t.review_max) {
    return { action: 'REVIEW', reason: 'High risk — hold for fraud analyst review' };
  }
  return { action: 'BLOCK', reason: 'Critical risk — multiple high-risk signals detected' };
}


/**
 * Generate human-readable top reasons for the fraud assessment.
 * Sorted by risk contribution (highest first), limited to top 5.
 */
function generateTopReasons(ruleResult, mlResult, features) {
  const reasons = [];

  // Add triggered rule descriptions (sorted by risk_points descending)
  const sortedRules = [...ruleResult.triggered_rules]
    .filter(r => r.risk_points > 0)  // only suspicious signals, not mitigating
    .sort((a, b) => b.risk_points - a.risk_points);

  for (const rule of sortedRules) {
    reasons.push(rule.description);
  }

  // Deduplicate and limit to top 5
  const uniqueReasons = [...new Set(reasons)];
  return uniqueReasons.slice(0, 5);
}


/**
 * Compute signal contribution breakdown by category.
 * Shows how much each category contributed to the total risk score.
 */
function computeSignalBreakdown(ruleResult, mlResult) {
  const breakdown = {};
  const categories = ruleResult.category_breakdown;

  // Map rule categories to the response format
  const categoryMap = {
    BEHAVIOR: 'behavioral',
    IDENTITY: 'identity',
    PAYMENT: 'payment',
    DEVICE: 'device',
    ADDRESS: 'address',
    VELOCITY: 'velocity',
  };

  for (const [cat, label] of Object.entries(categoryMap)) {
    const ruleContribution = categories[cat]?.points || 0;
    const mlContribution = mlResult.feature_importances[label] || 0;
    breakdown[label] = Math.max(0, Math.round(ruleContribution + mlContribution));
  }

  return breakdown;
}


module.exports = { screenShipment };
