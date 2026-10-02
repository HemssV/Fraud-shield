// src/api/payments.js
// GET /api/payments/:payment_id
// Returns payment data — DB-first, mock fallback.

const express = require('express');
const router = express.Router();
const db = require('../db/index');
const { payments: mockPayments } = require('../services/mockData');
const logger = require('../utils/logger');

router.get('/:payment_id', async (req, res, next) => {
  const { payment_id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT
         p.payment_id, p.payment_token, p.method_type, p.last4,
         p.issuer_country, p.first_seen_at, p.failed_attempt_count, p.is_flagged,
         COUNT(ap.account_id) AS linked_accounts,
         MAX(ap.last_used_at) AS last_used_at,
         SUM(ap.usage_count) AS total_usage
       FROM payments p
       LEFT JOIN account_payments ap ON ap.payment_id = p.payment_id
       WHERE p.payment_token = $1
       GROUP BY p.payment_id`,
      [payment_id]
    );

    if (rows.length > 0) {
      const r = rows[0];
      const ageDays = r.first_seen_at
        ? Math.floor((Date.now() - new Date(r.first_seen_at)) / 86400000) : 0;
      return res.json({
        source: 'database',
        payment_id,
        payment_type: r.method_type,
        status: r.is_flagged ? 'FLAGGED' : 'ACTIVE',
        card: {
          last4: r.last4,
          issuer_country: r.issuer_country || 'IN',
          cardholder_name: null,
          cardholder_match: !r.is_flagged,
        },
        history: {
          first_seen: r.first_seen_at,
          age_days: ageDays,
          linked_accounts: parseInt(r.linked_accounts) || 0,
          previous_transactions: parseInt(r.total_usage) || 0,
          previous_shipments: parseInt(r.total_usage) || 0,
          last_used_at: r.last_used_at,
        },
        risk: {
          new_payment_method: ageDays < 7,
          billing_shipping_match: !r.is_flagged,
          previous_fraud_count: r.failed_attempt_count || 0,
          is_flagged: r.is_flagged || false,
        },
      });
    }

    // Fallback to mock
    const mock = mockPayments?.[payment_id];
    if (mock) {
      logger.debug('Payment served from mock data', { payment_id });
      return res.json({ source: 'mock', ...mock });
    }

    // Unknown payment — return neutral profile
    return res.json({
      source: 'unknown',
      payment_id,
      payment_type: 'UNKNOWN',
      status: 'UNKNOWN',
      card: { last4: null, issuer_country: null, cardholder_name: null, cardholder_match: null },
      history: { first_seen: new Date().toISOString(), age_days: 0, previous_transactions: 0 },
      risk: { new_payment_method: true, billing_shipping_match: null, previous_fraud_count: 0 },
    });
  } catch (err) {
    logger.warn('DB payment lookup failed', { error: err.message, payment_id });
    next(err);
  }
});

module.exports = router;
