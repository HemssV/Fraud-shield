// src/api/accounts.js
//
// GET /api/accounts/:shipper_id — Mock Account Service
//
// Returns the shipper's "Digital Twin" — account profile with
// historical behavioral profile, security signals, and fraud history.

const express = require('express');
const { getAccount } = require('../services/accountService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * GET /api/accounts/:shipper_id
 *
 * Response: Full account profile (shipper digital twin)
 */
router.get('/:shipper_id', (req, res, next) => {
  try {
    const { shipper_id } = req.params;
    const account = getAccount(shipper_id);

    if (!account) {
      throw new AppError(`Account not found: ${shipper_id}`, 404, 'ACCOUNT_NOT_FOUND');
    }

    res.json(account);
  } catch (err) {
    next(err);
  }
});


module.exports = router;
