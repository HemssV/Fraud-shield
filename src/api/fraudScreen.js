// src/api/fraudScreen.js
//
// POST /api/fraud/screen — Fraud Screening API
//
// This is the most important API in the prototype.
// Accepts shipment data and returns a complete fraud assessment
// with risk score, decision, signal breakdown, and top reasons.
//
// The booking endpoint calls this internally, but having a separate
// endpoint makes the architecture cleaner and allows external systems
// to trigger screening independently.

const express = require('express');
const { bookingSchema } = require('../models/booking');
const { screenShipment } = require('../services/fraudScreeningService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * POST /api/fraud/screen
 *
 * Request body: Same as booking request + optional shipment_id
 *
 * Response: Complete fraud assessment with:
 *   - risk (fraud_probability, risk_score, risk_level)
 *   - decision (action, reason)
 *   - signals (contribution breakdown by category)
 *   - top_reasons (human-readable explanations)
 *   - component_scores (rule, ML, device, address breakdowns)
 *   - triggered_rules (detailed list of all triggered rules)
 *   - model (version info for reproducibility)
 *   - pipeline (latency metrics)
 */
router.post('/', async (req, res, next) => {
  try {
    // Allow shipment_id to be provided (for re-screening)
    const { shipment_id, simulate, ...bookingFields } = req.body;

    // Validate the booking fields
    const { error, value: bookingData } = bookingSchema.validate(bookingFields, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map(d => ({ field: d.path.join('.'), message: d.message }));
      throw new AppError('Validation error', 400, 'VALIDATION_ERROR', details);
    }

    const screeningInput = {
      shipment_id: shipment_id || `SH${Date.now()}`,
      simulate: simulate === true,
      ...bookingData,
    };

    const assessment = await screenShipment(screeningInput);

    res.json(assessment);
  } catch (err) {
    next(err);
  }
});


module.exports = router;
