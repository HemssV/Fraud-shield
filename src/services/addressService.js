// src/services/addressService.js
//
// Mock Address Intelligence Service — provides destination confidence and risk
// In production: calls address verification + delivery history databases
//
// Supports two lookup modes:
//   1. By destination city name (simpler):  GET /api/address-confidence/Delhi
//   2. By address ID (more realistic):      GET /api/address-confidence/ADDR991

const { addressConfidence } = require('./mockData');
const logger = require('../utils/logger');

/**
 * Retrieve address confidence and risk signals.
 * Accepts either a city name or a specific address ID.
 *
 * @param {string} addressKey - City name (e.g., 'Delhi') or address ID (e.g., 'ADDR991')
 * @returns {object} Address confidence data with risk tier and signals
 */
function getAddressConfidence(addressKey) {
  const data = addressConfidence[addressKey] || null;

  if (!data) {
    logger.warn('Address not found in database — returning default low confidence', {
      address_key: addressKey,
    });
    // Unknown address = lower confidence
    return {
      location: addressKey,
      address_valid: false,
      confidence_score: 0.30,
      risk_tier: 'HIGH',
      delivery_history: { successful_deliveries: 0, failed_deliveries: 0 },
      signals: ['Address not found in database', 'No delivery history', 'Cannot validate address'],
    };
  }

  logger.debug('Address confidence retrieved', {
    address_key: addressKey,
    confidence: data.confidence_score,
    risk_tier: data.risk_tier,
  });

  return data;
}

module.exports = { getAddressConfidence };
