// src/api/fraudSignals.js
// GET /api/fraud-signals/:device_id
// Returns fraud signals for a device — DB-first, mock fallback.

const express = require('express');
const router = express.Router();
const db = require('../db/index');
const { fraudSignals: mockSignals } = require('../services/mockData');
const logger = require('../utils/logger');

router.get('/:device_id', async (req, res, next) => {
  const { device_id } = req.params;
  try {
    // Look up device by fingerprint_hash
    const { rows: deviceRows } = await db.query(
      `SELECT device_id, fingerprint_hash, device_type, first_seen_at, last_seen_at,
              linked_account_count, is_flagged
       FROM devices WHERE fingerprint_hash = $1`,
      [device_id]
    );

    if (deviceRows.length > 0) {
      const dev = deviceRows[0];

      // Get active fraud signals
      const { rows: sigRows } = await db.query(
        `SELECT signal_type, severity, confidence, source, description, detected_at
         FROM fraud_signals
         WHERE entity_type = 'DEVICE' AND entity_id = $1 AND is_active = TRUE`,
        [dev.device_id]
      );

      // Get linked accounts via entity_links
      const { rows: linkRows } = await db.query(
        `SELECT DISTINCT dst_id AS account_id FROM entity_links
         WHERE src_type = 'DEVICE' AND src_id = $1 AND dst_type = 'ACCOUNT'`,
        [dev.device_id]
      );

      const riskScore = dev.is_flagged ? 80 :
                        linkRows.length > 2 ? 60 :
                        sigRows.length > 0 ? 50 : 10;

      return res.json({
        source: 'database',
        device_id,
        device: {
          status: dev.is_flagged ? 'FLAGGED' : 'ACTIVE',
          device_type: dev.device_type || 'unknown',
          first_seen: dev.first_seen_at,
          last_seen: dev.last_seen_at,
          known_device: dev.linked_account_count > 0,
          accounts_linked: dev.linked_account_count || 0,
        },
        ip: {
          address: null,
          country: 'IN',
          reputation: dev.is_flagged ? 'SUSPICIOUS' : 'CLEAN',
          vpn_detected: false,
          proxy_detected: false,
        },
        fraud_signals: {
          device_blacklisted: dev.is_flagged,
          ip_blacklisted: false,
          device_linked_to_fraud: sigRows.length > 0,
          linked_fraud_accounts: linkRows.map(r => r.account_id),
          active_signals: sigRows,
        },
        risk_score: riskScore,
      });
    }

    // Fallback to mock
    const mock = mockSignals?.[device_id];
    if (mock) {
      logger.debug('Fraud signals served from mock', { device_id });
      return res.json({ source: 'mock', ...mock });
    }

    // Unknown device — elevated baseline
    return res.json({
      source: 'unknown',
      device_id,
      device: { status: 'UNKNOWN', first_seen: new Date().toISOString(), known_device: false, accounts_linked: 0 },
      ip: { address: null, country: 'UNKNOWN', reputation: 'UNKNOWN', vpn_detected: false, proxy_detected: false },
      fraud_signals: { device_blacklisted: false, ip_blacklisted: false, device_linked_to_fraud: false, linked_fraud_accounts: [] },
      risk_score: 40,
    });
  } catch (err) {
    logger.warn('DB fraud signal lookup failed', { error: err.message, device_id });
    const mock = mockSignals?.[device_id];
    if (mock) return res.json({ source: 'mock-fallback', ...mock });
    return res.status(500).json({ error: 'Failed to retrieve fraud signals' });
  }
});

module.exports = router;
