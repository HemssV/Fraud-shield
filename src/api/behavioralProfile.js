// src/api/behavioralProfile.js
//
// API routes for Adaptive Behavioral Profiling.
//
// GET  /api/behavioral-profile/:account_id  — View behavioral familiarity for an account
// POST /api/behavioral-profile/feedback     — Process analyst feedback → behavioral adaptation
// POST /api/behavioral-profile/invalidate   — Invalidate familiarity entries

const express = require('express');
const behavioralService = require('../services/behavioralProfileService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/behavioral-profile/:account_id
 *
 * Returns the full behavioral familiarity state for an account.
 * This is used by the analyst investigation UI to show what behaviors
 * have been learned as familiar for this shipper.
 */
router.get('/:account_id', async (req, res, next) => {
  try {
    const { account_id } = req.params;
    const entries = await behavioralService.getAccountFamiliarity(account_id);

    res.json({
      account_id,
      familiarity_entries: entries,
      config: {
        stale_days: behavioralService.CONFIG.STALE_DAYS,
        min_occurrences_for_established: behavioralService.CONFIG.MIN_OCCURRENCES_FOR_ESTABLISHED,
        supported_dimensions: behavioralService.CONFIG.DIMENSIONS,
      },
    });
  } catch (err) {
    next(err);
  }
});


/**
 * POST /api/behavioral-profile/feedback
 *
 * Process analyst feedback to update behavioral profiles.
 * Called by the case decision workflow (Backend B) after an analyst verdict.
 *
 * Request body:
 *   {
 *     account_id: UUID,
 *     shipment_id: UUID,
 *     verdict: 'FALSE_POSITIVE' | 'CONFIRMED_FRAUD' | 'INCONCLUSIVE',
 *     analyst_id: UUID,
 *     case_id: UUID,
 *     shipment_details: { origin, destination, service_type }
 *   }
 */
router.post('/feedback', async (req, res, next) => {
  try {
    const { account_id, shipment_id, verdict, analyst_id, case_id, shipment_details } = req.body;

    if (!account_id || !verdict) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'account_id and verdict are required' },
      });
    }

    await behavioralService.processAnalystFeedback({
      account_id,
      shipment_id,
      verdict,
      analyst_id,
      case_id,
      shipment_details,
    });

    // Fetch updated state
    const entries = await behavioralService.getAccountFamiliarity(account_id);

    res.json({
      success: true,
      verdict,
      account_id,
      familiarity_entries: entries,
      message: verdict === 'FALSE_POSITIVE'
        ? 'Behavioral familiarity updated — future occurrences will be less penalized'
        : verdict === 'CONFIRMED_FRAUD'
          ? 'All behavioral familiarity entries invalidated for this account'
          : 'No behavioral profile changes for INCONCLUSIVE verdict',
    });
  } catch (err) {
    next(err);
  }
});


/**
 * POST /api/behavioral-profile/invalidate
 *
 * Manually invalidate behavioral familiarity entries.
 * Used when fraud is later discovered after a false positive verdict.
 *
 * Request body:
 *   {
 *     account_id: UUID,
 *     reason: string,
 *     dimension?: string,       // Optional: invalidate only this dimension
 *     value?: string,           // Optional: invalidate only this specific value
 *     shipment_id?: UUID        // Optional: invalidate entries from this shipment
 *   }
 */
router.post('/invalidate', async (req, res, next) => {
  try {
    const { account_id, reason, dimension, value, shipment_id } = req.body;

    if (!account_id || !reason) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'account_id and reason are required' },
      });
    }

    const count = await behavioralService.invalidateFamiliarity(
      account_id, reason, { dimension, value, shipment_id }
    );

    res.json({
      success: true,
      account_id,
      entries_invalidated: count,
      reason,
    });
  } catch (err) {
    next(err);
  }
});


module.exports = router;
