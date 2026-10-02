// src/db/repository.js
//
// DB Repository — all SQL queries used by the fraud screening pipeline.
// Backend A (Node.js) writes here; Backend B (Django) reads the same tables.
//
// Tables written by this module:
//   shippers, accounts, devices, payments, addresses
//   account_devices, account_payments
//   shipments, shipper_profiles
//   risk_assessments, risk_reasons, decisions
//   fraud_cases, entity_links, audit_log

const db = require('./index');

// ─── SHIPPER / ACCOUNT ─────────────────────────────────────────────────────

/**
 * Upsert a shipper by external_ref (e.g. 'S1001').
 * Returns the shipper_id (UUID).
 */
async function upsertShipper({ external_ref, company_name, country = 'IN', is_synthetic = false }) {
  const { rows } = await db.query(
    `INSERT INTO shippers (external_ref, company_name, country, is_synthetic)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (external_ref) DO UPDATE SET company_name = EXCLUDED.company_name, updated_at = now()
     RETURNING shipper_id`,
    [external_ref, company_name, country, is_synthetic]
  );
  return rows[0].shipper_id;
}

/**
 * Upsert an account by account_number.
 * Returns the account_id (UUID).
 */
async function upsertAccount({ shipper_id, account_number, account_type = 'BUSINESS', status = 'ACTIVE', last_profile_change_at, last_password_change_at }) {
  const { rows } = await db.query(
    `INSERT INTO accounts (shipper_id, account_number, account_type, status, last_profile_change_at, last_password_change_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (account_number) DO UPDATE
       SET status = EXCLUDED.status,
           last_profile_change_at = EXCLUDED.last_profile_change_at,
           last_password_change_at = EXCLUDED.last_password_change_at,
           updated_at = now()
     RETURNING account_id`,
    [shipper_id, account_number, account_type, status, last_profile_change_at || null, last_password_change_at || null]
  );
  return rows[0].account_id;
}

/**
 * Look up account profile from DB — full shipper digital twin.
 */
async function getAccountProfile(account_number) {
  const { rows } = await db.query(
    `SELECT
       a.account_id, a.account_number, a.account_type, a.status,
       a.opened_at, a.last_profile_change_at, a.last_password_change_at,
       s.external_ref AS shipper_ref, s.company_name, s.is_trusted,
       sp.total_shipments, sp.avg_daily_volume, sp.avg_weight_kg,
       sp.std_weight_kg, sp.common_destinations, sp.common_origins,
       sp.service_mix, sp.hour_histogram,
       (SELECT COUNT(*) FROM analyst_feedback af
          JOIN shipments sh ON sh.shipment_id = af.shipment_id
          WHERE sh.account_id = a.account_id AND af.verdict = 'CONFIRMED_FRAUD') AS fraud_count,
       ARRAY(
         SELECT DISTINCT d.fingerprint_hash FROM account_devices ad
         JOIN devices d ON d.device_id = ad.device_id
         WHERE ad.account_id = a.account_id
       ) AS known_devices,
       ARRAY(
         SELECT DISTINCT p.payment_token FROM account_payments ap
         JOIN payments p ON p.payment_id = ap.payment_id
         WHERE ap.account_id = a.account_id
       ) AS known_payments
     FROM accounts a
     JOIN shippers s ON s.shipper_id = a.shipper_id
     LEFT JOIN shipper_profiles sp ON sp.account_id = a.account_id
     WHERE a.account_number = $1`,
    [account_number]
  );
  return rows[0] || null;
}

// ─── DEVICES ───────────────────────────────────────────────────────────────

/**
 * Upsert a device by fingerprint_hash.
 * Returns the device_id (UUID).
 */
async function upsertDevice({ fingerprint_hash, device_type = 'api-client', is_flagged = false }) {
  const { rows } = await db.query(
    `INSERT INTO devices (fingerprint_hash, device_type, is_flagged, last_seen_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (fingerprint_hash) DO UPDATE
       SET last_seen_at = now(), is_flagged = EXCLUDED.is_flagged
     RETURNING device_id, linked_account_count, is_flagged, first_seen_at`,
    [fingerprint_hash, device_type, is_flagged]
  );
  return rows[0];
}

/**
 * Link a device to an account (account_devices join table).
 */
async function linkDeviceToAccount(account_id, device_id) {
  await db.query(
    `INSERT INTO account_devices (account_id, device_id, last_seen_at)
     VALUES ($1, $2, now())
     ON CONFLICT (account_id, device_id) DO UPDATE
       SET last_seen_at = now(), login_count = account_devices.login_count + 1`,
    [account_id, device_id]
  );
  // Update denormalized linked_account_count on device
  await db.query(
    `UPDATE devices SET linked_account_count = (
       SELECT COUNT(DISTINCT account_id) FROM account_devices WHERE device_id = $1
     ) WHERE device_id = $1`,
    [device_id]
  );
}

/**
 * Get fraud signals for a device (from fraud_signals + entity_links).
 */
async function getDeviceFraudSignals(device_id) {
  const [signalsRes, linksRes] = await Promise.all([
    db.query(
      `SELECT signal_type, severity, confidence, source, description
       FROM fraud_signals
       WHERE entity_type = 'DEVICE' AND entity_id = $1 AND is_active = TRUE`,
      [device_id]
    ),
    db.query(
      `SELECT DISTINCT dst_id AS linked_account_id
       FROM entity_links
       WHERE src_type = 'DEVICE' AND src_id = $1 AND dst_type = 'ACCOUNT' AND link_type = 'USES_DEVICE'`,
      [device_id]
    ),
  ]);
  return {
    signals: signalsRes.rows,
    linked_accounts: linksRes.rows.map(r => r.linked_account_id),
  };
}

// ─── PAYMENTS ──────────────────────────────────────────────────────────────

/**
 * Upsert a payment by payment_token.
 * Returns the payment_id (UUID).
 */
async function upsertPayment({ payment_token, method_type = 'CREDIT_CARD', last4, issuer_country, is_flagged = false }) {
  const { rows } = await db.query(
    `INSERT INTO payments (payment_token, method_type, last4, issuer_country, is_flagged)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (payment_token) DO UPDATE
       SET is_flagged = EXCLUDED.is_flagged
     RETURNING payment_id, is_flagged, first_seen_at`,
    [payment_token, method_type, last4 || null, issuer_country || null, is_flagged]
  );
  return rows[0];
}

/**
 * Link a payment to an account.
 */
async function linkPaymentToAccount(account_id, payment_id, holder_name_matches) {
  await db.query(
    `INSERT INTO account_payments (account_id, payment_id, last_used_at, holder_name_matches)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (account_id, payment_id) DO UPDATE
       SET last_used_at = now(), usage_count = account_payments.usage_count + 1`,
    [account_id, payment_id, holder_name_matches ?? null]
  );
}

/**
 * Check if an account has used a payment before.
 */
async function isPaymentKnownForAccount(account_id, payment_id) {
  const { rows } = await db.query(
    `SELECT 1 FROM account_payments WHERE account_id = $1 AND payment_id = $2`,
    [account_id, payment_id]
  );
  return rows.length > 0;
}

// ─── ADDRESSES ─────────────────────────────────────────────────────────────

/**
 * Upsert an address by city+country hash.
 * Returns the address_id (UUID).
 */
async function upsertAddress({ city, state, country = 'IN', address_type = 'UNKNOWN', confidence_score, is_high_risk = false }) {
  const normalized_hash = `${city}-${state || ''}-${country}`.toLowerCase().replace(/\s+/g, '_');
  const { rows } = await db.query(
    `INSERT INTO addresses (normalized_hash, city, state, country, address_type, confidence_score, is_high_risk)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (normalized_hash) DO UPDATE
       SET confidence_score = EXCLUDED.confidence_score, is_high_risk = EXCLUDED.is_high_risk
     RETURNING address_id, confidence_score, is_high_risk`,
    [normalized_hash, city, state || null, country, address_type, confidence_score || null, is_high_risk]
  );
  return rows[0];
}

// ─── SHIPMENTS ─────────────────────────────────────────────────────────────

/**
 * Create a new shipment record.
 * Returns the shipment_id (UUID) and booking_ref.
 */
async function createShipment({
  booking_ref, account_id, shipper_id, device_id, payment_id,
  origin_address_id, dest_address_id, service, weight_kg, package_count,
  ip_address, booked_at, status = 'SCREENING',
}) {
  // ip_address column is INET type — pass null if not a valid IP
  const validIp = ip_address && /^[\d.:a-fA-F]+$/.test(ip_address) ? ip_address : null;
  const { rows } = await db.query(
    `INSERT INTO shipments
       (booking_ref, account_id, shipper_id, device_id, payment_id,
        origin_address_id, dest_address_id, service, weight_kg, package_count,
        ip_address, booked_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::inet,$12,$13)
     RETURNING shipment_id, booking_ref`,
    [booking_ref, account_id, shipper_id, device_id || null, payment_id || null,
     origin_address_id, dest_address_id, service, weight_kg, package_count || 1,
     validIp, booked_at || new Date().toISOString(), status]
  );
  return rows[0];
}

/**
 * Update shipment status.
 */
async function updateShipmentStatus(shipment_id, status) {
  await db.query(
    `UPDATE shipments SET status = $2, updated_at = now() WHERE shipment_id = $1`,
    [shipment_id, status]
  );
}

/**
 * Get recent shipment velocity stats for an account.
 */
async function getShipmentVelocity(account_id, days = 90) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) AS total_in_window,
       AVG(weight_kg) AS avg_weight,
       STDDEV(weight_kg) AS std_weight,
       COUNT(*) / GREATEST($2::numeric, 1) AS avg_daily,
       ARRAY_AGG(DISTINCT dest_address_id::text) AS dest_ids,
       ARRAY_AGG(DISTINCT EXTRACT(HOUR FROM booked_at)::int) AS booking_hours,
       ARRAY_AGG(DISTINCT service::text) AS services
     FROM shipments
     WHERE account_id = $1
       AND booked_at >= now() - ($2 || ' days')::interval
       AND status NOT IN ('BLOCKED','CANCELLED')`,
    [account_id, days]
  );
  return rows[0];
}

// ─── RISK ASSESSMENTS ──────────────────────────────────────────────────────

/**
 * Persist a full risk assessment + triggered rules.
 * Returns the assessment_id.
 */
async function saveRiskAssessment({
  shipment_id, risk_score, risk_level, fraud_probability,
  rule_score, ml_score, features, triggered_rules,
}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Insert assessment — use only columns present in the real Neon schema
    const { rows } = await client.query(
      `INSERT INTO risk_assessments
         (shipment_id, risk_score, risk_level, fraud_probability,
          rule_score, ml_score, features, input_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING assessment_id`,
      [shipment_id, risk_score, risk_level,
       fraud_probability != null ? fraud_probability : null,
       rule_score != null ? rule_score : null,
       ml_score != null ? ml_score : null,
       JSON.stringify(features || {}),
       JSON.stringify(features || {})]  // input_snapshot = features snapshot (NOT NULL in schema)
    );
    const assessment_id = rows[0].assessment_id;

    // Insert triggered rules as risk_reasons
    if (triggered_rules && triggered_rules.length > 0) {
      for (let i = 0; i < triggered_rules.length; i++) {
        const rule = triggered_rules[i];
        await client.query(
          `INSERT INTO risk_reasons (assessment_id, rank, reason_code, category, points, description)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [assessment_id, i + 1,
           rule.code || 'UNKNOWN', rule.category || 'BEHAVIOR',
           rule.risk_points || 0,
           rule.description || rule.name || rule.code || '']
        );
      }
    }

    await client.query('COMMIT');
    return assessment_id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ─── DECISIONS ─────────────────────────────────────────────────────────────

/**
 * Persist a decision record.
 * Returns the decision_id.
 */
async function saveDecision({ shipment_id, assessment_id, action, decided_by_type = 'SYSTEM', reason }) {
  const { rows } = await db.query(
    `INSERT INTO decisions (shipment_id, assessment_id, action, decided_by_type, reason)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING decision_id`,
    [shipment_id, assessment_id || null, action, decided_by_type, reason || null]
  );
  return rows[0].decision_id;
}

// ─── FRAUD CASES ───────────────────────────────────────────────────────────

/**
 * Auto-open a fraud case for REVIEW/BLOCK decisions.
 * Idempotent — returns existing case if one exists.
 */
async function openFraudCase({ shipment_id, assessment_id, account_id, risk_level }) {
  const priorityMap = { CRITICAL: 'URGENT', HIGH: 'HIGH', MEDIUM: 'NORMAL', LOW: 'LOW' };
  const slaHours = { URGENT: 4, HIGH: 8, NORMAL: 24, LOW: 72 };
  const priority = priorityMap[risk_level] || 'NORMAL';
  const sla_due_at = new Date(Date.now() + slaHours[priority] * 3600 * 1000).toISOString();

  const { rows } = await db.query(
    `INSERT INTO fraud_cases (shipment_id, assessment_id, account_id, priority, sla_due_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING
     RETURNING case_id`,
    [shipment_id, assessment_id || null, account_id || null, priority, sla_due_at]
  );
  return rows[0]?.case_id || null;
}

// ─── ENTITY LINKS (FRAUD GRAPH) ────────────────────────────────────────────

/**
 * Upsert an entity link (graph edge).
 */
async function upsertEntityLink({ src_type, src_id, dst_type, dst_id, link_type }) {
  await db.query(
    `INSERT INTO entity_links (src_type, src_id, dst_type, dst_id, link_type, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (src_type, src_id, dst_type, dst_id, link_type) DO UPDATE
       SET weight = entity_links.weight + 1, last_seen_at = now()`,
    [src_type, src_id, dst_type, dst_id, link_type]
  );
}

// ─── SHIPPER PROFILES ──────────────────────────────────────────────────────

/**
 * Upsert shipper behavioral profile (computed from shipment history).
 */
async function upsertShipperProfile(account_id) {
  // Compute stats from last 90 days of real shipments
  const { rows } = await db.query(
    `SELECT
       COUNT(*) AS total,
       AVG(weight_kg) AS avg_weight,
       STDDEV(weight_kg) AS std_weight,
       COUNT(*) / 90.0 AS avg_daily
     FROM shipments
     WHERE account_id = $1 AND booked_at >= now() - interval '90 days'
       AND status NOT IN ('BLOCKED','CANCELLED')`,
    [account_id]
  );
  const stats = rows[0];

  await db.query(
    `INSERT INTO shipper_profiles
       (account_id, total_shipments, avg_daily_volume, avg_weight_kg, std_weight_kg)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (account_id) DO UPDATE
       SET total_shipments = EXCLUDED.total_shipments,
           avg_daily_volume = EXCLUDED.avg_daily_volume,
           avg_weight_kg = EXCLUDED.avg_weight_kg,
           std_weight_kg = EXCLUDED.std_weight_kg,
           updated_at = now()`,
    [account_id,
     parseInt(stats.total) || 0,
     parseFloat(stats.avg_daily) || 0,
     parseFloat(stats.avg_weight) || 0,
     parseFloat(stats.std_weight) || 0]
  );
}

// ─── AUDIT LOG ─────────────────────────────────────────────────────────────

/**
 * Write a lightweight audit log entry (Node.js side).
 */
async function logAuditEvent({ action, entity_type, entity_id, shipment_id, actor_type = 'SYSTEM', after_state }) {
  await db.query(
    `INSERT INTO audit_log (action, entity_type, entity_id, shipment_id, actor_type, after_state)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [action, entity_type, entity_id || null, shipment_id || null, actor_type, JSON.stringify(after_state || {})]
  ).catch(e => console.warn('Audit log write failed:', e.message));
}

module.exports = {
  // Shipper/Account
  upsertShipper, upsertAccount, getAccountProfile,
  // Devices
  upsertDevice, linkDeviceToAccount, getDeviceFraudSignals,
  // Payments
  upsertPayment, linkPaymentToAccount, isPaymentKnownForAccount,
  // Addresses
  upsertAddress,
  // Shipments
  createShipment, updateShipmentStatus, getShipmentVelocity,
  // Risk pipeline
  saveRiskAssessment, saveDecision, openFraudCase,
  // Graph
  upsertEntityLink,
  // Profile
  upsertShipperProfile,
  // Audit
  logAuditEvent,
};
