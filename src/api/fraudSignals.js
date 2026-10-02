// src/api/fraudSignals.js
//
// GET /api/fraud-signals/:device_id — Mock Fraud Signal Service
//
// Returns device status, IP reputation, and fraud graph connections.
// Indexed by device_id because the booking request includes it directly.
//
// The Fraud Graph reveals entity relationships:
//              D88
//           /  |  \
//       S1001 S2088 S3012
//
// → A "normal" account is using a device linked to flagged accounts.

const express = require('express');
const { getFraudSignals } = require('../services/fraudSignalService');

const router = express.Router();

/**
 * GET /api/fraud-signals/:device_id
 *
 * Response: Device fraud signals including IP reputation and fraud graph data
 * Note: Always returns data — unknown devices get an elevated baseline risk.
 */
router.get('/:device_id', (req, res, next) => {
  try {
    const { device_id } = req.params;
    const signals = getFraudSignals(device_id);

    // Always returns data (unknown devices get default signals)
    res.json(signals);
  } catch (err) {
    next(err);
  }
});


module.exports = router;
