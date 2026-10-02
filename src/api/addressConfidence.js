// src/api/addressConfidence.js
//
// GET /api/address-confidence/:address_id — Mock Address Intelligence Service
//
// Supports two lookup modes:
//   1. By destination city name:  GET /api/address-confidence/Delhi
//   2. By address ID:             GET /api/address-confidence/ADDR991

const express = require('express');
const { getAddressConfidence } = require('../services/addressService');

const router = express.Router();

/**
 * GET /api/address-confidence/:address_id
 *
 * Response: Address confidence with risk tier and delivery signals
 * Note: Always returns data — unknown addresses get low confidence by default.
 */
router.get('/:address_id', (req, res, next) => {
  try {
    const { address_id } = req.params;
    const data = getAddressConfidence(address_id);

    // Always returns data (unknown addresses get default low confidence)
    res.json(data);
  } catch (err) {
    next(err);
  }
});


module.exports = router;
