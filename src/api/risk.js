// src/api/risk.js — POST /api/risk/calculate
// Standalone risk calculation endpoint (Backend A spec item)

const express = require('express');
const router = express.Router();
const { scoreShipment } = require('../ml/fraudModel');

/**
 * POST /api/risk/calculate
 *
 * Given rule results and ML output, compute the aggregated risk score.
 * Useful for Backend B and the frontend to replay risk calculations.
 *
 * Body:
 * {
 *   rule_score:    65,
 *   ml_score:      72,
 *   device_score:  40,
 *   features:      { ... }  // optional, used for hard overrides
 * }
 */
router.post('/', (req, res, next) => {
  try {
    const { rule_score, ml_score, device_score = 0, features = {} } = req.body;

    if (rule_score === undefined || ml_score === undefined) {
      return res.status(400).json({ error: 'rule_score and ml_score are required' });
    }

    const WEIGHTS = { rules: 0.40, ml: 0.40, graph: 0.20 };
    let riskScore =
      (rule_score  * WEIGHTS.rules) +
      (ml_score    * WEIGHTS.ml) +
      (device_score * WEIGHTS.graph);

    // Hard-override adjustments (same as main pipeline)
    if (features.identity?.is_suspended)              riskScore = Math.max(riskScore, 85);
    if (features.device?.device_blacklisted)          riskScore = Math.max(riskScore, 80);
    if (features.identity?.previous_fraud_cases >= 3) riskScore = Math.max(riskScore, 90);

    riskScore = Math.round(Math.min(100, Math.max(0, riskScore)));

    const getRiskLevel = (s) => {
      if (s <= 30) return 'LOW';
      if (s <= 50) return 'MEDIUM';
      if (s <= 70) return 'HIGH';
      if (s <= 85) return 'HIGH';
      return 'CRITICAL';
    };

    const getAction = (s) => {
      if (s <= 30) return 'ALLOW';
      if (s <= 50) return 'ALLOW_MONITOR';
      if (s <= 70) return 'VERIFY';
      if (s <= 85) return 'REVIEW';
      return 'BLOCK';
    };

    const risk_level = getRiskLevel(riskScore);
    const action = getAction(riskScore);

    return res.json({
      risk_score: riskScore,
      risk_level,
      action,
      components: {
        rule_component:   Math.round(rule_score  * WEIGHTS.rules),
        ml_component:     Math.round(ml_score    * WEIGHTS.ml),
        graph_component:  Math.round(device_score * WEIGHTS.graph),
      },
      weights: WEIGHTS,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
