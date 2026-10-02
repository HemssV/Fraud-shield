// src/services/fraudSignalService.js
//
// Mock Fraud Signal Service — provides device/IP intelligence and fraud graph signals
// In production: calls internal fraud graph + external threat intelligence feeds
//
// Indexed by device_id because the booking request includes it directly.
// The Fraud Graph shows how entities (accounts, devices, payments) are connected:
//
//              D88
//           /  |  \
//          /   |   \
//       S1001 S2088 S3012
//          |
//         P19
//          |
//       Shipment
//
// → "Normal" account is using a device linked to previously flagged accounts

const { fraudSignals } = require('./mockData');
const logger = require('../utils/logger');

/**
 * Retrieve fraud signals for a given device ID.
 * Includes device status, IP reputation, and fraud graph connections.
 *
 * @param {string} deviceId - The device identifier (e.g., 'D88')
 * @returns {object|null} Device fraud signals including risk_score
 */
function getFraudSignals(deviceId) {
  const signals = fraudSignals[deviceId] || null;

  if (!signals) {
    logger.warn('Device not found in fraud signal database — treating as unknown', {
      device_id: deviceId,
    });
    // Unknown device = suspicious by default
    return {
      device_id: deviceId,
      device: {
        status: 'UNKNOWN',
        first_seen: new Date().toISOString(),
        known_device: false,
        accounts_linked: 0,
      },
      ip: {
        address: null,
        country: 'UNKNOWN',
        reputation: 'UNKNOWN',
        vpn_detected: false,
        proxy_detected: false,
      },
      fraud_signals: {
        device_blacklisted: false,
        ip_blacklisted: false,
        device_linked_to_fraud: false,
        linked_fraud_accounts: [],
      },
      risk_score: 40,  // elevated baseline for unknown devices
    };
  }

  logger.debug('Fraud signals retrieved', {
    device_id: deviceId,
    risk_score: signals.risk_score,
    linked_to_fraud: signals.fraud_signals.device_linked_to_fraud,
  });

  return signals;
}

module.exports = { getFraudSignals };
