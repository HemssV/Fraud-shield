// src/services/paymentService.js
//
// Mock Payment Service — provides payment intelligence
// In production: calls the carrier's payment gateway / tokenization service
//
// Important: cardholder_match = false does NOT automatically mean fraud.
// Instead the fraud engine uses it as one signal among many:
//   Payment mismatch + New payment method + New device + Unusual destination → Higher fraud risk

const { payments } = require('./mockData');
const logger = require('../utils/logger');

/**
 * Retrieve payment details and risk signals for a given payment ID.
 *
 * @param {string} paymentId - The payment identifier (e.g., 'P19')
 * @returns {object|null} Payment profile with card details, history, and risk signals
 */
function getPayment(paymentId) {
  const payment = payments[paymentId] || null;

  if (!payment) {
    logger.warn('Payment not found', { payment_id: paymentId });
  } else {
    logger.debug('Payment retrieved', {
      payment_id: paymentId,
      new_method: payment.risk.new_payment_method,
    });
  }

  return payment;
}

module.exports = { getPayment };
