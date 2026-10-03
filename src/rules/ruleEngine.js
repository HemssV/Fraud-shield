// src/rules/ruleEngine.js
//
// Rule Engine — evaluates declarative fraud rules against engineered features.
// Each rule contributes risk_points (positive = suspicious, negative = mitigating).
//
// Rules are organized by category:
//   BEHAVIOR  — unusual patterns vs historical profile
//   IDENTITY  — account takeover / misuse signals
//   PAYMENT   — payment fraud indicators
//   DEVICE    — device/IP reputation signals
//   ADDRESS   — destination risk
//   VELOCITY  — timing and frequency anomalies
//
// The output is a list of triggered rules with their risk_points,
// NOT a final decision. The Risk Aggregator combines rules + ML + graph scores.

const logger = require('../utils/logger');

// ─── RULE DEFINITIONS (version: rules-v1) ─────────────────────────────

const { RULES } = require('./constants/rules');
const { validateRules } = require('./validateRules');

// Validate rules strictly at startup
validateRules(RULES);


/**
 * Evaluate all rules against the feature set.
 *
 * @param {object} features - Engineered features from the Feature Generator
 * @returns {object} Rule evaluation result with triggered rules, total score, and category breakdown
 */
function evaluateRules(features) {
  const startTime = Date.now();
  const triggeredRules = [];

  for (const rule of RULES) {
    try {
      if (rule.evaluate(features)) {
        triggeredRules.push({
          code: rule.code,
          name: rule.name,
          category: rule.category,
          risk_points: rule.risk_points,
          description: rule.description(features),
        });
      }
    } catch (err) {
      logger.warn('Rule evaluation error', { rule: rule.code, error: err.message });
    }
  }

  // Calculate total risk points (min 0, max 100)
  const rawScore = triggeredRules.reduce((sum, r) => sum + r.risk_points, 0);
  const ruleScore = Math.max(0, Math.min(100, rawScore));

  // Category breakdown
  const categories = {};
  for (const rule of triggeredRules) {
    if (!categories[rule.category]) {
      categories[rule.category] = { points: 0, rules: [] };
    }
    categories[rule.category].points += rule.risk_points;
    categories[rule.category].rules.push(rule.code);
  }

  const result = {
    rule_score: ruleScore,
    raw_score: rawScore,
    triggered_count: triggeredRules.length,
    triggered_rules: triggeredRules,
    category_breakdown: categories,
    rules_version: 'rules-v1',
    evaluation_ms: Date.now() - startTime,
  };

  logger.debug('Rules evaluated', {
    score: ruleScore,
    triggered: triggeredRules.length,
    duration_ms: result.evaluation_ms,
  });

  return result;
}


module.exports = { evaluateRules, RULES };
