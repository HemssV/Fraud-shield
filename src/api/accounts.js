// src/api/accounts.js
// GET /api/accounts/:shipper_id
// Returns the shipper digital twin — DB-first, mock fallback.

const express = require('express');
const router = express.Router();
const db = require('../db/index');
const { accounts } = require('../services/mockData');
const logger = require('../utils/logger');

router.get('/:shipper_id', async (req, res, next) => {
  const { shipper_id } = req.params;
  try {
    // Try DB first
    const { rows } = await db.query(
      `SELECT
         a.account_id, a.account_number, a.account_type, a.status,
         a.opened_at, a.last_profile_change_at, a.last_password_change_at,
         s.external_ref, s.company_name, s.is_trusted,
         sp.total_shipments, sp.avg_daily_volume, sp.avg_weight_kg,
         sp.std_weight_kg, sp.common_destinations, sp.common_origins, sp.service_mix, sp.history_days,
         (SELECT COUNT(*) FROM analyst_feedback af
            JOIN shipments sh ON sh.shipment_id = af.shipment_id
            WHERE sh.account_id = a.account_id AND af.verdict = 'CONFIRMED_FRAUD') AS fraud_count,
         ARRAY(SELECT DISTINCT d.fingerprint_hash FROM account_devices ad
               JOIN devices d ON d.device_id = ad.device_id
               WHERE ad.account_id = a.account_id) AS known_devices,
         ARRAY(SELECT DISTINCT p.payment_token FROM account_payments ap
               JOIN payments p ON p.payment_id = ap.payment_id
               WHERE ap.account_id = a.account_id) AS known_payments
       FROM accounts a
       JOIN shippers s ON s.shipper_id = a.shipper_id
       LEFT JOIN shipper_profiles sp ON sp.account_id = a.account_id
       WHERE a.account_number = $1 OR s.external_ref = $1`,
      [shipper_id]
    );

    if (rows.length > 0) {
      const r = rows[0];
      const ageDays = r.opened_at
        ? Math.floor((Date.now() - new Date(r.opened_at)) / 86400000) : 0;
      return res.json({
        source: 'database',
        shipper_id,
        account_status: r.status || 'ACTIVE',
        account_tier: r.account_type || 'BUSINESS',
        account_created_at: r.opened_at,
        account_age_days: ageDays,
        verified: true,
        is_trusted: r.is_trusted || false,
        historical_profile: {
          total_shipments: parseInt(r.total_shipments) || 0,
          avg_shipments_per_day: parseFloat(r.avg_daily_volume) || 0,
          avg_weight: parseFloat(r.avg_weight_kg) || 0,
          history_days: parseInt(r.history_days) || ageDays,
          common_origins: r.common_origins || [],
          common_destinations: r.common_destinations || [],
          service_mix: r.service_mix || {},
        },
        security: {
          last_password_change: r.last_password_change_at,
          last_profile_update: r.last_profile_change_at,
          known_devices: r.known_devices || [],
          known_payment_ids: r.known_payments || [],
        },
        historical_fraud: {
          previous_fraud_cases: parseInt(r.fraud_count) || 0,
          previous_review_cases: 0,
        },
      });
    }

    // DB miss — fall back to mock data
    const mock = accounts[shipper_id];
    if (mock) {
      logger.debug('Account served from mock data', { shipper_id });
      return res.json({ source: 'mock', ...mock });
    }

    return res.status(404).json({ error: `Account ${shipper_id} not found` });
  } catch (err) {
    logger.warn('DB account lookup failed, using mock', { error: err.message, shipper_id });
    const mock = accounts[shipper_id];
    if (mock) return res.json({ source: 'mock-fallback', ...mock });
    return res.status(404).json({ error: `Account ${shipper_id} not found` });
  }
});

module.exports = router;
