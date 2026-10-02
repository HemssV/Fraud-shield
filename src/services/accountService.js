// src/services/accountService.js
//
// Mock Account Service — provides the "Shipper Digital Twin"
// In production: calls the carrier's account master data + CRM system
//
// The fraud engine compares current shipment behavior against this profile:
//   S1001 normally ships: Chennai → Bangalore, 2-3/day, ~8.6kg, daytime, devices D12/D31
//   Current:              Chennai → Delhi, 25kg, 11:30 PM, device D88
//   → Multiple behavioral anomalies

const { accounts } = require('./mockData');
const logger = require('../utils/logger');

/**
 * Retrieve the account profile (shipper digital twin) for a given shipper ID.
 *
 * @param {string} shipperId - The shipper identifier (e.g., 'S1001')
 * @returns {object|null} Account profile with historical_profile, security, and fraud history
 */
function getAccount(shipperId) {
  const account = accounts[shipperId] || null;

  if (!account) {
    logger.warn('Account not found', { shipper_id: shipperId });
  } else {
    logger.debug('Account retrieved', { shipper_id: shipperId, tier: account.account_tier });
  }

  return account;
}

module.exports = { getAccount };
