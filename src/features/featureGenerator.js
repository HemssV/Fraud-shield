// src/features/featureGenerator.js
//
// Feature Generator — transforms raw booking data + upstream signals
// into normalized features that feed the Rule Engine, ML Model, and Fraud Graph.
//
// This is the critical transformation layer:
//   Raw booking + Account profile + Payment + Device signals + Address confidence
//     → Engineered features (z-scores, ratios, boolean flags, velocities)
//       → Rules + ML + Graph analysis

const logger = require('../utils/logger');

/**
 * Generate engineered features from booking data and upstream service responses.
 *
 * @param {object} booking     - The incoming booking request
 * @param {object} account     - Account profile (shipper digital twin)
 * @param {object} payment     - Payment intelligence
 * @param {object} deviceSignals - Device/IP fraud signals
 * @param {object} addressData - Address confidence data
 * @returns {object} Engineered feature set organized by category
 */
function generateFeatures(booking, account, payment, deviceSignals, addressData, velocityZScores = {}) {
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
    velocity: generateVelocityFeatures(booking, account, velocityZScores),

    // ── Meta ──
    _meta: {
      feature_generation_ms: Date.now() - startTime,
      feature_count: 0,  // updated below
    },
  };

  // Count total features
  features._meta.feature_count = Object.keys(features).reduce((sum, cat) => {
    if (cat === '_meta') return sum;
    return sum + Object.keys(features[cat]).length;
  }, 0);

  // Validate strict canonical ordering and flatten
  const { flattenFeatures, get1DVector } = require('./featureSchema');
  const flatObj = flattenFeatures(features);
  features._flat_vector = get1DVector(features);

  logger.debug('Features generated', {
    shipment: booking.shipper_id,
    count: features._meta.feature_count,
    duration_ms: features._meta.feature_generation_ms,
  });

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

  // 1.2 Time math
  let days_until_departure = 14; // Default to 14 days
  let departure_in_past = false;
  if (booking.departure_date) {
    const depDate = new Date(booking.departure_date);
    if (!isNaN(depDate.valueOf())) {
      days_until_departure = Math.floor((depDate - new Date()) / 86400000);
      if (days_until_departure < 0) {
        departure_in_past = true;
        days_until_departure = 0;
      }
      if (days_until_departure > 365) {
        days_until_departure = 365;
      }
    }
  }

  // 1.3 Route entropy
  const routeCounts = profile.route_counts || {};
  const currentRoute = `${booking.origin}-${booking.destination}`;
  let route_entropy = 0;
  let is_new_route = true;
  let route_count = 0;
  
  const numRoutes = Object.keys(routeCounts).length;
  if (numRoutes > 0) {
    let totalCount = 0;
    for (const count of Object.values(routeCounts)) {
      totalCount += count;
    }
    if (totalCount > 0) {
      for (const count of Object.values(routeCounts)) {
        if (count > 0) {
          const p = count / totalCount;
          route_entropy -= p * Math.log2(p);
        }
      }
      const maxEntropy = Math.log2(numRoutes);
      if (maxEntropy > 0 && route_entropy > maxEntropy) {
        route_entropy = maxEntropy;
      }
      route_count = routeCounts[currentRoute] || 0;
      is_new_route = route_count === 0;
    }
  }

  // 1.5 Feature bounds and clipping
  let finalWeightZScore = Math.round(weightZScore * 100) / 100;
  if (finalWeightZScore < -5) finalWeightZScore = -5;
  if (finalWeightZScore > 10) finalWeightZScore = 10;
  
  let finalWeightRatio = Math.round(weightRatio * 100) / 100;
  if (finalWeightRatio < 0) finalWeightRatio = 0;
  if (finalWeightRatio > 50) finalWeightRatio = 50;

  let finalPackageCountRatio = Math.round(packageCountRatio * 100) / 100;
  if (finalPackageCountRatio < 0) finalPackageCountRatio = 0;
  if (finalPackageCountRatio > 20) finalPackageCountRatio = 20;

  return {
    weight_z_score: finalWeightZScore,
    weight_ratio_to_avg: finalWeightRatio,
    weight_exceeds_max: booking.weight > (profile.max_historical_weight || Infinity),
    is_unusual_hour: isUnusualHour,
    booking_hour: bookingHour,
    is_new_destination: isNewDestination,
    is_new_origin: isNewOrigin,
    is_unusual_service: isUnusualService,
    package_count_ratio: finalPackageCountRatio,
    total_historical_shipments: profile.total_shipments || 0,
    is_low_history: (profile.total_shipments || 0) < 10,
    days_until_departure,
    departure_in_past,
    route_entropy: Math.round(route_entropy * 100) / 100,
    is_new_route,
    route_count,
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
function generateVelocityFeatures(booking, account, velocityZScores) {
  const profile = account?.historical_profile || {};
  const avgDaily = profile.avg_shipments_per_day || 0;

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
    
    // Z-scores computed natively via DB index queries
    account_velocity_z: velocityZScores.account || 0,
    device_velocity_z: velocityZScores.device || 0,
    payment_velocity_z: velocityZScores.payment || 0,
    ip_velocity_z: velocityZScores.ip || 0,

    volume_spike_detected: (velocityZScores.account || 0) > 3,
  };
}


module.exports = { generateFeatures };
