// src/services/behavioralProfileService.js
//
// ADAPTIVE BEHAVIORAL PROFILING SERVICE
//
// Manages entity-scoped behavioral familiarity state that allows FraudShield
// to adapt when a legitimate shipper changes normal behavior (e.g., new warehouse,
// new city, new service type) without creating a global whitelist.
//
// Key design principles:
//   1. Entity-scoped: learning for Account A does not affect Account B
//   2. Dimension-specific: learning "destination X is familiar" does NOT mean
//      "device/payment/IP are trusted" — only the relevant behavioral signal is affected
//   3. Evidence-based: only analyst-verified FALSE_POSITIVE verdicts create familiarity
//   4. Auditable: every entry has provenance (shipment_id, analyst_id, timestamp)
//   5. Reversible: entries can be invalidated if later found fraudulent
//   6. Recency-aware: long-unused behaviors decay in familiarity
//   7. Fraud-resistant: entries from accounts with confirmed fraud are automatically invalidated
//   8. Fail-safe: if the profile cannot be read, the system does NOT reduce scrutiny

const db = require('../db/index');
const logger = require('../utils/logger');

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

const CONFIG = {
  // Recency: entries older than this many days are considered stale
  STALE_DAYS: 180,

  // Evidence strength: minimum verified occurrences for full familiarity
  MIN_OCCURRENCES_FOR_ESTABLISHED: 3,

  // Decay: weight multiplier for entries approaching staleness (linear decay)
  // At STALE_DAYS/2, weight = 0.5; at STALE_DAYS, weight = 0
  DECAY_ENABLED: true,

  // Maximum score reduction from behavioral familiarity (caps the benefit)
  MAX_FAMILIARITY_REDUCTION: 8,

  // Supported behavioral dimensions
  DIMENSIONS: ['destination', 'origin', 'service_type', 'booking_hour_range'],
};

// ─── DATABASE TABLE CREATION (idempotent) ───────────────────────────────────

/**
 * Ensure the behavioral_familiarity table exists.
 * Called once at startup. Safe to call multiple times.
 */
async function ensureTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS behavioral_familiarity (
        familiarity_id    BIGSERIAL PRIMARY KEY,
        account_id        UUID NOT NULL,
        dimension         TEXT NOT NULL,
        value             TEXT NOT NULL,
        occurrence_count  INT NOT NULL DEFAULT 1,
        first_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_verified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        source_shipment_id UUID,
        source_analyst_id  UUID,
        source_case_id     UUID,
        is_invalidated    BOOLEAN NOT NULL DEFAULT FALSE,
        invalidated_at    TIMESTAMPTZ,
        invalidated_reason TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (account_id, dimension, value)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_bf_account_dim
      ON behavioral_familiarity(account_id, dimension)
      WHERE NOT is_invalidated
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_bf_source_shipment
      ON behavioral_familiarity(source_shipment_id)
    `);
  } catch (err) {
    logger.warn('behavioral_familiarity table setup warning:', err.message);
  }
}

// ─── CORE API ───────────────────────────────────────────────────────────────

/**
 * Check if a specific behavior is familiar for an account.
 *
 * Returns a familiarity object:
 *   { familiar: boolean, strength: number (0-1), entry: object|null }
 *
 * strength:
 *   0.0 = unfamiliar (no entry, stale, or invalidated)
 *   0.0-0.5 = weakly familiar (single verified occurrence, or decaying)
 *   0.5-1.0 = established familiar (multiple verified occurrences, recent)
 *
 * FAIL-SAFE: On any error, returns { familiar: false, strength: 0, entry: null }
 *            This ensures lookup failures never reduce fraud scrutiny.
 */
async function checkFamiliarity(accountId, dimension, value) {
  try {
    if (!accountId || !dimension || !value) {
      return { familiar: false, strength: 0, entry: null };
    }

    const normalizedValue = normalizeValue(dimension, value);

    const { rows } = await db.query(
      `SELECT familiarity_id, account_id, dimension, value,
              occurrence_count, first_verified_at, last_verified_at,
              source_shipment_id, source_analyst_id, is_invalidated
       FROM behavioral_familiarity
       WHERE account_id = $1 AND dimension = $2 AND value = $3
         AND NOT is_invalidated`,
      [accountId, dimension, normalizedValue]
    );

    if (rows.length === 0) {
      return { familiar: false, strength: 0, entry: null };
    }

    const entry = rows[0];
    const daysSinceLastVerified = _daysSince(entry.last_verified_at);

    // Stale check
    if (daysSinceLastVerified > CONFIG.STALE_DAYS) {
      return { familiar: false, strength: 0, entry, stale: true };
    }

    // Compute strength based on evidence count and recency
    let strength = Math.min(1.0,
      entry.occurrence_count / CONFIG.MIN_OCCURRENCES_FOR_ESTABLISHED
    );

    // Apply recency decay
    if (CONFIG.DECAY_ENABLED && daysSinceLastVerified > 0) {
      const decayFactor = Math.max(0, 1 - (daysSinceLastVerified / CONFIG.STALE_DAYS));
      strength *= decayFactor;
    }

    strength = Math.round(strength * 100) / 100;

    return {
      familiar: strength > 0,
      strength,
      entry,
    };
  } catch (err) {
    // FAIL-SAFE: lookup failure → treat as unfamiliar (no reduced scrutiny)
    logger.warn('Behavioral familiarity lookup failed — defaulting to unfamiliar', {
      accountId, dimension, value, error: err.message,
    });
    return { familiar: false, strength: 0, entry: null, error: err.message };
  }
}

/**
 * Get all familiar behaviors for an account (for profile display / audit).
 *
 * Returns array of familiarity entries with computed strength.
 * FAIL-SAFE: returns empty array on error.
 */
async function getAccountFamiliarity(accountId) {
  try {
    const { rows } = await db.query(
      `SELECT familiarity_id, dimension, value,
              occurrence_count, first_verified_at, last_verified_at,
              source_shipment_id, source_analyst_id, source_case_id,
              is_invalidated, invalidated_at, invalidated_reason
       FROM behavioral_familiarity
       WHERE account_id = $1
       ORDER BY dimension, last_verified_at DESC`,
      [accountId]
    );

    return rows.map(entry => {
      const daysSinceLastVerified = _daysSince(entry.last_verified_at);
      let strength = Math.min(1.0,
        entry.occurrence_count / CONFIG.MIN_OCCURRENCES_FOR_ESTABLISHED
      );
      if (CONFIG.DECAY_ENABLED && daysSinceLastVerified > 0) {
        const decayFactor = Math.max(0, 1 - (daysSinceLastVerified / CONFIG.STALE_DAYS));
        strength *= decayFactor;
      }
      return {
        ...entry,
        strength: Math.round(strength * 100) / 100,
        is_stale: daysSinceLastVerified > CONFIG.STALE_DAYS,
      };
    });
  } catch (err) {
    logger.warn('Failed to get account familiarity', { accountId, error: err.message });
    return [];
  }
}

/**
 * Record a verified legitimate behavior for an account.
 *
 * Called when an analyst marks a shipment as FALSE_POSITIVE, indicating
 * the flagged behavior was actually legitimate.
 *
 * IMPORTANT: This function ONLY accepts analyst-verified evidence.
 * Unreviewed shipments do NOT create familiarity entries.
 *
 * @param {string} accountId - The account UUID
 * @param {string} dimension - Behavioral dimension (e.g., 'destination')
 * @param {string} value - The specific behavior value (e.g., 'Mumbai')
 * @param {object} evidence - Provenance: { shipment_id, analyst_id, case_id }
 * @returns {object} The created/updated familiarity entry
 */
async function recordVerifiedBehavior(accountId, dimension, value, evidence = {}) {
  try {
    if (!CONFIG.DIMENSIONS.includes(dimension)) {
      logger.warn('Unknown behavioral dimension', { dimension });
      return null;
    }

    const normalizedValue = normalizeValue(dimension, value);

    const { rows } = await db.query(
      `INSERT INTO behavioral_familiarity
         (account_id, dimension, value,
          occurrence_count, first_verified_at, last_verified_at,
          source_shipment_id, source_analyst_id, source_case_id)
       VALUES ($1, $2, $3, 1, now(), now(), $4, $5, $6)
       ON CONFLICT (account_id, dimension, value)
       DO UPDATE SET
         occurrence_count = behavioral_familiarity.occurrence_count + 1,
         last_verified_at = now(),
         source_shipment_id = COALESCE($4, behavioral_familiarity.source_shipment_id),
         source_analyst_id = COALESCE($5, behavioral_familiarity.source_analyst_id),
         source_case_id = COALESCE($6, behavioral_familiarity.source_case_id),
         is_invalidated = FALSE,
         invalidated_at = NULL,
         invalidated_reason = NULL,
         updated_at = now()
       RETURNING *`,
      [
        accountId, dimension, normalizedValue,
        evidence.shipment_id || null,
        evidence.analyst_id || null,
        evidence.case_id || null,
      ]
    );

    const entry = rows[0];

    logger.info('Behavioral familiarity recorded', {
      account_id: accountId,
      dimension,
      value: normalizedValue,
      occurrence_count: entry.occurrence_count,
      analyst_id: evidence.analyst_id,
    });

    return entry;
  } catch (err) {
    // FAIL-SAFE: write failure does not block the analyst workflow
    logger.error('Failed to record behavioral familiarity', {
      accountId, dimension, value, error: err.message,
    });
    return null;
  }
}

/**
 * Invalidate behavioral familiarity entries for an account.
 *
 * Called when:
 *   1. An analyst confirms fraud on an account (CONFIRMED_FRAUD verdict)
 *   2. A previously FALSE_POSITIVE decision is reversed
 *   3. An account is suspended or flagged for investigation
 *
 * @param {string} accountId - The account UUID
 * @param {string} reason - Reason for invalidation
 * @param {object} options - Optional: { dimension, value, shipment_id }
 *                           If dimension+value specified, invalidates only that entry
 *                           If shipment_id specified, invalidates entries from that shipment
 *                           If neither, invalidates ALL entries for the account
 */
async function invalidateFamiliarity(accountId, reason, options = {}) {
  try {
    let query_text;
    let params;

    if (options.dimension && options.value) {
      // Invalidate specific entry
      const normalizedValue = normalizeValue(options.dimension, options.value);
      query_text = `
        UPDATE behavioral_familiarity
        SET is_invalidated = TRUE, invalidated_at = now(),
            invalidated_reason = $3, updated_at = now()
        WHERE account_id = $1 AND dimension = $2 AND value = $4
          AND NOT is_invalidated
        RETURNING familiarity_id`;
      params = [accountId, options.dimension, reason, normalizedValue];
    } else if (options.shipment_id) {
      // Invalidate entries sourced from a specific shipment
      query_text = `
        UPDATE behavioral_familiarity
        SET is_invalidated = TRUE, invalidated_at = now(),
            invalidated_reason = $2, updated_at = now()
        WHERE account_id = $1 AND source_shipment_id = $3
          AND NOT is_invalidated
        RETURNING familiarity_id`;
      params = [accountId, reason, options.shipment_id];
    } else {
      // Invalidate ALL entries for the account (fraud confirmed / ATO)
      query_text = `
        UPDATE behavioral_familiarity
        SET is_invalidated = TRUE, invalidated_at = now(),
            invalidated_reason = $2, updated_at = now()
        WHERE account_id = $1 AND NOT is_invalidated
        RETURNING familiarity_id`;
      params = [accountId, reason];
    }

    const { rows } = await db.query(query_text, params);

    if (rows.length > 0) {
      logger.info('Behavioral familiarity invalidated', {
        account_id: accountId,
        reason,
        entries_invalidated: rows.length,
      });
    }

    return rows.length;
  } catch (err) {
    logger.error('Failed to invalidate behavioral familiarity', {
      accountId, reason, error: err.message,
    });
    return 0;
  }
}

/**
 * Process analyst feedback to update behavioral profiles.
 *
 * Called after an analyst records a verdict on a fraud case.
 * This is the bridge between the analyst feedback workflow and behavioral adaptation.
 *
 * @param {object} params
 * @param {string} params.account_id - Account UUID
 * @param {string} params.shipment_id - Shipment UUID
 * @param {string} params.verdict - 'FALSE_POSITIVE' | 'CONFIRMED_FRAUD' | 'INCONCLUSIVE'
 * @param {string} params.analyst_id - Staff UUID
 * @param {string} params.case_id - Case UUID
 * @param {object} params.shipment_details - { origin, destination, service_type }
 */
async function processAnalystFeedback(params) {
  const { account_id, shipment_id, verdict, analyst_id, case_id, shipment_details } = params;

  if (verdict === 'FALSE_POSITIVE' && shipment_details) {
    // Analyst verified this shipment is legitimate — learn the behavior
    const evidence = { shipment_id, analyst_id, case_id };

    const promises = [];

    if (shipment_details.destination) {
      promises.push(
        recordVerifiedBehavior(account_id, 'destination', shipment_details.destination, evidence)
      );
    }
    if (shipment_details.origin) {
      promises.push(
        recordVerifiedBehavior(account_id, 'origin', shipment_details.origin, evidence)
      );
    }
    if (shipment_details.service_type) {
      promises.push(
        recordVerifiedBehavior(account_id, 'service_type', shipment_details.service_type, evidence)
      );
    }

    await Promise.all(promises);

    logger.info('Behavioral profile updated from analyst feedback', {
      account_id, verdict, shipment_id, analyst_id,
    });
  } else if (verdict === 'CONFIRMED_FRAUD') {
    // Fraud confirmed — invalidate ALL behavioral familiarity for this account
    // This prevents account takeover from inheriting legitimate profile
    await invalidateFamiliarity(
      account_id,
      `CONFIRMED_FRAUD on shipment ${shipment_id} by analyst ${analyst_id}`,
      {}  // invalidate ALL entries
    );

    logger.info('Behavioral profile invalidated due to confirmed fraud', {
      account_id, shipment_id,
    });
  }
  // INCONCLUSIVE: no action — neither learn nor invalidate
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Normalize behavioral values for consistent matching.
 */
function normalizeValue(dimension, value) {
  if (!value) return '';
  const str = String(value).trim();
  switch (dimension) {
    case 'destination':
    case 'origin':
      // Case-insensitive city matching
      return str.toLowerCase().replace(/\s+/g, '_');
    case 'service_type':
      return str.toUpperCase();
    case 'booking_hour_range':
      return str;
    default:
      return str.toLowerCase();
  }
}

/**
 * Calculate days between a date and now.
 */
function _daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = {
  ensureTable,
  checkFamiliarity,
  getAccountFamiliarity,
  recordVerifiedBehavior,
  invalidateFamiliarity,
  processAnalystFeedback,
  normalizeValue,
  CONFIG,
};
