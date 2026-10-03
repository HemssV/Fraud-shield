// src/api/bookings.js
//
// POST /api/bookings — Primary ingestion API
//
// Accepts a booking request, validates it, generates a shipment_id,
// automatically triggers fraud screening, and returns the booking
// with the fraud assessment attached.
//
// This demonstrates the real-time fraud detection concept:
//   Booking submitted → Fraud screening → Decision (ALLOW/VERIFY/REVIEW/BLOCK)

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { bookingSchema } = require('../models/booking');
const { screenShipment } = require('../services/fraudScreeningService');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/bookings
 *
 * Request body:
 * {
 *   "shipper_id": "S1001",
 *   "origin": "Chennai",
 *   "destination": "Delhi",
 *   "weight": 25.0,
 *   "service_type": "EXPRESS",
 *   "payment_id": "P19",
 *   "device_id": "D88",
 *   "package_count": 3,
 *   "booking_timestamp": "2026-10-01T23:30:00Z",
 *   "ip_address": "103.21.45.18"
 * }
 */
router.post('/', async (req, res, next) => {
  try {
    // ── Validate request ──
    const { error, value: bookingData } = bookingSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map(d => ({ field: d.path.join('.'), message: d.message }));
      throw new AppError('Validation error', 400, 'VALIDATION_ERROR', details);
    }

    // ── Generate server-side fields ──
    const shipmentId = `SH${uuidv4().split('-')[0].toUpperCase()}`;
    const createdAt = new Date().toISOString();

    // bookingData.booking_timestamp is populated by Joi default if omitted

    const booking = {
      shipment_id: shipmentId,
      ...bookingData,
      created_at: createdAt,
    };

    logger.info('📦 New booking received', {
      shipment_id: shipmentId,
      shipper_id: bookingData.shipper_id,
      origin: bookingData.origin,
      destination: bookingData.destination,
    });

    // ── Trigger real-time fraud screening ──
    const fraudAssessment = await screenShipment(booking);

    // ── Determine shipment status based on decision ──
    const statusMap = {
      ALLOW: 'ALLOWED',
      ALLOW_MONITOR: 'ALLOWED',
      VERIFY: 'SCREENING',
      REVIEW: 'HELD',
      BLOCK: 'BLOCKED',
    };
    const shipmentStatus = statusMap[fraudAssessment.decision.action] || 'SCREENING';

    // ── Response ──
    res.status(201).json({
      booking: {
        shipment_id: shipmentId,
        ...bookingData,
        status: shipmentStatus,
        created_at: createdAt,
      },
      fraud_assessment: {
        risk: fraudAssessment.risk,
        decision: fraudAssessment.decision,
        signals: fraudAssessment.signals,
        top_reasons: fraudAssessment.top_reasons,
        component_scores: fraudAssessment.component_scores,
        model: fraudAssessment.model,
        pipeline: fraudAssessment.pipeline,
      },
    });
  } catch (err) {
    next(err);
  }
});


module.exports = router;
