// src/features/featureGenerator.js
//
// Feature Generator — transforms raw booking data + upstream signals
// into normalized features that feed the Rule Engine, ML Model, and Fraud Graph.
//
// This is the critical transformation layer:
//   Raw booking + Account profile + Payment + Device signals + Address confidence
//     → Engineered features (z-scores, ratios, boolean flags, velocities)
//       → Rules + ML + Graph analysis
//
// ADAPTIVE BEHAVIORAL PROFILING:
//   When a behavior has been analyst-verified as legitimate (FALSE_POSITIVE),
//   the relevant novelty flag (is_new_destination, is_new_origin, etc.) is
//   adjusted by behavioral familiarity strength. This ONLY affects behavioral
//   novelty signals — device, payment, IP, velocity signals remain independent.

const logger = require('../utils/logger');
const behavioralProfileService = require('../services/behavioralProfileService');

/**
 * Generate engineered features from booking data and upstream service responses.
 * (Synchronous version — backward compatible, no familiarity integration)
 *
 * @param {object} booking     - The incoming booking request
 * @param {object} account     - Account profile (shipper digital twin)
 * @param {object} payment     - Payment intelligence
 * @param {object} deviceSignals - Device/IP fraud signals
 * @param {object} addressData - Address confidence data
 * @returns {object} Engineered feature set organized by category
 */
function generateFeatures(booking, account, payment, deviceSignals, addressData) {
  const startTime = Date.now();

  const features = {
    // ── Behavioral features ──
    behavioral: generateBehavioralFeatures(booking, account),

    // ── Identity & account features ──
    identity: generateIdentityFeatures(booking, account, deviceSignals),

    // ── Payment features ──
    payment: generatePaymentFeatures(booking, account, payment),

    // ── Device & IP features ──
    device: generateDeviceFeatures(booking, account, deviceSignals),

    // ── Address features ──
    address: generateAddressFeatures(booking, account, addressData),

    // ── Velocity features ──
    velocity: generateVelocityFeatures(booking, account),

    // ── Meta ──
    _meta: {
      feature_generation_ms: Date.now() - startTime,
      feature_count: 0,  // updated below
      familiarity_applied: false,
    },
  };

  // Count total features
  features._meta.feature_count = Object.keys(features).reduce((sum, cat) => {
    if (cat === '_meta') return sum;
    return sum + Object.keys(features[cat]).length;
  }, 0);

  logger.debug('Features generated', {
    shipment: booking.shipper_id,
    count: features._meta.feature_count,
    duration_ms: features._meta.feature_generation_ms,
  });

  return features;
}


/**
 * Generate features WITH adaptive behavioral familiarity.
 * (Async version — queries the behavioral familiarity service)
 *
 * If a behavior has been analyst-verified as familiar for this account,
 * the novelty flag is suppressed and the familiarity strength is recorded.
 *
 * CRITICAL SAFETY: Familiarity ONLY suppresses the behavioral novelty flag.
 * It does NOT affect:
 *   - Device signals (new device, blacklisted device, etc.)
 *   - Payment signals (new payment, fraud history, etc.)
 *   - Identity signals (recent password change, account takeover indicators)
 *   - IP signals (VPN, proxy, suspicious IP)
 *   - Velocity signals (volume spikes)
 *   - Address risk signals (high-risk area, low confidence)
 *
 * FAIL-SAFE: If the familiarity service is unavailable, falls back to
 * standard feature generation (no familiarity applied = higher scrutiny).
 */
async function generateFeaturesWithFamiliarity(booking, account, payment, deviceSignals, addressData, accountId) {
  // Start with standard feature generation
  const features = generateFeatures(booking, account, payment, deviceSignals, addressData);

  // If no account ID available, skip familiarity (fail-safe: no reduced scrutiny)
  if (!accountId) {
    return features;
  }

  try {
    const familiarityResults = {};

    // Check familiarity for behavioral novelty dimensions
    const checks = [];

    if (features.behavioral.is_new_destination && booking.destination) {
      checks.push(
        behavioralProfileService.checkFamiliarity(accountId, 'destination', booking.destination)
          .then(result => { familiarityResults.destination = result; })
      );
    }

    if (features.behavioral.is_new_origin && booking.origin) {
      checks.push(
        behavioralProfileService.checkFamiliarity(accountId, 'origin', booking.origin)
          .then(result => { familiarityResults.origin = result; })
      );
    }

    if (features.behavioral.is_unusual_service && booking.service_type) {
      checks.push(
        behavioralProfileService.checkFamiliarity(accountId, 'service_type', booking.service_type)
          .then(result => { familiarityResults.service_type = result; })
      );
    }

    await Promise.all(checks);

    // Apply familiarity adjustments to BEHAVIORAL features ONLY
    let familiarityApplied = false;

    if (familiarityResults.destination?.familiar) {
      features.behavioral.is_new_destination = false;
      features.behavioral._destination_familiarity = familiarityResults.destination.strength;
      familiarityApplied = true;
    }

    if (familiarityResults.origin?.familiar) {
      features.behavioral.is_new_origin = false;
      features.behavioral._origin_familiarity = familiarityResults.origin.strength;
      familiarityApplied = true;
    }

    if (familiarityResults.service_type?.familiar) {
      features.behavioral.is_unusual_service = false;
      features.behavioral._service_familiarity = familiarityResults.service_type.strength;
      familiarityApplied = true;
    }

    features._meta.familiarity_applied = familiarityApplied;
    features._meta.familiarity_results = familiarityResults;

    if (familiarityApplied) {
      logger.info('Behavioral familiarity applied to features', {
        account_id: accountId,
        adjustments: Object.keys(familiarityResults)
          .filter(k => familiarityResults[k]?.familiar)
          .map(k => `${k}:${familiarityResults[k].strength}`),
      });
    }
  } catch (err) {
    // FAIL-SAFE: familiarity service failure → no adjustments applied
    // The standard (more suspicious) features remain in place
    logger.warn('Behavioral familiarity check failed — using standard features', {
      account_id: accountId,
      error: err.message,
    });
  }

  return features;
}


/**
 * Behavioral features — compare current shipment against historical profile
 */
function generateBehavioralFeatures(booking, account) {
  const profile = account?.historical_profile || {};

  const avgWeight = profile.avg_weight || 0;
  const stdWeight = profile.std_weight_kg || (avgWeight * 0.3);  // estimate if not available
  const weightZScore = avgWeight > 0
    ? (booking.weight - avgWeight) / (stdWeight || 1)
    : 0;

  const bookingHour = booking.booking_timestamp
    ? new Date(booking.booking_timestamp).getUTCHours()
    : new Date().getUTCHours();

  const usualHours = profile.usual_booking_hours || [];
  const isUnusualHour = usualHours.length > 0 && !usualHours.includes(bookingHour);

  const usualDestinations = profile.usual_destinations || [];
  const isNewDestination = usualDestinations.length > 0
    && !usualDestinations.includes(booking.destination);

  const usualOrigins = profile.usual_origins || [];
  const isNewOrigin = usualOrigins.length > 0
    && !usualOrigins.includes(booking.origin);

  const usualServices = profile.usual_service_types || [];
  const isUnusualService = usualServices.length > 0
    && !usualServices.includes(booking.service_type);

  const weightRatio = avgWeight > 0 ? booking.weight / avgWeight : 1;

  const packageCountRatio = profile.avg_shipments_per_day > 0
    ? (booking.package_count || 1) / profile.avg_shipments_per_day
    : 1;

  return {
    weight_z_score: Math.round(weightZScore * 100) / 100,
    weight_ratio_to_avg: Math.round(weightRatio * 100) / 100,
    weight_exceeds_max: booking.weight > (profile.max_historical_weight || Infinity),
    is_unusual_hour: isUnusualHour,
    booking_hour: bookingHour,
    is_new_destination: isNewDestination,
    is_new_origin: isNewOrigin,
    is_unusual_service: isUnusualService,
    package_count_ratio: Math.round(packageCountRatio * 100) / 100,
    total_historical_shipments: profile.total_shipments || 0,
    is_low_history: (profile.total_shipments || 0) < 10,
  };
}


/**
 * Identity features — detect account takeover or misuse signals
 */
function generateIdentityFeatures(booking, account, deviceSignals) {
  const security = account?.security || {};

  const knownDevices = security.known_devices || [];
  const isNewDevice = knownDevices.length > 0 && !knownDevices.includes(booking.device_id);

  const knownPayments = security.known_payment_ids || [];
  const isNewPayment = knownPayments.length > 0 && !knownPayments.includes(booking.payment_id);

  // Recent security changes are a takeover signal
  const lastPasswordChange = security.last_password_change
    ? new Date(security.last_password_change)
    : null;
  const lastProfileUpdate = security.last_profile_update
    ? new Date(security.last_profile_update)
    : null;
  const now = new Date();

  const passwordChangedRecently = lastPasswordChange
    ? (now - lastPasswordChange) < (72 * 60 * 60 * 1000)  // within 72 hours
    : false;

  const profileUpdatedRecently = lastProfileUpdate
    ? (now - lastProfileUpdate) < (48 * 60 * 60 * 1000)  // within 48 hours
    : false;

  // Account status and age signals
  const accountAge = account?.account_age_days || 0;
  const isNewAccount = accountAge < 30;
  const isSuspended = account?.account_status === 'SUSPENDED';
  const isUnderInvestigation = account?.account_status === 'UNDER_INVESTIGATION';
  const isVerified = account?.verified !== false;

  return {
    is_new_device: isNewDevice,
    is_new_payment_for_account: isNewPayment,
    password_changed_recently: passwordChangedRecently,
    profile_updated_recently: profileUpdatedRecently,
    account_age_days: accountAge,
    is_new_account: isNewAccount,
    account_status: account?.account_status || 'UNKNOWN',
    is_suspended: isSuspended,
    is_under_investigation: isUnderInvestigation,
    is_verified: isVerified,
    previous_fraud_cases: account?.historical_fraud?.previous_fraud_cases || 0,
    previous_review_cases: account?.historical_fraud?.previous_review_cases || 0,
  };
}


/**
 * Payment features — detect payment fraud signals
 */
function generatePaymentFeatures(booking, account, payment) {
  if (!payment) {
    return {
      payment_found: false,
      is_new_payment_method: true,
      cardholder_match: false,
      billing_shipping_match: false,
      previous_transactions: 0,
      previous_fraud_count: 0,
      foreign_card: false,
    };
  }

  return {
    payment_found: true,
    is_new_payment_method: payment.risk.new_payment_method,
    cardholder_match: payment.card.cardholder_match,
    billing_shipping_match: payment.risk.billing_shipping_match,
    previous_transactions: payment.history.previous_transactions,
    previous_shipments: payment.history.previous_shipments,
    amount_spend_30d: payment.history.amount_spend_30d,
    previous_fraud_count: payment.risk.previous_fraud_count,
    foreign_card: payment.card.issuer_country !== 'IN',
    payment_type: payment.payment_type,
  };
}


/**
 * Device & IP features — detect device sharing, VPN, proxy
 */
function generateDeviceFeatures(booking, account, deviceSignals) {
  if (!deviceSignals) {
    return {
      device_found: false,
      known_device: false,
      accounts_linked: 0,
      device_risk_score: 40,
      vpn_detected: false,
      proxy_detected: false,
      device_blacklisted: false,
      ip_blacklisted: false,
      device_linked_to_fraud: false,
      linked_fraud_account_count: 0,
    };
  }

  const security = account?.security || {};
  const knownDevices = security.known_devices || [];
  const isKnownForAccount = knownDevices.includes(booking.device_id);

  return {
    device_found: true,
    known_device: deviceSignals.device.known_device,
    known_for_this_account: isKnownForAccount,
    accounts_linked: deviceSignals.device.accounts_linked,
    device_risk_score: deviceSignals.risk_score,
    ip_country: deviceSignals.ip.country,
    ip_reputation: deviceSignals.ip.reputation,
    vpn_detected: deviceSignals.ip.vpn_detected,
    proxy_detected: deviceSignals.ip.proxy_detected,
    device_blacklisted: deviceSignals.fraud_signals.device_blacklisted,
    ip_blacklisted: deviceSignals.fraud_signals.ip_blacklisted,
    device_linked_to_fraud: deviceSignals.fraud_signals.device_linked_to_fraud,
    linked_fraud_account_count: deviceSignals.fraud_signals.linked_fraud_accounts.length,
    linked_fraud_accounts: deviceSignals.fraud_signals.linked_fraud_accounts,
  };
}


/**
 * Address features — destination confidence and risk signals
 */
function generateAddressFeatures(booking, account, addressData) {
  if (!addressData) {
    return {
      address_found: false,
      confidence_score: 0.30,
      risk_tier: 'HIGH',
      address_valid: false,
    };
  }

  const profile = account?.historical_profile || {};
  const usualDestinations = profile.usual_destinations || [];

  return {
    address_found: true,
    address_valid: addressData.address_valid,
    confidence_score: addressData.confidence_score,
    risk_tier: addressData.risk_tier,
    is_new_destination_for_shipper: !usualDestinations.includes(booking.destination),
    delivery_success_rate: addressData.delivery_history
      ? addressData.delivery_history.successful_deliveries /
        (addressData.delivery_history.successful_deliveries + addressData.delivery_history.failed_deliveries || 1)
      : null,
    signals: Array.isArray(addressData.signals) ? addressData.signals : [],
  };
}


/**
 * Velocity features — timing and frequency anomalies
 */
function generateVelocityFeatures(booking, account) {
  const profile = account?.historical_profile || {};
  const avgDaily = profile.avg_shipments_per_day || 0;

  // For the prototype, simulate that we've seen some recent bookings
  // In production: query recent shipments from the database
  const bookingHour = booking.booking_timestamp
    ? new Date(booking.booking_timestamp).getUTCHours()
    : new Date().getUTCHours();

  const isLateNight = bookingHour >= 22 || bookingHour <= 4;
  const isWeekend = booking.booking_timestamp
    ? [0, 6].includes(new Date(booking.booking_timestamp).getUTCDay())
    : [0, 6].includes(new Date().getUTCDay());

  return {
    booking_hour: bookingHour,
    is_late_night: isLateNight,
    is_weekend: isWeekend,
    avg_daily_volume: avgDaily,
    // In production these would be computed from recent DB queries:
    estimated_daily_rate: (booking.package_count || 1),
    volume_spike_detected: (booking.package_count || 1) > avgDaily * 3 && avgDaily > 0,
  };
}


module.exports = { generateFeatures, generateFeaturesWithFamiliarity };
