
BEGIN;



-- ---------------------------------------------------------------------

-- 0. EXTENSIONS & ENUMS

-- ---------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest(), gen_random_uuid()



CREATE TYPE account_status      AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED', 'UNDER_INVESTIGATION');

CREATE TYPE account_type        AS ENUM ('BUSINESS', 'INDIVIDUAL', 'ENTERPRISE');

CREATE TYPE user_role           AS ENUM ('OWNER', 'ADMIN', 'SHIPPER_USER');

CREATE TYPE payment_method_type AS ENUM ('CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'INVOICE', 'WALLET');

CREATE TYPE address_type        AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'FREIGHT_FORWARDER', 'RESHIPPER', 'DROP_OFF', 'PO_BOX', 'UNKNOWN');

CREATE TYPE service_type        AS ENUM ('GROUND', 'EXPRESS', 'EXPRESS_SAVER', 'FREIGHT', 'INTERNATIONAL');

CREATE TYPE shipment_status     AS ENUM ('BOOKED', 'SCREENING', 'ALLOWED', 'HELD', 'BLOCKED', 'RELEASED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

CREATE TYPE screening_stage     AS ENUM ('BOOKING', 'PICKUP', 'IN_TRANSIT');          -- supports re-scoring

CREATE TYPE account_event_type  AS ENUM ('LOGIN', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'EMAIL_CHANGE', 'PHONE_CHANGE',

                                         'PAYMENT_ADDED', 'USER_ADDED', 'PICKUP_ADDRESS_ADDED', 'PROFILE_UPDATE');

CREATE TYPE entity_type         AS ENUM ('SHIPPER', 'ACCOUNT', 'USER', 'DEVICE', 'PAYMENT', 'ADDRESS', 'IP', 'SHIPMENT');

CREATE TYPE signal_type         AS ENUM ('PRIOR_FRAUD', 'LINKED_TO_BLOCKED_ACCOUNT', 'DEVICE_REUSE', 'PAYMENT_FRAUD_HISTORY',

                                         'ADDRESS_RISK', 'VELOCITY', 'WATCHLIST', 'EXTERNAL_FEED');

CREATE TYPE link_type           AS ENUM ('USES_DEVICE', 'USES_PAYMENT', 'SHIPS_TO', 'SHIPS_FROM', 'USES_IP', 'HAS_USER', 'SHARES_CONTACT');

CREATE TYPE risk_level          AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE decision_action     AS ENUM ('ALLOW', 'ALLOW_MONITOR', 'VERIFY', 'REVIEW', 'BLOCK');

CREATE TYPE decided_by_type     AS ENUM ('SYSTEM', 'ANALYST', 'POLICY_OVERRIDE');

CREATE TYPE engine_mode         AS ENUM ('NORMAL', 'FAIL_OPEN', 'FAIL_CLOSED', 'DEGRADED');

CREATE TYPE verification_method AS ENUM ('OTP_SMS', 'OTP_EMAIL', 'AUTHORIZED_USER_CONFIRM', 'DOCUMENT_CHECK');

CREATE TYPE verification_status AS ENUM ('PENDING', 'PASSED', 'FAILED', 'EXPIRED');

CREATE TYPE staff_role          AS ENUM ('ANALYST', 'SENIOR_ANALYST', 'FRAUD_ADMIN', 'AUDITOR', 'READ_ONLY');

CREATE TYPE case_status         AS ENUM ('OPEN', 'IN_REVIEW', 'AWAITING_CUSTOMER', 'CLOSED');

CREATE TYPE case_priority       AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TYPE verdict_type        AS ENUM ('CONFIRMED_FRAUD', 'FALSE_POSITIVE', 'INCONCLUSIVE');

CREATE TYPE fraud_type          AS ENUM ('ACCOUNT_TAKEOVER', 'VOLUME_ATTACK', 'DESTINATION_ANOMALY', 'PAYMENT_MISMATCH',

                                         'FRAUD_RING', 'LOW_AND_SLOW', 'OTHER');

CREATE TYPE label_source        AS ENUM ('SYNTHETIC', 'ANALYST', 'POST_DELIVERY_ANALYSIS', 'CHARGEBACK');

CREATE TYPE rule_category       AS ENUM ('BEHAVIOR', 'IDENTITY', 'PAYMENT', 'ADDRESS', 'GRAPH', 'VELOCITY');

CREATE TYPE ring_status         AS ENUM ('SUSPECTED', 'CONFIRMED', 'DISMISSED');



-- Shared trigger: keep updated_at current

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$

BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;



-- Shared trigger: make a table append-only

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$

BEGIN

  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME;

END $$ LANGUAGE plpgsql;



-- ---------------------------------------------------------------------

-- 1. CORE ENTITIES

-- ---------------------------------------------------------------------



-- Hierarchy:  SHIPPER -> ACCOUNT -> (USERS, DEVICES, PAYMENTS) -> SHIPMENTS



CREATE TABLE peer_groups (                      -- used for cold start

    peer_group_id      SERIAL PRIMARY KEY,

    industry           TEXT NOT NULL,

    size_band          TEXT NOT NULL CHECK (size_band IN ('SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE')),

    region             TEXT NOT NULL,

    avg_daily_volume   NUMERIC(12,2),

    std_daily_volume   NUMERIC(12,2),

    avg_weight_kg      NUMERIC(10,2),

    std_weight_kg      NUMERIC(10,2),

    service_mix        JSONB NOT NULL DEFAULT '{}',   -- {"GROUND":0.8,"EXPRESS":0.2}

    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (industry, size_band, region)

);



CREATE TABLE shippers (

    shipper_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    external_ref       TEXT UNIQUE,                  -- customer id in the carrier's master data

    company_name       TEXT NOT NULL,

    industry           TEXT,

    size_band          TEXT CHECK (size_band IN ('SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE')),

    region             TEXT,

    country            CHAR(2) NOT NULL DEFAULT 'IN',

    peer_group_id      INT REFERENCES peer_groups(peer_group_id),

    -- false-positive control: trusted shipper list

    is_trusted         BOOLEAN NOT NULL DEFAULT FALSE,

    trusted_since      DATE,

    historical_fraud_count INT NOT NULL DEFAULT 0 CHECK (historical_fraud_count >= 0),

    is_synthetic       BOOLEAN NOT NULL DEFAULT FALSE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE TRIGGER trg_shippers_updated BEFORE UPDATE ON shippers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_shippers_peer_group ON shippers(peer_group_id);



CREATE TABLE accounts (

    account_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    shipper_id         UUID NOT NULL REFERENCES shippers(shipper_id),

    account_number     TEXT NOT NULL UNIQUE,

    account_type       account_type NOT NULL DEFAULT 'BUSINESS',

    status             account_status NOT NULL DEFAULT 'ACTIVE',

    home_region        TEXT,

    opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    last_profile_change_at TIMESTAMPTZ,              -- recent-change signal for takeover detection

    last_password_change_at TIMESTAMPTZ,

    is_synthetic       BOOLEAN NOT NULL DEFAULT FALSE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_accounts_shipper ON accounts(shipper_id);

CREATE INDEX idx_accounts_status  ON accounts(status);



CREATE TABLE account_users (                     -- authorized users on an account

    user_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id         UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,

    display_name       TEXT,

    email_hash         BYTEA NOT NULL,           -- sha256(lower(email)); raw email never stored

    phone_hash         BYTEA,

    email_masked       TEXT,                     -- e.g. a***@abc.com (for OTP display)

    phone_masked       TEXT,                     -- e.g. ******1234

    role               user_role NOT NULL DEFAULT 'SHIPPER_USER',

    is_active          BOOLEAN NOT NULL DEFAULT TRUE,

    added_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    removed_at         TIMESTAMPTZ

);

CREATE INDEX idx_account_users_account ON account_users(account_id);

CREATE INDEX idx_account_users_email   ON account_users(email_hash);   -- shared-contact graph links

CREATE INDEX idx_account_users_phone   ON account_users(phone_hash);



CREATE TABLE devices (

    device_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    fingerprint_hash   TEXT NOT NULL UNIQUE,

    device_type        TEXT,                     -- desktop, mobile, api-client

    os_family          TEXT,

    browser_family     TEXT,

    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    linked_account_count INT NOT NULL DEFAULT 0, -- denormalized for fast lookups

    is_flagged         BOOLEAN NOT NULL DEFAULT FALSE

);

CREATE INDEX idx_devices_flagged ON devices(is_flagged) WHERE is_flagged;



CREATE TABLE addresses (

    address_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    normalized_hash    TEXT NOT NULL UNIQUE,     -- hash of normalized address for de-duplication

    line1              TEXT,

    line2              TEXT,

    city               TEXT NOT NULL,

    state              TEXT,

    postal_code        TEXT,

    country            CHAR(2) NOT NULL,

    latitude           NUMERIC(9,6),

    longitude          NUMERIC(9,6),

    address_type       address_type NOT NULL DEFAULT 'UNKNOWN',

    confidence_score   SMALLINT CHECK (confidence_score BETWEEN 0 AND 100),  -- external address-confidence signal (mocked)

    is_high_risk       BOOLEAN NOT NULL DEFAULT FALSE,   -- known reshipper / drop address with fraud history

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE INDEX idx_addresses_city_country ON addresses(country, city);

CREATE INDEX idx_addresses_type_risk    ON addresses(address_type) WHERE is_high_risk;



CREATE TABLE payments (

    payment_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    payment_token      TEXT NOT NULL UNIQUE,     -- tokenized reference; no PAN stored

    method_type        payment_method_type NOT NULL,

    last4              CHAR(4),

    issuer_country     CHAR(2),

    billing_address_id UUID REFERENCES addresses(address_id),

    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    failed_attempt_count INT NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),

    is_flagged         BOOLEAN NOT NULL DEFAULT FALSE

);

CREATE INDEX idx_payments_flagged ON payments(is_flagged) WHERE is_flagged;



-- Many-to-many links, with usage history (enables "new payment / new device" signals)

CREATE TABLE account_devices (

    account_id         UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,

    device_id          UUID NOT NULL REFERENCES devices(device_id),

    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    login_count        INT NOT NULL DEFAULT 1,

    is_trusted         BOOLEAN NOT NULL DEFAULT FALSE,

    PRIMARY KEY (account_id, device_id)

);

CREATE INDEX idx_account_devices_device ON account_devices(device_id);



CREATE TABLE account_payments (

    account_id         UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,

    payment_id         UUID NOT NULL REFERENCES payments(payment_id),

    first_used_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    last_used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    usage_count        INT NOT NULL DEFAULT 0,

    is_primary         BOOLEAN NOT NULL DEFAULT FALSE,

    holder_name_matches BOOLEAN,                 -- payment/account mismatch indicator

    PRIMARY KEY (account_id, payment_id)

);

CREATE INDEX idx_account_payments_payment ON account_payments(payment_id);



-- ---------------------------------------------------------------------

-- 2. SHIPMENTS & ACCOUNT EVENTS

-- ---------------------------------------------------------------------



CREATE TABLE shipments (

    shipment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    booking_ref        TEXT NOT NULL UNIQUE,

    account_id         UUID NOT NULL REFERENCES accounts(account_id),

    shipper_id         UUID NOT NULL REFERENCES shippers(shipper_id),

    user_id            UUID REFERENCES account_users(user_id),

    device_id          UUID REFERENCES devices(device_id),

    payment_id         UUID REFERENCES payments(payment_id),

    origin_address_id  UUID NOT NULL REFERENCES addresses(address_id),

    dest_address_id    UUID NOT NULL REFERENCES addresses(address_id),

    service            service_type NOT NULL,

    weight_kg          NUMERIC(10,2) NOT NULL CHECK (weight_kg > 0),

    length_cm          NUMERIC(8,2),

    width_cm           NUMERIC(8,2),

    height_cm          NUMERIC(8,2),

    package_count      INT NOT NULL DEFAULT 1 CHECK (package_count > 0),

    declared_value     NUMERIC(12,2) CHECK (declared_value >= 0),

    shipping_cost      NUMERIC(12,2) CHECK (shipping_cost >= 0),   -- used for value-aware thresholds

    currency           CHAR(3) NOT NULL DEFAULT 'INR',

    ip_address         INET,

    ip_region          TEXT,

    session_login_at   TIMESTAMPTZ,              -- login-to-booking gap

    booked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    status             shipment_status NOT NULL DEFAULT 'BOOKED',

    is_synthetic       BOOLEAN NOT NULL DEFAULT FALSE,

    scenario_run_id    UUID,                     -- set when created by the simulator (FK added in section 9)

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE TRIGGER trg_shipments_updated BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_shipments_account_time ON shipments(account_id, booked_at DESC);   -- velocity & behavior features

CREATE INDEX idx_shipments_shipper_time ON shipments(shipper_id, booked_at DESC);

CREATE INDEX idx_shipments_device       ON shipments(device_id);

CREATE INDEX idx_shipments_payment      ON shipments(payment_id);

CREATE INDEX idx_shipments_dest         ON shipments(dest_address_id);

CREATE INDEX idx_shipments_status       ON shipments(status);

CREATE INDEX idx_shipments_booked_at    ON shipments(booked_at DESC);



CREATE TABLE account_events (                    -- change-point / "Why Now?" timeline

    event_id           BIGSERIAL PRIMARY KEY,

    account_id         UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,

    user_id            UUID REFERENCES account_users(user_id),

    device_id          UUID REFERENCES devices(device_id),

    event_type         account_event_type NOT NULL,

    ip_address         INET,

    geo_region         TEXT,

    metadata           JSONB NOT NULL DEFAULT '{}',

    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE INDEX idx_account_events_account_time ON account_events(account_id, occurred_at DESC);

CREATE INDEX idx_account_events_type         ON account_events(event_type, occurred_at DESC);



CREATE TABLE shipment_labels (                   -- ground truth for training and evaluation

    shipment_id        UUID PRIMARY KEY REFERENCES shipments(shipment_id) ON DELETE CASCADE,

    is_fraud           BOOLEAN NOT NULL,

    fraud_type         fraud_type,

    source             label_source NOT NULL,

    labeled_by         UUID,                     -- staff_id when source = ANALYST (FK added in section 7)

    labeled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (is_fraud OR fraud_type IS NULL)

);

CREATE INDEX idx_shipment_labels_fraud ON shipment_labels(is_fraud, fraud_type);



-- ---------------------------------------------------------------------

-- 3. BEHAVIORAL PROFILES ("SHIPPER DIGITAL TWIN")

-- ---------------------------------------------------------------------



CREATE TABLE shipper_profiles (

    account_id         UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,

    window_days        INT NOT NULL DEFAULT 90,

    history_days       INT NOT NULL DEFAULT 0,      -- low history => fall back to peer group

    total_shipments    INT NOT NULL DEFAULT 0,

    -- volume

    avg_daily_volume   NUMERIC(12,2),

    std_daily_volume   NUMERIC(12,2),

    max_daily_volume   INT,

    -- weight / value

    avg_weight_kg      NUMERIC(10,2),

    std_weight_kg      NUMERIC(10,2),

    avg_shipping_cost  NUMERIC(12,2),

    -- distributions

    common_origins     JSONB NOT NULL DEFAULT '[]',  -- [{"address_id":"..","share":0.9}]

    common_destinations JSONB NOT NULL DEFAULT '[]',

    service_mix        JSONB NOT NULL DEFAULT '{}',  -- {"GROUND":0.8,"EXPRESS":0.2}

    hour_histogram     INT[] NOT NULL DEFAULT ARRAY_FILL(0, ARRAY[24]),   -- bookings per hour of day

    known_seasonal_peaks JSONB NOT NULL DEFAULT '[]', -- [{"label":"Diwali","start":"..","end":".."}]

    peer_group_id      INT REFERENCES peer_groups(peer_group_id),

    profile_version    INT NOT NULL DEFAULT 1,

    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE INDEX idx_shipper_profiles_peer ON shipper_profiles(peer_group_id);



-- ---------------------------------------------------------------------

-- 4. FRAUD SIGNALS & FRAUD GRAPH

-- ---------------------------------------------------------------------



CREATE TABLE fraud_signals (                     -- signals from other fraud/security systems

    signal_id          BIGSERIAL PRIMARY KEY,

    entity_type        entity_type NOT NULL,

    entity_id          UUID NOT NULL,            -- polymorphic reference (no FK by design)

    signal_type        signal_type NOT NULL,

    severity           SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 10),

    confidence         NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),

    source             TEXT NOT NULL,            -- e.g. 'internal_graph', 'external_feed', 'analyst'

    description        TEXT,

    related_shipment_id UUID REFERENCES shipments(shipment_id),

    detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    expires_at         TIMESTAMPTZ,

    is_active          BOOLEAN NOT NULL DEFAULT TRUE

);

CREATE INDEX idx_fraud_signals_entity ON fraud_signals(entity_type, entity_id) WHERE is_active;

CREATE INDEX idx_fraud_signals_type   ON fraud_signals(signal_type, detected_at DESC);



CREATE TABLE entity_links (                      -- graph edges: account-device-payment-address-IP

    link_id            BIGSERIAL PRIMARY KEY,

    src_type           entity_type NOT NULL,

    src_id             UUID NOT NULL,

    dst_type           entity_type NOT NULL,

    dst_id             UUID NOT NULL,

    link_type          link_type NOT NULL,

    weight             INT NOT NULL DEFAULT 1,   -- number of observations

    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (src_type, src_id, dst_type, dst_id, link_type)

);

CREATE INDEX idx_entity_links_src ON entity_links(src_type, src_id);

CREATE INDEX idx_entity_links_dst ON entity_links(dst_type, dst_id);   -- "who else uses this device?"



CREATE TABLE fraud_rings (

    ring_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    status             ring_status NOT NULL DEFAULT 'SUSPECTED',

    ring_score         NUMERIC(5,2) CHECK (ring_score BETWEEN 0 AND 100),

    shared_entities    JSONB NOT NULL DEFAULT '{}',  -- {"devices":[..],"payments":[..],"addresses":[..]}

    notes              TEXT

);



CREATE TABLE fraud_ring_members (

    ring_id            UUID NOT NULL REFERENCES fraud_rings(ring_id) ON DELETE CASCADE,

    account_id         UUID NOT NULL REFERENCES accounts(account_id),

    PRIMARY KEY (ring_id, account_id)

);

CREATE INDEX idx_ring_members_account ON fraud_ring_members(account_id);



-- ---------------------------------------------------------------------

-- 5. RULES, MODELS, THRESHOLDS (versioned for auditability)

-- ---------------------------------------------------------------------



CREATE TABLE rule_sets (

    rule_set_id        SERIAL PRIMARY KEY,

    version            TEXT NOT NULL UNIQUE,     -- e.g. 'v4.3'

    description        TEXT,

    is_active          BOOLEAN NOT NULL DEFAULT FALSE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE UNIQUE INDEX uq_rule_sets_one_active ON rule_sets(is_active) WHERE is_active;



CREATE TABLE rules (

    rule_id            SERIAL PRIMARY KEY,

    rule_set_id        INT NOT NULL REFERENCES rule_sets(rule_set_id) ON DELETE CASCADE,

    code               TEXT NOT NULL,            -- e.g. 'NEW_DEVICE_HIGH_VOLUME'

    name               TEXT NOT NULL,

    category           rule_category NOT NULL,

    condition          JSONB NOT NULL,           -- declarative rule definition

    risk_points        SMALLINT NOT NULL CHECK (risk_points BETWEEN -50 AND 100),  -- negative = mitigating (e.g. trusted shipper)

    is_active          BOOLEAN NOT NULL DEFAULT TRUE,

    UNIQUE (rule_set_id, code)

);



CREATE TABLE model_versions (

    model_version_id   SERIAL PRIMARY KEY,

    name               TEXT NOT NULL,            -- 'xgboost_fraud', 'isolation_forest'

    version            TEXT NOT NULL,

    model_role         TEXT NOT NULL DEFAULT 'CHAMPION' CHECK (model_role IN ('CHAMPION', 'CHALLENGER', 'RETIRED')),

    training_data_note TEXT,                     -- e.g. 'synthetic shipments + IEEE-CIS methodology'

    metrics            JSONB NOT NULL DEFAULT '{}',   -- precision, recall, PR-AUC at training

    artifact_uri       TEXT,

    trained_at         TIMESTAMPTZ,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (name, version)

);



CREATE TABLE threshold_configs (

    config_id          SERIAL PRIMARY KEY,

    version            TEXT NOT NULL UNIQUE,

    allow_max          SMALLINT NOT NULL DEFAULT 30,    -- 0..30   ALLOW

    monitor_max        SMALLINT NOT NULL DEFAULT 50,    -- 30..50  ALLOW_MONITOR

    verify_max         SMALLINT NOT NULL DEFAULT 70,    -- 50..70  VERIFY (step-up)

    review_max         SMALLINT NOT NULL DEFAULT 85,    -- 70..85  REVIEW; above = BLOCK

    value_aware        BOOLEAN NOT NULL DEFAULT FALSE,  -- expected loss = P(fraud) x shipment cost

    fail_mode          engine_mode NOT NULL DEFAULT 'FAIL_OPEN',

    fail_closed_value_over NUMERIC(12,2),               -- fail closed above this shipment value

    target_latency_ms  INT NOT NULL DEFAULT 300,

    is_active          BOOLEAN NOT NULL DEFAULT FALSE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (allow_max < monitor_max AND monitor_max < verify_max AND verify_max < review_max AND review_max <= 100)

);

CREATE UNIQUE INDEX uq_threshold_one_active ON threshold_configs(is_active) WHERE is_active;



-- ---------------------------------------------------------------------

-- 6. RISK ASSESSMENT & DECISIONS (append-only)

-- ---------------------------------------------------------------------



CREATE TABLE risk_assessments (

    assessment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    shipment_id        UUID NOT NULL REFERENCES shipments(shipment_id),

    stage              screening_stage NOT NULL DEFAULT 'BOOKING',

    assessed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    latency_ms         INT,

    -- component scores (each 0-100)

    rule_score         NUMERIC(5,2),

    ml_score           NUMERIC(5,2),

    anomaly_score      NUMERIC(5,2),

    identity_score     NUMERIC(5,2),

    payment_score      NUMERIC(5,2),

    graph_score        NUMERIC(5,2),

    risk_score         NUMERIC(5,2) NOT NULL CHECK (risk_score BETWEEN 0 AND 100),

    fraud_probability  NUMERIC(5,4) CHECK (fraud_probability BETWEEN 0 AND 1),

    expected_loss      NUMERIC(12,2),             -- when value-aware thresholds are on

    risk_level         risk_level NOT NULL,

    -- reproducibility

    input_snapshot     JSONB NOT NULL,            -- exact request received from booking

    features           JSONB NOT NULL,            -- engineered features used

    used_peer_baseline BOOLEAN NOT NULL DEFAULT FALSE,   -- cold-start fallback used

    model_version_id   INT REFERENCES model_versions(model_version_id),

    rule_set_id        INT REFERENCES rule_sets(rule_set_id),

    config_id          INT REFERENCES threshold_configs(config_id),

    mode               engine_mode NOT NULL DEFAULT 'NORMAL'

);

CREATE INDEX idx_assessments_shipment ON risk_assessments(shipment_id, assessed_at DESC);

CREATE INDEX idx_assessments_level    ON risk_assessments(risk_level, assessed_at DESC);

CREATE INDEX idx_assessments_time     ON risk_assessments(assessed_at DESC);

CREATE TRIGGER trg_assessments_immutable BEFORE UPDATE OR DELETE ON risk_assessments

    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();



CREATE TABLE risk_reasons (                      -- structured reason codes (what the LLM explains from)

    reason_id          BIGSERIAL PRIMARY KEY,

    assessment_id      UUID NOT NULL REFERENCES risk_assessments(assessment_id),

    rank               SMALLINT NOT NULL,

    reason_code        TEXT NOT NULL,             -- e.g. 'VOLUME_8X_NORMAL'

    category           rule_category NOT NULL,

    rule_id            INT REFERENCES rules(rule_id),

    points             NUMERIC(5,2) NOT NULL,     -- contribution to risk score

    shap_value         NUMERIC(8,4),              -- ML contribution when applicable

    observed_value     TEXT,

    baseline_value     TEXT,

    description        TEXT NOT NULL,

    UNIQUE (assessment_id, rank)

);

CREATE INDEX idx_reasons_code ON risk_reasons(reason_code);

CREATE TRIGGER trg_reasons_immutable BEFORE UPDATE OR DELETE ON risk_reasons

    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();



CREATE TABLE genai_explanations (                -- LLM explains; it never decides

    explanation_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    assessment_id      UUID NOT NULL REFERENCES risk_assessments(assessment_id),

    llm_model          TEXT NOT NULL,

    prompt_hash        TEXT NOT NULL,

    summary_text       TEXT NOT NULL,

    recommended_actions JSONB NOT NULL DEFAULT '[]',

    grounded_reason_ids BIGINT[] NOT NULL DEFAULT '{}',    -- reasons the text was generated from

    similar_case_ids   UUID[] NOT NULL DEFAULT '{}',       -- RAG: past confirmed cases referenced

    generated_at       TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE INDEX idx_genai_assessment ON genai_explanations(assessment_id);



CREATE TABLE decisions (

    decision_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    shipment_id        UUID NOT NULL REFERENCES shipments(shipment_id),

    assessment_id      UUID REFERENCES risk_assessments(assessment_id),

    action             decision_action NOT NULL,

    decided_by_type    decided_by_type NOT NULL DEFAULT 'SYSTEM',

    decided_by_staff   UUID,                      -- FK added in section 7

    reason             TEXT,

    supersedes_id      UUID REFERENCES decisions(decision_id),  -- analyst override chain

    decided_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (decided_by_type = 'SYSTEM' OR decided_by_staff IS NOT NULL OR decided_by_type = 'POLICY_OVERRIDE')

);

CREATE INDEX idx_decisions_shipment ON decisions(shipment_id, decided_at DESC);

CREATE INDEX idx_decisions_action   ON decisions(action, decided_at DESC);

CREATE TRIGGER trg_decisions_immutable BEFORE UPDATE OR DELETE ON decisions

    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();



-- ---------------------------------------------------------------------

-- 7. VERIFICATION, CASES, ANALYST FEEDBACK

-- ---------------------------------------------------------------------



CREATE TABLE staff_users (                        -- fraud analysts, auditors, admins

    staff_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email              TEXT NOT NULL UNIQUE,

    full_name          TEXT NOT NULL,

    role               staff_role NOT NULL,

    is_active          BOOLEAN NOT NULL DEFAULT TRUE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);



ALTER TABLE decisions        ADD CONSTRAINT fk_decisions_staff FOREIGN KEY (decided_by_staff) REFERENCES staff_users(staff_id);

ALTER TABLE shipment_labels  ADD CONSTRAINT fk_labels_staff    FOREIGN KEY (labeled_by)       REFERENCES staff_users(staff_id);



CREATE TABLE verification_challenges (            -- step-up verification (OTP to registered contact)

    challenge_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    shipment_id        UUID NOT NULL REFERENCES shipments(shipment_id),

    account_id         UUID NOT NULL REFERENCES accounts(account_id),

    assessment_id      UUID REFERENCES risk_assessments(assessment_id),

    method             verification_method NOT NULL,

    sent_to_user_id    UUID REFERENCES account_users(user_id),   -- always a REGISTERED contact, never a booking-supplied one

    sent_to_masked     TEXT,

    code_hash          TEXT,

    status             verification_status NOT NULL DEFAULT 'PENDING',

    attempts           SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),

    sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    expires_at         TIMESTAMPTZ NOT NULL,

    completed_at       TIMESTAMPTZ

);

CREATE INDEX idx_verification_shipment ON verification_challenges(shipment_id);

CREATE INDEX idx_verification_pending  ON verification_challenges(expires_at) WHERE status = 'PENDING';



CREATE TABLE fraud_cases (

    case_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    shipment_id        UUID NOT NULL REFERENCES shipments(shipment_id),

    assessment_id      UUID NOT NULL REFERENCES risk_assessments(assessment_id),

    account_id         UUID NOT NULL REFERENCES accounts(account_id),

    assigned_to        UUID REFERENCES staff_users(staff_id),

    status             case_status NOT NULL DEFAULT 'OPEN',

    priority           case_priority NOT NULL DEFAULT 'NORMAL',

    opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    sla_due_at         TIMESTAMPTZ,

    closed_at          TIMESTAMPTZ,

    verdict            verdict_type,

    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE TRIGGER trg_cases_updated BEFORE UPDATE ON fraud_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_cases_queue   ON fraud_cases(status, priority, opened_at) WHERE status <> 'CLOSED';

CREATE INDEX idx_cases_account ON fraud_cases(account_id);



CREATE TABLE analyst_feedback (                   -- closed learning loop

    feedback_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    case_id            UUID NOT NULL REFERENCES fraud_cases(case_id),

    shipment_id        UUID NOT NULL REFERENCES shipments(shipment_id),

    analyst_id         UUID NOT NULL REFERENCES staff_users(staff_id),

    predicted_level    risk_level NOT NULL,

    verdict            verdict_type NOT NULL,

    fraud_type         fraud_type,

    override_action    decision_action,

    notes              TEXT,

    used_for_training  BOOLEAN NOT NULL DEFAULT FALSE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE INDEX idx_feedback_case     ON analyst_feedback(case_id);

CREATE INDEX idx_feedback_training ON analyst_feedback(used_for_training) WHERE NOT used_for_training;



-- ---------------------------------------------------------------------

-- 8. AUDIT LOG (append-only, hash-chained for tamper evidence)

-- ---------------------------------------------------------------------



CREATE TABLE audit_log (

    audit_id           BIGSERIAL PRIMARY KEY,

    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    actor_type         TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'STAFF', 'CUSTOMER', 'LLM')),

    actor_id           UUID,

    action             TEXT NOT NULL,             -- 'SCREENED', 'DECISION_MADE', 'OVERRIDE', 'CASE_CLOSED', 'DATA_VIEWED'

    entity_type        TEXT NOT NULL,

    entity_id          UUID,

    shipment_id        UUID,

    before_state       JSONB,

    after_state        JSONB,

    ip_address         INET,

    prev_hash          TEXT,

    row_hash           TEXT NOT NULL DEFAULT ''

);

CREATE INDEX idx_audit_shipment ON audit_log(shipment_id, occurred_at);

CREATE INDEX idx_audit_entity   ON audit_log(entity_type, entity_id);

CREATE INDEX idx_audit_actor    ON audit_log(actor_type, actor_id, occurred_at DESC);



CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger AS $$

DECLARE prev TEXT;

BEGIN

  PERFORM pg_advisory_xact_lock(727001);          -- serialize chain writes

  SELECT row_hash INTO prev FROM audit_log ORDER BY audit_id DESC LIMIT 1;

  NEW.prev_hash := prev;

  NEW.row_hash := encode(digest(

      coalesce(prev, '') || NEW.occurred_at::text || NEW.actor_type || coalesce(NEW.actor_id::text, '')

      || NEW.action || NEW.entity_type || coalesce(NEW.entity_id::text, '')

      || coalesce(NEW.after_state::text, ''), 'sha256'), 'hex');

  RETURN NEW;

END $$ LANGUAGE plpgsql;



CREATE TRIGGER trg_audit_chain     BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();



-- ---------------------------------------------------------------------

-- 9. SIMULATOR & METRICS

-- ---------------------------------------------------------------------



CREATE TABLE simulation_runs (

    run_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    scenario           TEXT NOT NULL CHECK (scenario IN

                         ('ACCOUNT_TAKEOVER', 'PAYMENT_FRAUD', 'VOLUME_SPIKE', 'DESTINATION_ANOMALY',

                          'FRAUD_RING', 'LOW_AND_SLOW', 'SEASONAL_LEGIT_SPIKE', 'MIXED')),

    config_id          INT REFERENCES threshold_configs(config_id),

    model_version_id   INT REFERENCES model_versions(model_version_id),

    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    finished_at        TIMESTAMPTZ,

    total_shipments    INT,

    fraud_shipments    INT,

    true_positives     INT,

    false_positives    INT,

    true_negatives     INT,

    false_negatives    INT,

    precision_score    NUMERIC(5,4),

    recall_score       NUMERIC(5,4),

    f1_score           NUMERIC(5,4),

    false_positive_rate NUMERIC(5,4),

    loss_prevented     NUMERIC(14,2)

);



ALTER TABLE shipments ADD CONSTRAINT fk_shipments_sim_run

    FOREIGN KEY (scenario_run_id) REFERENCES simulation_runs(run_id);



-- ---------------------------------------------------------------------

-- 10. DASHBOARD VIEWS

-- ---------------------------------------------------------------------



-- Latest decision per shipment (an analyst override supersedes the system decision)

CREATE VIEW v_latest_decision AS

SELECT DISTINCT ON (shipment_id) *

FROM decisions

ORDER BY shipment_id, decided_at DESC;



CREATE VIEW v_dashboard_daily AS

SELECT date_trunc('day', ra.assessed_at)                                         AS day,

       count(*)                                                                   AS screened,

       count(*) FILTER (WHERE ra.risk_level IN ('HIGH', 'CRITICAL'))              AS flagged,

       count(*) FILTER (WHERE d.action = 'VERIFY')                                AS step_up_verification,

       count(*) FILTER (WHERE d.action = 'REVIEW')                                AS held_for_review,

       count(*) FILTER (WHERE d.action = 'BLOCK')                                 AS blocked,

       round(avg(ra.latency_ms))                                                  AS avg_latency_ms,

       coalesce(sum(s.shipping_cost) FILTER (WHERE d.action = 'BLOCK' AND sl.is_fraud), 0) AS loss_prevented,

       count(*) FILTER (WHERE d.action IN ('BLOCK', 'REVIEW') AND sl.is_fraud = FALSE)     AS false_positives

FROM risk_assessments ra

JOIN shipments s             ON s.shipment_id = ra.shipment_id

LEFT JOIN v_latest_decision d ON d.shipment_id = ra.shipment_id

LEFT JOIN shipment_labels sl  ON sl.shipment_id = ra.shipment_id

WHERE ra.stage = 'BOOKING'

GROUP BY 1;



CREATE VIEW v_review_queue AS

SELECT c.case_id, c.priority, c.status, c.opened_at, c.sla_due_at,

       s.booking_ref, a.account_number, ra.risk_score, ra.risk_level

FROM fraud_cases c

JOIN shipments s         ON s.shipment_id   = c.shipment_id

JOIN accounts a          ON a.account_id    = c.account_id

JOIN risk_assessments ra ON ra.assessment_id = c.assessment_id

WHERE c.status <> 'CLOSED';



COMMIT; 

