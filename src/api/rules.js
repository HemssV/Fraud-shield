// src/api/rules.js — POST /api/rules/evaluate
// Standalone rule engine endpoint (Backend A spec item)

const express = require('express');
const router = express.Router();
const { evaluateRules } = require('../rules/ruleEngine');

/**
 * POST /api/rules/evaluate
 *
 * Evaluate the deterministic rule engine against a supplied feature set.
 * Used by Backend B and the ML team to test rule scoring in isolation.
 *
 * Body: { features: { behavioral: {}, identity: {}, payment: {}, device: {}, address: {} } }
 */
router.post('/', (req, res, next) => {
  try {
    const { features } = req.body;
    if (!features) {
      return res.status(400).json({ error: 'features object is required' });
    }

    const result = evaluateRules(features);

    return res.json({
      rule_score: result.rule_score,
      rules_version: result.rules_version,
      triggered_rules: result.triggered_rules.map(r => ({
        code: r.code,
        name: r.name,
        category: r.category,
        risk_points: r.risk_points,
        description: r.description,
      })),
      category_breakdown: result.category_breakdown,
      evaluation_ms: result.evaluation_ms,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
