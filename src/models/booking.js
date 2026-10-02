// src/models/booking.js
const Joi = require('joi');

// Validation schema for the booking request — matches the extended schema
// from the API design with fields needed for behavioral + identity fraud detection
const bookingSchema = Joi.object({
  shipper_id: Joi.string().required()
    .description('Identify the customer/account'),

  origin: Joi.string().required()
    .description('Behavioral/location analysis'),

  destination: Joi.string().required()
    .description('Detect unusual destinations'),

  destination_address_id: Joi.string().optional()
    .description('Address ID for address-confidence lookup'),

  weight: Joi.number().positive().required()
    .description('Detect abnormal shipment size'),

  service_type: Joi.string()
    .valid('GROUND', 'EXPRESS', 'EXPRESS_SAVER', 'FREIGHT', 'INTERNATIONAL')
    .required()
    .description('Detect unusual service selection'),

  payment_id: Joi.string().required()
    .description('Payment/account relationship'),

  device_id: Joi.string().required()
    .description('Account takeover / shared-device detection'),

  package_count: Joi.number().integer().min(1).default(1)
    .description('Volume anomaly detection'),

  booking_timestamp: Joi.string().isoDate().optional()
    .description('Timing/frequency analysis — auto-generated if not provided'),

  ip_address: Joi.string().ip({ version: ['ipv4', 'ipv6'] }).optional()
    .description('IP reputation and account takeover signals'),
});

module.exports = { bookingSchema };
