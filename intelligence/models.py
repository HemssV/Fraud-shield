"""
FraudShield Django models — maps to the existing PostgreSQL schema.
Backend Person B only READS/WRITES to these; it does NOT redefine the schema
(the schema is authoritative from the SQL DDL).

All models use managed=False where the table is owned by the DDL script, except
for tables that Person B may need to create via migrations in a dev/test setup.

For the hackathon we set managed=True on all models so that Django migrations
can bootstrap a SQLite dev database without a real PostgreSQL instance.
"""
import uuid
from django.db import models


# ─────────────────────────────────────────────────────────────────────────────
# Enums (as TextChoices to stay in sync with PostgreSQL ENUMs)
# ─────────────────────────────────────────────────────────────────────────────

class RiskLevel(models.TextChoices):
    LOW      = 'LOW'
    MEDIUM   = 'MEDIUM'
    HIGH     = 'HIGH'
    CRITICAL = 'CRITICAL'


class DecisionAction(models.TextChoices):
    ALLOW         = 'ALLOW'
    ALLOW_MONITOR = 'ALLOW_MONITOR'
    VERIFY        = 'VERIFY'
    REVIEW        = 'REVIEW'
    BLOCK         = 'BLOCK'


class DecidedByType(models.TextChoices):
    SYSTEM          = 'SYSTEM'
    ANALYST         = 'ANALYST'
    POLICY_OVERRIDE = 'POLICY_OVERRIDE'


class CaseStatus(models.TextChoices):
    OPEN              = 'OPEN'
    IN_REVIEW         = 'IN_REVIEW'
    AWAITING_CUSTOMER = 'AWAITING_CUSTOMER'
    CLOSED            = 'CLOSED'


class CasePriority(models.TextChoices):
    LOW    = 'LOW'
    NORMAL = 'NORMAL'
    HIGH   = 'HIGH'
    URGENT = 'URGENT'


class VerdictType(models.TextChoices):
    CONFIRMED_FRAUD = 'CONFIRMED_FRAUD'
    FALSE_POSITIVE  = 'FALSE_POSITIVE'
    INCONCLUSIVE    = 'INCONCLUSIVE'


class FraudType(models.TextChoices):
    ACCOUNT_TAKEOVER    = 'ACCOUNT_TAKEOVER'
    VOLUME_ATTACK       = 'VOLUME_ATTACK'
    DESTINATION_ANOMALY = 'DESTINATION_ANOMALY'
    PAYMENT_MISMATCH    = 'PAYMENT_MISMATCH'
    FRAUD_RING          = 'FRAUD_RING'
    LOW_AND_SLOW        = 'LOW_AND_SLOW'
    OTHER               = 'OTHER'


class RingStatus(models.TextChoices):
    SUSPECTED = 'SUSPECTED'
    CONFIRMED = 'CONFIRMED'
    DISMISSED = 'DISMISSED'


class EntityType(models.TextChoices):
    SHIPPER  = 'SHIPPER'
    ACCOUNT  = 'ACCOUNT'
    USER     = 'USER'
    DEVICE   = 'DEVICE'
    PAYMENT  = 'PAYMENT'
    ADDRESS  = 'ADDRESS'
    IP       = 'IP'
    SHIPMENT = 'SHIPMENT'


class SignalType(models.TextChoices):
    PRIOR_FRAUD               = 'PRIOR_FRAUD'
    LINKED_TO_BLOCKED_ACCOUNT = 'LINKED_TO_BLOCKED_ACCOUNT'
    DEVICE_REUSE              = 'DEVICE_REUSE'
    PAYMENT_FRAUD_HISTORY     = 'PAYMENT_FRAUD_HISTORY'
    ADDRESS_RISK              = 'ADDRESS_RISK'
    VELOCITY                  = 'VELOCITY'
    WATCHLIST                 = 'WATCHLIST'
    EXTERNAL_FEED             = 'EXTERNAL_FEED'


class LinkType(models.TextChoices):
    USES_DEVICE    = 'USES_DEVICE'
    USES_PAYMENT   = 'USES_PAYMENT'
    SHIPS_TO       = 'SHIPS_TO'
    SHIPS_FROM     = 'SHIPS_FROM'
    USES_IP        = 'USES_IP'
    HAS_USER       = 'HAS_USER'
    SHARES_CONTACT = 'SHARES_CONTACT'


class ScreeningStage(models.TextChoices):
    BOOKING   = 'BOOKING'
    PICKUP    = 'PICKUP'
    IN_TRANSIT = 'IN_TRANSIT'


class RuleCategory(models.TextChoices):
    BEHAVIOR = 'BEHAVIOR'
    IDENTITY = 'IDENTITY'
    PAYMENT  = 'PAYMENT'
    ADDRESS  = 'ADDRESS'
    GRAPH    = 'GRAPH'
    VELOCITY = 'VELOCITY'


class StaffRole(models.TextChoices):
    ANALYST        = 'ANALYST'
    SENIOR_ANALYST = 'SENIOR_ANALYST'
    FRAUD_ADMIN    = 'FRAUD_ADMIN'
    AUDITOR        = 'AUDITOR'
    READ_ONLY      = 'READ_ONLY'


class EngineMode(models.TextChoices):
    NORMAL      = 'NORMAL'
    FAIL_OPEN   = 'FAIL_OPEN'
    FAIL_CLOSED = 'FAIL_CLOSED'
    DEGRADED    = 'DEGRADED'


class ShipmentStatus(models.TextChoices):
    BOOKED     = 'BOOKED'
    SCREENING  = 'SCREENING'
    ALLOWED    = 'ALLOWED'
    HELD       = 'HELD'
    BLOCKED    = 'BLOCKED'
    RELEASED   = 'RELEASED'
    PICKED_UP  = 'PICKED_UP'
    IN_TRANSIT = 'IN_TRANSIT'
    DELIVERED  = 'DELIVERED'
    CANCELLED  = 'CANCELLED'


class ServiceType(models.TextChoices):
    GROUND        = 'GROUND'
    EXPRESS       = 'EXPRESS'
    EXPRESS_SAVER = 'EXPRESS_SAVER'
    FREIGHT       = 'FREIGHT'
    INTERNATIONAL = 'INTERNATIONAL'


class SimScenario(models.TextChoices):
    NORMAL              = 'NORMAL'
    ACCOUNT_TAKEOVER    = 'ACCOUNT_TAKEOVER'
    PAYMENT_FRAUD       = 'PAYMENT_FRAUD'
    VOLUME_SPIKE        = 'VOLUME_SPIKE'
    DESTINATION_ANOMALY = 'DESTINATION_ANOMALY'
    FRAUD_RING          = 'FRAUD_RING'
    LOW_AND_SLOW        = 'LOW_AND_SLOW'
    SEASONAL_LEGIT_SPIKE = 'SEASONAL_LEGIT_SPIKE'
    MIXED               = 'MIXED'


# ─────────────────────────────────────────────────────────────────────────────
# 1. Core entity models (read-only for Person B; Person A owns writes)
# ─────────────────────────────────────────────────────────────────────────────

class PeerGroup(models.Model):
    peer_group_id   = models.AutoField(primary_key=True)
    industry        = models.TextField()
    size_band       = models.CharField(max_length=20)
    region          = models.TextField()
    avg_daily_volume = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    std_daily_volume = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    avg_weight_kg   = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    std_weight_kg   = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    service_mix     = models.JSONField(default=dict)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'peer_groups'

    def __str__(self):
        return f"{self.industry}/{self.size_band}/{self.region}"


class Shipper(models.Model):
    shipper_id     = models.UUIDField(primary_key=True, default=uuid.uuid4)
    external_ref   = models.TextField(unique=True, null=True, blank=True)
    company_name   = models.TextField()
    industry       = models.TextField(null=True, blank=True)
    size_band      = models.CharField(max_length=20, null=True, blank=True)
    region         = models.TextField(null=True, blank=True)
    country        = models.CharField(max_length=2, default='IN')
    peer_group     = models.ForeignKey(PeerGroup, null=True, blank=True, on_delete=models.SET_NULL)
    is_trusted     = models.BooleanField(default=False)
    trusted_since  = models.DateField(null=True, blank=True)
    historical_fraud_count = models.IntegerField(default=0)
    is_synthetic   = models.BooleanField(default=False)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'shippers'

    def __str__(self):
        return self.company_name


class Account(models.Model):
    account_id     = models.UUIDField(primary_key=True, default=uuid.uuid4)
    shipper        = models.ForeignKey(Shipper, on_delete=models.PROTECT, related_name='accounts')
    account_number = models.TextField(unique=True)
    account_type   = models.CharField(max_length=20, default='BUSINESS')
    status         = models.CharField(max_length=30, default='ACTIVE')
    home_region    = models.TextField(null=True, blank=True)
    opened_at      = models.DateTimeField(auto_now_add=True)
    last_profile_change_at  = models.DateTimeField(null=True, blank=True)
    last_password_change_at = models.DateTimeField(null=True, blank=True)
    is_synthetic   = models.BooleanField(default=False)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'accounts'

    def __str__(self):
        return self.account_number


class Device(models.Model):
    device_id          = models.UUIDField(primary_key=True, default=uuid.uuid4)
    fingerprint_hash   = models.TextField(unique=True)
    device_type        = models.TextField(null=True, blank=True)
    os_family          = models.TextField(null=True, blank=True)
    browser_family     = models.TextField(null=True, blank=True)
    first_seen_at      = models.DateTimeField(auto_now_add=True)
    last_seen_at       = models.DateTimeField(auto_now=True)
    linked_account_count = models.IntegerField(default=0)
    is_flagged         = models.BooleanField(default=False)

    class Meta:
        db_table = 'devices'

    def __str__(self):
        return str(self.device_id)


class Address(models.Model):
    address_id      = models.UUIDField(primary_key=True, default=uuid.uuid4)
    normalized_hash = models.TextField(unique=True)
    line1           = models.TextField(null=True, blank=True)
    line2           = models.TextField(null=True, blank=True)
    city            = models.TextField()
    state           = models.TextField(null=True, blank=True)
    postal_code     = models.TextField(null=True, blank=True)
    country         = models.CharField(max_length=2)
    latitude        = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude       = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    address_type    = models.CharField(max_length=30, default='UNKNOWN')
    confidence_score = models.SmallIntegerField(null=True, blank=True)
    is_high_risk    = models.BooleanField(default=False)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'addresses'

    def __str__(self):
        return f"{self.city}, {self.country}"


class Payment(models.Model):
    payment_id      = models.UUIDField(primary_key=True, default=uuid.uuid4)
    payment_token   = models.TextField(unique=True)
    method_type     = models.CharField(max_length=30)
    last4           = models.CharField(max_length=4, null=True, blank=True)
    issuer_country  = models.CharField(max_length=2, null=True, blank=True)
    billing_address = models.ForeignKey(Address, null=True, blank=True, on_delete=models.SET_NULL)
    first_seen_at   = models.DateTimeField(auto_now_add=True)
    failed_attempt_count = models.IntegerField(default=0)
    is_flagged      = models.BooleanField(default=False)

    class Meta:
        db_table = 'payments'

    def __str__(self):
        return f"{self.method_type} ****{self.last4}"


class AccountUser(models.Model):
    user_id      = models.UUIDField(primary_key=True, default=uuid.uuid4)
    account      = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='users')
    display_name = models.TextField(null=True, blank=True)
    email_hash   = models.BinaryField()
    phone_hash   = models.BinaryField(null=True, blank=True)
    email_masked = models.TextField(null=True, blank=True)
    phone_masked = models.TextField(null=True, blank=True)
    role         = models.CharField(max_length=20, default='SHIPPER_USER')
    is_active    = models.BooleanField(default=True)
    added_at     = models.DateTimeField(auto_now_add=True)
    removed_at   = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'account_users'

    def __str__(self):
        return str(self.user_id)


class AccountDevice(models.Model):
    account      = models.ForeignKey(Account, on_delete=models.CASCADE)
    device       = models.ForeignKey(Device, on_delete=models.PROTECT)
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at  = models.DateTimeField(auto_now=True)
    login_count  = models.IntegerField(default=1)
    is_trusted   = models.BooleanField(default=False)

    class Meta:
        db_table = 'account_devices'
        unique_together = [('account', 'device')]

    def __str__(self):
        return f"{self.account_id} — {self.device_id}"


class AccountPayment(models.Model):
    account        = models.ForeignKey(Account, on_delete=models.CASCADE)
    payment        = models.ForeignKey(Payment, on_delete=models.PROTECT)
    first_used_at  = models.DateTimeField(auto_now_add=True)
    last_used_at   = models.DateTimeField(auto_now=True)
    usage_count    = models.IntegerField(default=0)
    is_primary     = models.BooleanField(default=False)
    holder_name_matches = models.BooleanField(null=True, blank=True)

    class Meta:
        db_table = 'account_payments'
        unique_together = [('account', 'payment')]


# ─────────────────────────────────────────────────────────────────────────────
# 2. Shipments
# ─────────────────────────────────────────────────────────────────────────────

class Shipment(models.Model):
    shipment_id      = models.UUIDField(primary_key=True, default=uuid.uuid4)
    booking_ref      = models.TextField(unique=True)
    account          = models.ForeignKey(Account, on_delete=models.PROTECT, related_name='shipments')
    shipper          = models.ForeignKey(Shipper, on_delete=models.PROTECT)
    user             = models.ForeignKey(AccountUser, null=True, blank=True, on_delete=models.SET_NULL)
    device           = models.ForeignKey(Device, null=True, blank=True, on_delete=models.SET_NULL)
    payment          = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.SET_NULL)
    origin_address   = models.ForeignKey(Address, on_delete=models.PROTECT, related_name='origin_shipments')
    dest_address     = models.ForeignKey(Address, on_delete=models.PROTECT, related_name='dest_shipments')
    service          = models.CharField(max_length=30, choices=ServiceType.choices)
    weight_kg        = models.DecimalField(max_digits=10, decimal_places=2)
    length_cm        = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    width_cm         = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    height_cm        = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    package_count    = models.IntegerField(default=1)
    declared_value   = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    shipping_cost    = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency         = models.CharField(max_length=3, default='INR')
    ip_address       = models.GenericIPAddressField(null=True, blank=True)
    ip_region        = models.TextField(null=True, blank=True)
    session_login_at = models.DateTimeField(null=True, blank=True)
    booked_at        = models.DateTimeField(auto_now_add=True)
    status           = models.CharField(max_length=30, choices=ShipmentStatus.choices, default=ShipmentStatus.BOOKED)
    is_synthetic     = models.BooleanField(default=False)
    scenario_run     = models.ForeignKey('SimulationRun', null=True, blank=True, on_delete=models.SET_NULL)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'shipments'

    def __str__(self):
        return self.booking_ref


# ─────────────────────────────────────────────────────────────────────────────
# 3. Behavioral profiles
# ─────────────────────────────────────────────────────────────────────────────

class ShipperProfile(models.Model):
    account         = models.OneToOneField(Account, primary_key=True, on_delete=models.CASCADE)
    window_days     = models.IntegerField(default=90)
    history_days    = models.IntegerField(default=0)
    total_shipments = models.IntegerField(default=0)
    avg_daily_volume = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    std_daily_volume = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    max_daily_volume = models.IntegerField(null=True, blank=True)
    avg_weight_kg    = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    std_weight_kg    = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    avg_shipping_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    common_origins      = models.JSONField(default=list)
    common_destinations = models.JSONField(default=list)
    service_mix         = models.JSONField(default=dict)
    hour_histogram      = models.JSONField(default=list)
    known_seasonal_peaks = models.JSONField(default=list)
    peer_group      = models.ForeignKey(PeerGroup, null=True, blank=True, on_delete=models.SET_NULL)
    profile_version = models.IntegerField(default=1)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'shipper_profiles'

    def __str__(self):
        return f"Profile({self.account_id})"


# ─────────────────────────────────────────────────────────────────────────────
# 4. Fraud signals & graph
# ─────────────────────────────────────────────────────────────────────────────

class FraudSignal(models.Model):
    signal_id          = models.BigAutoField(primary_key=True)
    entity_type        = models.CharField(max_length=20, choices=EntityType.choices)
    entity_id          = models.UUIDField()
    signal_type        = models.CharField(max_length=40, choices=SignalType.choices)
    severity           = models.SmallIntegerField()
    confidence         = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)
    source             = models.TextField()
    description        = models.TextField(null=True, blank=True)
    related_shipment   = models.ForeignKey(Shipment, null=True, blank=True, on_delete=models.SET_NULL)
    detected_at        = models.DateTimeField(auto_now_add=True)
    expires_at         = models.DateTimeField(null=True, blank=True)
    is_active          = models.BooleanField(default=True)

    class Meta:
        db_table = 'fraud_signals'

    def __str__(self):
        return f"{self.signal_type}@{self.entity_type}:{self.entity_id}"


class EntityLink(models.Model):
    link_id      = models.BigAutoField(primary_key=True)
    src_type     = models.CharField(max_length=20, choices=EntityType.choices)
    src_id       = models.UUIDField()
    dst_type     = models.CharField(max_length=20, choices=EntityType.choices)
    dst_id       = models.UUIDField()
    link_type    = models.CharField(max_length=30, choices=LinkType.choices)
    weight       = models.IntegerField(default=1)
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'entity_links'
        unique_together = [('src_type', 'src_id', 'dst_type', 'dst_id', 'link_type')]

    def __str__(self):
        return f"{self.src_type}:{self.src_id} --[{self.link_type}]--> {self.dst_type}:{self.dst_id}"


class FraudRing(models.Model):
    ring_id         = models.UUIDField(primary_key=True, default=uuid.uuid4)
    detected_at     = models.DateTimeField(auto_now_add=True)
    status          = models.CharField(max_length=20, choices=RingStatus.choices, default=RingStatus.SUSPECTED)
    ring_score      = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    shared_entities = models.JSONField(default=dict)
    notes           = models.TextField(null=True, blank=True)

    class Meta:
        db_table = 'fraud_rings'

    def __str__(self):
        return f"Ring({self.ring_id}) — {self.status}"


class FraudRingMember(models.Model):
    ring    = models.ForeignKey(FraudRing, on_delete=models.CASCADE, related_name='members')
    account = models.ForeignKey(Account, on_delete=models.PROTECT)

    class Meta:
        db_table = 'fraud_ring_members'
        unique_together = [('ring', 'account')]

    def __str__(self):
        return f"Ring({self.ring_id}) — Account({self.account_id})"


# ─────────────────────────────────────────────────────────────────────────────
# 5. Rules, models, thresholds (versioned)
# ─────────────────────────────────────────────────────────────────────────────

class RuleSet(models.Model):
    rule_set_id = models.AutoField(primary_key=True)
    version     = models.TextField(unique=True)
    description = models.TextField(null=True, blank=True)
    is_active   = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'rule_sets'

    def __str__(self):
        return f"RuleSet {self.version}"


class Rule(models.Model):
    rule_id    = models.AutoField(primary_key=True)
    rule_set   = models.ForeignKey(RuleSet, on_delete=models.CASCADE, related_name='rules')
    code       = models.TextField()
    name       = models.TextField()
    category   = models.CharField(max_length=20, choices=RuleCategory.choices)
    condition  = models.JSONField()
    risk_points = models.SmallIntegerField()
    is_active  = models.BooleanField(default=True)

    class Meta:
        db_table = 'rules'
        unique_together = [('rule_set', 'code')]

    def __str__(self):
        return f"[{self.code}] {self.name}"


class ModelVersion(models.Model):
    model_version_id = models.AutoField(primary_key=True)
    name             = models.TextField()
    version          = models.TextField()
    model_role       = models.TextField(default='CHAMPION')
    training_data_note = models.TextField(null=True, blank=True)
    metrics          = models.JSONField(default=dict)
    artifact_uri     = models.TextField(null=True, blank=True)
    trained_at       = models.DateTimeField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'model_versions'
        unique_together = [('name', 'version')]

    def __str__(self):
        return f"{self.name} {self.version} ({self.model_role})"


class ThresholdConfig(models.Model):
    config_id    = models.AutoField(primary_key=True)
    version      = models.TextField(unique=True)
    allow_max    = models.SmallIntegerField(default=30)
    monitor_max  = models.SmallIntegerField(default=50)
    verify_max   = models.SmallIntegerField(default=70)
    review_max   = models.SmallIntegerField(default=85)
    value_aware  = models.BooleanField(default=False)
    fail_mode    = models.CharField(max_length=20, choices=EngineMode.choices, default=EngineMode.FAIL_OPEN)
    fail_closed_value_over = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    target_latency_ms = models.IntegerField(default=300)
    is_active    = models.BooleanField(default=False)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'threshold_configs'

    def __str__(self):
        return f"ThresholdConfig {self.version}"


# ─────────────────────────────────────────────────────────────────────────────
# 6. Risk assessments & decisions (append-only in prod)
# ─────────────────────────────────────────────────────────────────────────────

class RiskAssessment(models.Model):
    assessment_id   = models.UUIDField(primary_key=True, default=uuid.uuid4)
    shipment        = models.ForeignKey(Shipment, on_delete=models.PROTECT, related_name='assessments')
    stage           = models.CharField(max_length=20, choices=ScreeningStage.choices, default=ScreeningStage.BOOKING)
    assessed_at     = models.DateTimeField(auto_now_add=True)
    latency_ms      = models.IntegerField(null=True, blank=True)
    rule_score      = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    ml_score        = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    anomaly_score   = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    identity_score  = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    payment_score   = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    graph_score     = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    risk_score      = models.DecimalField(max_digits=5, decimal_places=2)
    fraud_probability = models.DecimalField(max_digits=5, decimal_places=4, null=True, blank=True)
    expected_loss   = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    risk_level      = models.CharField(max_length=10, choices=RiskLevel.choices)
    input_snapshot  = models.JSONField(default=dict)
    features        = models.JSONField(default=dict)
    used_peer_baseline = models.BooleanField(default=False)
    model_version   = models.ForeignKey(ModelVersion, null=True, blank=True, on_delete=models.SET_NULL)
    rule_set        = models.ForeignKey(RuleSet, null=True, blank=True, on_delete=models.SET_NULL)
    config          = models.ForeignKey(ThresholdConfig, null=True, blank=True, on_delete=models.SET_NULL)
    mode            = models.CharField(max_length=20, choices=EngineMode.choices, default=EngineMode.NORMAL)

    class Meta:
        db_table = 'risk_assessments'

    def __str__(self):
        return f"RA({self.assessment_id}) ship={self.shipment_id} score={self.risk_score}"


class RiskReason(models.Model):
    reason_id    = models.BigAutoField(primary_key=True)
    assessment   = models.ForeignKey(RiskAssessment, on_delete=models.PROTECT, related_name='reasons')
    rank         = models.SmallIntegerField()
    reason_code  = models.TextField()
    category     = models.CharField(max_length=20, choices=RuleCategory.choices)
    rule         = models.ForeignKey(Rule, null=True, blank=True, on_delete=models.SET_NULL)
    points       = models.DecimalField(max_digits=5, decimal_places=2)
    shap_value   = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    observed_value = models.TextField(null=True, blank=True)
    baseline_value = models.TextField(null=True, blank=True)
    description  = models.TextField()

    class Meta:
        db_table = 'risk_reasons'
        unique_together = [('assessment', 'rank')]

    def __str__(self):
        return f"[{self.reason_code}] {self.description}"


class GenAIExplanation(models.Model):
    explanation_id     = models.UUIDField(primary_key=True, default=uuid.uuid4)
    assessment         = models.ForeignKey(RiskAssessment, on_delete=models.PROTECT, related_name='explanations')
    llm_model          = models.TextField()
    prompt_hash        = models.TextField()
    summary_text       = models.TextField()
    recommended_actions = models.JSONField(default=list)
    grounded_reason_ids = models.JSONField(default=list)   # bigint[]
    similar_case_ids   = models.JSONField(default=list)    # uuid[]
    generated_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'genai_explanations'

    def __str__(self):
        return f"Explanation({self.explanation_id})"


class Decision(models.Model):
    decision_id     = models.UUIDField(primary_key=True, default=uuid.uuid4)
    shipment        = models.ForeignKey(Shipment, on_delete=models.PROTECT, related_name='decisions')
    assessment      = models.ForeignKey(RiskAssessment, null=True, blank=True, on_delete=models.SET_NULL)
    action          = models.CharField(max_length=20, choices=DecisionAction.choices)
    decided_by_type = models.CharField(max_length=20, choices=DecidedByType.choices, default=DecidedByType.SYSTEM)
    decided_by_staff = models.ForeignKey(
        'StaffUser', null=True, blank=True, on_delete=models.SET_NULL, related_name='decisions'
    )
    reason          = models.TextField(null=True, blank=True)
    supersedes      = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL)
    decided_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'decisions'

    def __str__(self):
        return f"Decision({self.decision_id}) {self.action}"


# ─────────────────────────────────────────────────────────────────────────────
# 7. Verification, Cases, Analyst Feedback, Staff Users
# ─────────────────────────────────────────────────────────────────────────────

class StaffUser(models.Model):
    staff_id   = models.UUIDField(primary_key=True, default=uuid.uuid4)
    email      = models.TextField(unique=True)
    full_name  = models.TextField()
    role       = models.CharField(max_length=20, choices=StaffRole.choices)
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'staff_users'

    def __str__(self):
        return f"{self.full_name} ({self.role})"


class FraudCase(models.Model):
    case_id     = models.UUIDField(primary_key=True, default=uuid.uuid4)
    shipment    = models.ForeignKey(Shipment, on_delete=models.PROTECT, related_name='cases')
    assessment  = models.ForeignKey(RiskAssessment, on_delete=models.PROTECT)
    account     = models.ForeignKey(Account, on_delete=models.PROTECT, related_name='cases')
    assigned_to = models.ForeignKey(StaffUser, null=True, blank=True, on_delete=models.SET_NULL)
    status      = models.CharField(max_length=30, choices=CaseStatus.choices, default=CaseStatus.OPEN)
    priority    = models.CharField(max_length=10, choices=CasePriority.choices, default=CasePriority.NORMAL)
    opened_at   = models.DateTimeField(auto_now_add=True)
    sla_due_at  = models.DateTimeField(null=True, blank=True)
    closed_at   = models.DateTimeField(null=True, blank=True)
    verdict     = models.CharField(max_length=20, choices=VerdictType.choices, null=True, blank=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'fraud_cases'

    def __str__(self):
        return f"Case({self.case_id}) ship={self.shipment_id} status={self.status}"


class AnalystFeedback(models.Model):
    feedback_id    = models.UUIDField(primary_key=True, default=uuid.uuid4)
    case           = models.ForeignKey(FraudCase, on_delete=models.PROTECT, related_name='feedback')
    shipment       = models.ForeignKey(Shipment, on_delete=models.PROTECT)
    analyst        = models.ForeignKey(StaffUser, on_delete=models.PROTECT)
    predicted_level = models.CharField(max_length=10, choices=RiskLevel.choices)
    verdict        = models.CharField(max_length=20, choices=VerdictType.choices)
    fraud_type     = models.CharField(max_length=30, choices=FraudType.choices, null=True, blank=True)
    override_action = models.CharField(max_length=20, choices=DecisionAction.choices, null=True, blank=True)
    notes          = models.TextField(null=True, blank=True)
    used_for_training = models.BooleanField(default=False)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'analyst_feedback'

    def __str__(self):
        return f"Feedback({self.feedback_id}) verdict={self.verdict}"


# ─────────────────────────────────────────────────────────────────────────────
# 8. Audit log
# ─────────────────────────────────────────────────────────────────────────────

class AuditLog(models.Model):
    audit_id    = models.BigAutoField(primary_key=True)
    occurred_at = models.DateTimeField(auto_now_add=True)
    actor_type  = models.TextField()   # SYSTEM | STAFF | CUSTOMER | LLM
    actor_id    = models.UUIDField(null=True, blank=True)
    action      = models.TextField()
    entity_type = models.TextField()
    entity_id   = models.UUIDField(null=True, blank=True)
    shipment_id = models.UUIDField(null=True, blank=True)
    before_state = models.JSONField(null=True, blank=True)
    after_state  = models.JSONField(null=True, blank=True)
    ip_address  = models.GenericIPAddressField(null=True, blank=True)
    prev_hash   = models.TextField(null=True, blank=True)
    row_hash    = models.TextField(default='')

    class Meta:
        db_table = 'audit_log'
        ordering = ['audit_id']

    def __str__(self):
        return f"AuditLog({self.audit_id}) {self.action}"


# ─────────────────────────────────────────────────────────────────────────────
# 9. Simulator
# ─────────────────────────────────────────────────────────────────────────────

class SimulationRun(models.Model):
    run_id        = models.UUIDField(primary_key=True, default=uuid.uuid4)
    scenario      = models.CharField(max_length=30, choices=SimScenario.choices)
    config        = models.ForeignKey(ThresholdConfig, null=True, blank=True, on_delete=models.SET_NULL)
    model_version = models.ForeignKey(ModelVersion, null=True, blank=True, on_delete=models.SET_NULL)
    started_at    = models.DateTimeField(auto_now_add=True)
    finished_at   = models.DateTimeField(null=True, blank=True)
    total_shipments = models.IntegerField(null=True, blank=True)
    fraud_shipments = models.IntegerField(null=True, blank=True)
    true_positives  = models.IntegerField(null=True, blank=True)
    false_positives = models.IntegerField(null=True, blank=True)
    true_negatives  = models.IntegerField(null=True, blank=True)
    false_negatives = models.IntegerField(null=True, blank=True)
    precision_score = models.DecimalField(max_digits=5, decimal_places=4, null=True, blank=True)
    recall_score    = models.DecimalField(max_digits=5, decimal_places=4, null=True, blank=True)
    f1_score        = models.DecimalField(max_digits=5, decimal_places=4, null=True, blank=True)
    false_positive_rate = models.DecimalField(max_digits=5, decimal_places=4, null=True, blank=True)
    loss_prevented  = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = 'simulation_runs'

    def __str__(self):
        return f"SimRun({self.run_id}) {self.scenario}"
