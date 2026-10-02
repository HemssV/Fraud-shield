// src/api/payments.js
//
// GET /api/payments/:payment_id — Mock Payment Service
//
// Returns payment details, history, and risk signals.
// Important: a mismatch alone does NOT mean fraud — it's one signal among many.

const express = require('express');
const { getPayment } = require('../services/paymentService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * GET /api/payments/:payment_id
 *
 * Response: Payment profile with card details, history, and risk signals
 */
router.get('/:payment_id', (req, res, next) => {
  try {
    const { payment_id } = req.params;
    const payment = getPayment(payment_id);

    if (!payment) {
      throw new AppError(`Payment not found: ${payment_id}`, 404, 'PAYMENT_NOT_FOUND');
    }

    res.json(payment);
  } catch (err) {
    next(err);
  }
});


module.exports = router;
