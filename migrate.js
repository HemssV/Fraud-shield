/**
 * migrate.js — Idempotent schema migration for Neon PostgreSQL
 * Runs the schema.sql in a way that skips already-existing types/tables.
 * Usage: node migrate.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log('🗄️  Connecting to Neon...');

  // Create pgcrypto extension
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto').catch(() => {});
  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"').catch(() => {});

  console.log('📐 Creating ENUMs...');
  const enums = [
    `DO $$ BEGIN CREATE TYPE account_status AS ENUM ('ACTIVE','SUSPENDED','CLOSED','UNDER_INVESTIGATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE account_type AS ENUM ('BUSINESS','INDIVIDUAL','ENTERPRISE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE user_role AS ENUM ('OWNER','ADMIN','SHIPPER_USER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE payment_method_type AS ENUM ('CREDIT_CARD','DEBIT_CARD','BANK_TRANSFER','INVOICE','WALLET'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE address_type AS ENUM ('RESIDENTIAL','COMMERCIAL','FREIGHT_FORWARDER','RESHIPPER','DROP_OFF','PO_BOX','UNKNOWN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE service_type AS ENUM ('GROUND','EXPRESS','EXPRESS_SAVER','FREIGHT','INTERNATIONAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE shipment_status AS ENUM ('BOOKED','SCREENING','ALLOWED','HELD','BLOCKED','RELEASED','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE screening_stage AS ENUM ('BOOKING','PICKUP','IN_TRANSIT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE account_event_type AS ENUM ('LOGIN','LOGIN_FAILED','PASSWORD_CHANGE','EMAIL_CHANGE','PHONE_CHANGE','PAYMENT_ADDED','USER_ADDED','PICKUP_ADDRESS_ADDED','PROFILE_UPDATE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE entity_type AS ENUM ('SHIPPER','ACCOUNT','USER','DEVICE','PAYMENT','ADDRESS','IP','SHIPMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE signal_type AS ENUM ('PRIOR_FRAUD','LINKED_TO_BLOCKED_ACCOUNT','DEVICE_REUSE','PAYMENT_FRAUD_HISTORY','ADDRESS_RISK','VELOCITY','WATCHLIST','EXTERNAL_FEED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE link_type AS ENUM ('USES_DEVICE','USES_PAYMENT','SHIPS_TO','SHIPS_FROM','USES_IP','HAS_USER','SHARES_CONTACT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE risk_level AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE decision_action AS ENUM ('ALLOW','ALLOW_MONITOR','VERIFY','REVIEW','BLOCK'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE decided_by_type AS ENUM ('SYSTEM','ANALYST','POLICY_OVERRIDE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE engine_mode AS ENUM ('NORMAL','FAIL_OPEN','FAIL_CLOSED','DEGRADED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE verification_method AS ENUM ('OTP_SMS','OTP_EMAIL','AUTHORIZED_USER_CONFIRM','DOCUMENT_CHECK'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE verification_status AS ENUM ('PENDING','PASSED','FAILED','EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE staff_role AS ENUM ('ANALYST','SENIOR_ANALYST','FRAUD_ADMIN','AUDITOR','READ_ONLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE case_status AS ENUM ('OPEN','IN_REVIEW','AWAITING_CUSTOMER','CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE case_priority AS ENUM ('LOW','NORMAL','HIGH','URGENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE verdict_type AS ENUM ('CONFIRMED_FRAUD','FALSE_POSITIVE','INCONCLUSIVE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE fraud_type AS ENUM ('ACCOUNT_TAKEOVER','VOLUME_ATTACK','DESTINATION_ANOMALY','PAYMENT_MISMATCH','FRAUD_RING','LOW_AND_SLOW','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE label_source AS ENUM ('SYNTHETIC','ANALYST','POST_DELIVERY_ANALYSIS','CHARGEBACK'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE rule_category AS ENUM ('BEHAVIOR','IDENTITY','PAYMENT','ADDRESS','GRAPH','VELOCITY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE ring_status AS ENUM ('SUSPECTED','CONFIRMED','DISMISSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE sim_scenario AS ENUM ('NORMAL','ACCOUNT_TAKEOVER','VOLUME_SPIKE','PAYMENT_FRAUD','DESTINATION_ANOMALY','FRAUD_RING','LOW_AND_SLOW','SEASONAL_LEGIT_SPIKE','MIXED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ];
  for (const sql of enums) await pool.query(sql);

  console.log('🔧 Creating trigger functions...');
  await pool.query(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME; END $$ LANGUAGE plpgsql
  `);

  console.log('🏗️  Creating tables...');

  const tables = [
    // peer_groups
    `CREATE TABLE IF NOT EXISTS peer_groups (
      peer_group_id   SERIAL PRIMARY KEY,
      industry        TEXT NOT NULL,
      size_band       TEXT NOT NULL CHECK (size_band IN ('SMALL','MEDIUM','LARGE','ENTERPRISE')),
      region          TEXT NOT NULL,
      avg_daily_volume NUMERIC(12,2),
      std_daily_volume NUMERIC(12,2),
      avg_weight_kg   NUMERIC(10,2),
      std_weight_kg   NUMERIC(10,2),
      service_mix     JSONB NOT NULL DEFAULT '{}',
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (industry, size_band, region)
    )`,
    // shippers
    `CREATE TABLE IF NOT EXISTS shippers (
      shipper_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      external_ref    TEXT UNIQUE,
      company_name    TEXT NOT NULL,
      industry        TEXT,
      size_band       TEXT CHECK (size_band IN ('SMALL','MEDIUM','LARGE','ENTERPRISE')),
      region          TEXT,
      country         CHAR(2) NOT NULL DEFAULT 'IN',
      peer_group_id   INT REFERENCES peer_groups(peer_group_id),
      is_trusted      BOOLEAN NOT NULL DEFAULT FALSE,
      trusted_since   DATE,
      historical_fraud_count INT NOT NULL DEFAULT 0 CHECK (historical_fraud_count >= 0),
      is_synthetic    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // accounts
    `CREATE TABLE IF NOT EXISTS accounts (
      account_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipper_id      UUID NOT NULL REFERENCES shippers(shipper_id),
      account_number  TEXT NOT NULL UNIQUE,
      account_type    account_type NOT NULL DEFAULT 'BUSINESS',
      status          account_status NOT NULL DEFAULT 'ACTIVE',
      home_region     TEXT,
      opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_profile_change_at TIMESTAMPTZ,
      last_password_change_at TIMESTAMPTZ,
      is_synthetic    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // account_users
    `CREATE TABLE IF NOT EXISTS account_users (
      user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id      UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      display_name    TEXT,
      email_hash      BYTEA NOT NULL,
      phone_hash      BYTEA,
      email_masked    TEXT,
      phone_masked    TEXT,
      role            user_role NOT NULL DEFAULT 'SHIPPER_USER',
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      removed_at      TIMESTAMPTZ
    )`,
    // devices
    `CREATE TABLE IF NOT EXISTS devices (
      device_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fingerprint_hash TEXT NOT NULL UNIQUE,
      device_type     TEXT,
      os_family       TEXT,
      browser_family  TEXT,
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      linked_account_count INT NOT NULL DEFAULT 0,
      is_flagged      BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    // addresses
    `CREATE TABLE IF NOT EXISTS addresses (
      address_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      normalized_hash TEXT NOT NULL UNIQUE,
      line1           TEXT,
      line2           TEXT,
      city            TEXT NOT NULL,
      state           TEXT,
      postal_code     TEXT,
      country         CHAR(2) NOT NULL DEFAULT 'IN',
      latitude        NUMERIC(9,6),
      longitude       NUMERIC(9,6),
      address_type    address_type NOT NULL DEFAULT 'UNKNOWN',
      confidence_score SMALLINT CHECK (confidence_score BETWEEN 0 AND 100),
      is_high_risk    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // payments
    `CREATE TABLE IF NOT EXISTS payments (
      payment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_token   TEXT NOT NULL UNIQUE,
      method_type     payment_method_type NOT NULL,
      last4           CHAR(4),
      issuer_country  CHAR(2),
      billing_address_id UUID REFERENCES addresses(address_id),
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      failed_attempt_count INT NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
      is_flagged      BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    // account_devices
    `CREATE TABLE IF NOT EXISTS account_devices (
      account_id      UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      device_id       UUID NOT NULL REFERENCES devices(device_id),
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      login_count     INT NOT NULL DEFAULT 1,
      is_trusted      BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (account_id, device_id)
    )`,
    // account_payments
    `CREATE TABLE IF NOT EXISTS account_payments (
      account_id      UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      payment_id      UUID NOT NULL REFERENCES payments(payment_id),
      first_used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      usage_count     INT NOT NULL DEFAULT 0,
      is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
      holder_name_matches BOOLEAN,
      PRIMARY KEY (account_id, payment_id)
    )`,
    // shipments
    `CREATE TABLE IF NOT EXISTS shipments (
      shipment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_ref     TEXT NOT NULL UNIQUE,
      account_id      UUID NOT NULL REFERENCES accounts(account_id),
      shipper_id      UUID NOT NULL REFERENCES shippers(shipper_id),
      user_id         UUID REFERENCES account_users(user_id),
      device_id       UUID REFERENCES devices(device_id),
      payment_id      UUID REFERENCES payments(payment_id),
      origin_address_id UUID NOT NULL REFERENCES addresses(address_id),
      dest_address_id UUID NOT NULL REFERENCES addresses(address_id),
      service         service_type NOT NULL,
      weight_kg       NUMERIC(10,2) NOT NULL CHECK (weight_kg > 0),
      length_cm       NUMERIC(8,2),
      width_cm        NUMERIC(8,2),
      height_cm       NUMERIC(8,2),
      package_count   INT NOT NULL DEFAULT 1 CHECK (package_count > 0),
      declared_value  NUMERIC(12,2) CHECK (declared_value >= 0),
      shipping_cost   NUMERIC(12,2) CHECK (shipping_cost >= 0),
      currency        CHAR(3) NOT NULL DEFAULT 'INR',
      ip_address      TEXT,
      ip_region       TEXT,
      session_login_at TIMESTAMPTZ,
      booked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      status          shipment_status NOT NULL DEFAULT 'BOOKED',
      is_synthetic    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // fraud_signals
    `CREATE TABLE IF NOT EXISTS fraud_signals (
      signal_id       BIGSERIAL PRIMARY KEY,
      entity_type     entity_type NOT NULL,
      entity_id       UUID NOT NULL,
      signal_type     signal_type NOT NULL,
      severity        SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 10),
      confidence      NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
      source          TEXT NOT NULL,
      description     TEXT,
      related_shipment_id UUID REFERENCES shipments(shipment_id),
      detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE
    )`,
    // entity_links (fraud graph)
    `CREATE TABLE IF NOT EXISTS entity_links (
      link_id         BIGSERIAL PRIMARY KEY,
      src_type        entity_type NOT NULL,
      src_id          UUID NOT NULL,
      dst_type        entity_type NOT NULL,
      dst_id          UUID NOT NULL,
      link_type       link_type NOT NULL,
      weight          INT NOT NULL DEFAULT 1,
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (src_type, src_id, dst_type, dst_id, link_type)
    )`,
    // fraud_rings
    `CREATE TABLE IF NOT EXISTS fraud_rings (
      ring_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      status          ring_status NOT NULL DEFAULT 'SUSPECTED',
      ring_score      NUMERIC(5,2) CHECK (ring_score BETWEEN 0 AND 100),
      shared_entities JSONB NOT NULL DEFAULT '{}',
      notes           TEXT
    )`,
    // fraud_ring_members
    `CREATE TABLE IF NOT EXISTS fraud_ring_members (
      ring_id         UUID NOT NULL REFERENCES fraud_rings(ring_id) ON DELETE CASCADE,
      account_id      UUID NOT NULL REFERENCES accounts(account_id),
      PRIMARY KEY (ring_id, account_id)
    )`,
    // shipper_profiles
    `CREATE TABLE IF NOT EXISTS shipper_profiles (
      account_id      UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
      window_days     INT NOT NULL DEFAULT 90,
      history_days    INT NOT NULL DEFAULT 0,
      total_shipments INT NOT NULL DEFAULT 0,
      avg_daily_volume NUMERIC(12,2),
      std_daily_volume NUMERIC(12,2),
      max_daily_volume INT,
      avg_weight_kg   NUMERIC(10,2),
      std_weight_kg   NUMERIC(10,2),
      avg_shipping_cost NUMERIC(12,2),
      common_origins  JSONB NOT NULL DEFAULT '[]',
      common_destinations JSONB NOT NULL DEFAULT '[]',
      service_mix     JSONB NOT NULL DEFAULT '{}',
      hour_histogram  INT[] NOT NULL DEFAULT ARRAY_FILL(0, ARRAY[24]),
      peer_group_id   INT REFERENCES peer_groups(peer_group_id),
      profile_version INT NOT NULL DEFAULT 1,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // risk_assessments
    `CREATE TABLE IF NOT EXISTS risk_assessments (
      assessment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id     UUID NOT NULL REFERENCES shipments(shipment_id),
      stage           screening_stage NOT NULL DEFAULT 'BOOKING',
      risk_score      NUMERIC(5,2) NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
      risk_level      risk_level NOT NULL,
      fraud_probability NUMERIC(5,4) CHECK (fraud_probability BETWEEN 0 AND 1),
      rule_score      NUMERIC(5,2),
      ml_score        NUMERIC(5,2),
      rule_set_version TEXT,
      model_version   TEXT,
      features        JSONB NOT NULL DEFAULT '{}',
      assessed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // risk_reasons
    `CREATE TABLE IF NOT EXISTS risk_reasons (
      reason_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      assessment_id   UUID NOT NULL REFERENCES risk_assessments(assessment_id) ON DELETE CASCADE,
      rank            SMALLINT NOT NULL DEFAULT 1,
      reason_code     TEXT NOT NULL,
      category        rule_category NOT NULL,
      points          NUMERIC(6,2) NOT NULL DEFAULT 0,
      observed_value  TEXT,
      baseline_value  TEXT,
      description     TEXT
    )`,
    // decisions
    `CREATE TABLE IF NOT EXISTS decisions (
      decision_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id     UUID NOT NULL REFERENCES shipments(shipment_id),
      assessment_id   UUID REFERENCES risk_assessments(assessment_id),
      action          decision_action NOT NULL,
      decided_by_type decided_by_type NOT NULL DEFAULT 'SYSTEM',
      reason          TEXT,
      supersedes_id   UUID REFERENCES decisions(decision_id),
      decided_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // staff_users
    `CREATE TABLE IF NOT EXISTS staff_users (
      staff_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email           TEXT NOT NULL UNIQUE,
      full_name       TEXT NOT NULL,
      role            staff_role NOT NULL DEFAULT 'ANALYST',
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // fraud_cases
    `CREATE TABLE IF NOT EXISTS fraud_cases (
      case_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id     UUID NOT NULL REFERENCES shipments(shipment_id),
      assessment_id   UUID REFERENCES risk_assessments(assessment_id),
      account_id      UUID REFERENCES accounts(account_id),
      status          case_status NOT NULL DEFAULT 'OPEN',
      priority        case_priority NOT NULL DEFAULT 'NORMAL',
      verdict         verdict_type,
      assigned_to_id  UUID REFERENCES staff_users(staff_id),
      opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      sla_due_at      TIMESTAMPTZ,
      closed_at       TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // analyst_feedback
    `CREATE TABLE IF NOT EXISTS analyst_feedback (
      feedback_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id         UUID REFERENCES fraud_cases(case_id),
      shipment_id     UUID NOT NULL REFERENCES shipments(shipment_id),
      analyst_id      UUID REFERENCES staff_users(staff_id),
      predicted_level risk_level,
      verdict         verdict_type NOT NULL,
      fraud_type      fraud_type,
      override_action decision_action,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // genai_explanations
    `CREATE TABLE IF NOT EXISTS genai_explanations (
      explanation_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      assessment_id   UUID NOT NULL REFERENCES risk_assessments(assessment_id),
      llm_model       TEXT NOT NULL,
      prompt_hash     TEXT NOT NULL,
      summary_text    TEXT,
      recommended_actions JSONB NOT NULL DEFAULT '[]',
      grounded_reason_ids JSONB NOT NULL DEFAULT '[]',
      generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // audit_log
    `CREATE TABLE IF NOT EXISTS audit_log (
      audit_id        BIGSERIAL PRIMARY KEY,
      occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor_type      TEXT NOT NULL,
      actor_id        UUID,
      action          TEXT NOT NULL,
      entity_type     TEXT NOT NULL,
      entity_id       UUID,
      shipment_id     UUID REFERENCES shipments(shipment_id),
      before_state    JSONB,
      after_state     JSONB,
      ip_address      TEXT,
      prev_hash       TEXT,
      row_hash        TEXT NOT NULL DEFAULT ''
    )`,
    // simulation_runs
    `CREATE TABLE IF NOT EXISTS simulation_runs (
      run_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scenario        TEXT NOT NULL,
      params          JSONB NOT NULL DEFAULT '{}',
      result_summary  JSONB,
      ran_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  ];

  for (const ddl of tables) {
    const tableName = (ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/) || [])[1];
    try {
      await pool.query(ddl);
      console.log(`  ✅ ${tableName}`);
    } catch (e) {
      console.error(`  ❌ ${tableName}: ${e.message}`);
    }
  }

  // Indexes
  console.log('📑 Creating indexes...');
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_shippers_peer ON shippers(peer_group_id)`,
    `CREATE INDEX IF NOT EXISTS idx_accounts_shipper ON accounts(shipper_id)`,
    `CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)`,
    `CREATE INDEX IF NOT EXISTS idx_shipments_account_time ON shipments(account_id, booked_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status)`,
    `CREATE INDEX IF NOT EXISTS idx_shipments_booked_at ON shipments(booked_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_fraud_signals_entity ON fraud_signals(entity_type, entity_id) WHERE is_active`,
    `CREATE INDEX IF NOT EXISTS idx_entity_links_src ON entity_links(src_type, src_id)`,
    `CREATE INDEX IF NOT EXISTS idx_entity_links_dst ON entity_links(dst_type, dst_id)`,
    `CREATE INDEX IF NOT EXISTS idx_risk_assessments_shipment ON risk_assessments(shipment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_risk_assessments_level ON risk_assessments(risk_level, assessed_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_decisions_shipment ON decisions(shipment_id, decided_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_fraud_cases_status ON fraud_cases(status, priority)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_shipment ON audit_log(shipment_id)`,
  ];
  for (const idx of indexes) {
    await pool.query(idx).catch(e => console.warn(`  idx warn: ${e.message.slice(0,80)}`));
  }

  console.log('✅ Migration complete!');
  await pool.end();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
