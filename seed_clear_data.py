import os
import sys
import random
import uuid
import django
from datetime import timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'fraudshield.settings')
django.setup()

from django.utils import timezone
from intelligence.models import (
    Account, AccountDevice, AccountPayment, Address, Device, Payment,
    Shipment, Shipper, EntityLink, FraudSignal, FraudRing, FraudRingMember,
    RiskAssessment, Decision
)

def make_address(city, country="IN", is_high_risk=False, reshipper=False):
    return Address.objects.create(
        normalized_hash=f"{city}-{country}-{uuid.uuid4().hex[:6]}",
        city=city,
        country=country,
        address_type='RESHIPPER' if reshipper else 'COMMERCIAL',
        is_high_risk=is_high_risk,
        confidence_score=30 if is_high_risk else 95,
    )

def seed_data():
    now = timezone.now()
    uid = uuid.uuid4().hex[:4].upper()
    print(f"Seeding new cleanly-named data with suffix {uid}...")

    # 1. CLEAN BASELINE ACCOUNT (Behavioral Baseline)
    shipper_clean = Shipper.objects.create(company_name=f"Legit-Logistics-Inc-{uid}", country="IN", is_trusted=True)
    acc_clean = Account.objects.create(
        shipper=shipper_clean, account_number=f"ACC-CLEAN-01-{uid}", opened_at=now - timedelta(days=365)
    )
    dev_clean = Device.objects.create(fingerprint_hash=f"DEV-CLEAN-MACBOOK-{uid}", device_type="desktop")
    pay_clean = Payment.objects.create(payment_token=f"PAY-CLEAN-CORP-CARD-{uid}", method_type="CREDIT_CARD", last4="1234")
    AccountDevice.objects.create(account=acc_clean, device=dev_clean, login_count=250)
    AccountPayment.objects.create(account=acc_clean, payment=pay_clean, usage_count=100)
    
    addr_clean_orig = make_address("Mumbai")
    addr_clean_dest = make_address("Pune")

    Shipment.objects.create(
        booking_ref=f"SHIP-CLEAN-BASELINE-{uid}",
        account=acc_clean, shipper=shipper_clean, device=dev_clean, payment=pay_clean,
        origin_address=addr_clean_orig, dest_address=addr_clean_dest,
        weight_kg=5.0, declared_value=1000, shipping_cost=150, service="GROUND"
    )

    # 2. ACCOUNT TAKEOVER (ATO) VICTIM (Identity Features)
    shipper_ato = Shipper.objects.create(company_name=f"Compromised-Retail-LLC-{uid}", country="IN")
    acc_ato = Account.objects.create(
        shipper=shipper_ato, account_number=f"ACC-ATO-VICTIM-{uid}", 
        opened_at=now - timedelta(days=500),
        last_password_change_at=now - timedelta(hours=2),
        last_profile_change_at=now - timedelta(hours=1)
    )
    dev_hacker = Device.objects.create(fingerprint_hash=f"DEV-HACKER-VPN-NODE-{uid}", device_type="mobile", is_flagged=True)
    pay_stolen = Payment.objects.create(payment_token=f"PAY-STOLEN-CARD-{uid}", method_type="CREDIT_CARD", last4="9999", issuer_country="RU")
    AccountDevice.objects.create(account=acc_ato, device=dev_hacker, login_count=1) # identity_is_new_device
    AccountPayment.objects.create(account=acc_ato, payment=pay_stolen, usage_count=1) # identity_is_new_payment
    
    addr_ato_dest = make_address("Suspicious-City", is_high_risk=True, reshipper=True)

    Shipment.objects.create(
        booking_ref=f"SHIP-ATO-FRAUD-{uid}",
        account=acc_ato, shipper=shipper_ato, device=dev_hacker, payment=pay_stolen,
        origin_address=addr_clean_orig, dest_address=addr_ato_dest,
        weight_kg=50.0,  # behavioral_weight_exceeds_max
        declared_value=20000, shipping_cost=2500, service="GROUND"
    )

    FraudSignal.objects.create(entity_type='DEVICE', entity_id=dev_hacker.device_id, signal_type='EXTERNAL_FEED', severity=9, description="VPN Node Detected")
    FraudSignal.objects.create(entity_type='ACCOUNT', entity_id=acc_ato.account_id, signal_type='PRIOR_FRAUD', severity=8, description="Profile changed right before booking")

    # 3. FRAUD RING SYNDICATE (Device/IP & Velocity Features)
    shipper_ring1 = Shipper.objects.create(company_name=f"Syndicate-Front-A-{uid}", country="IN")
    acc_ring1 = Account.objects.create(shipper=shipper_ring1, account_number=f"ACC-RING-NODE-A-{uid}", opened_at=now - timedelta(days=5))
    
    shipper_ring2 = Shipper.objects.create(company_name=f"Syndicate-Front-B-{uid}", country="IN")
    acc_ring2 = Account.objects.create(shipper=shipper_ring2, account_number=f"ACC-RING-NODE-B-{uid}", opened_at=now - timedelta(days=3))
    
    dev_shared = Device.objects.create(fingerprint_hash=f"DEV-SHARED-BURNER-PHONE-{uid}", device_type="mobile", linked_account_count=5)
    pay_shared = Payment.objects.create(payment_token=f"PAY-SHARED-STOLEN-BIN-{uid}", method_type="CREDIT_CARD", last4="0000", failed_attempt_count=12)

    AccountDevice.objects.create(account=acc_ring1, device=dev_shared, login_count=5)
    AccountDevice.objects.create(account=acc_ring2, device=dev_shared, login_count=8)
    AccountPayment.objects.create(account=acc_ring1, payment=pay_shared, usage_count=2)
    AccountPayment.objects.create(account=acc_ring2, payment=pay_shared, usage_count=3)

    # Link accounts visually in the DB for the fraud graph
    EntityLink.objects.create(src_type='ACCOUNT', src_id=acc_ring1.account_id, dst_type='DEVICE', dst_id=dev_shared.device_id, link_type='USES_DEVICE', weight=5)
    EntityLink.objects.create(src_type='ACCOUNT', src_id=acc_ring2.account_id, dst_type='DEVICE', dst_id=dev_shared.device_id, link_type='USES_DEVICE', weight=8)
    EntityLink.objects.create(src_type='ACCOUNT', src_id=acc_ring1.account_id, dst_type='PAYMENT', dst_id=pay_shared.payment_id, link_type='USES_PAYMENT', weight=2)
    EntityLink.objects.create(src_type='ACCOUNT', src_id=acc_ring2.account_id, dst_type='PAYMENT', dst_id=pay_shared.payment_id, link_type='USES_PAYMENT', weight=3)

    addr_drop = make_address("Drop-Location", is_high_risk=True, reshipper=True)

    Shipment.objects.create(
        booking_ref=f"SHIP-RING-BURST-1-{uid}", account=acc_ring1, shipper=shipper_ring1, device=dev_shared, payment=pay_shared,
        origin_address=addr_clean_orig, dest_address=addr_drop, weight_kg=2.0, declared_value=5000, shipping_cost=100, service="GROUND"
    )
    Shipment.objects.create(
        booking_ref=f"SHIP-RING-BURST-2-{uid}", account=acc_ring2, shipper=shipper_ring2, device=dev_shared, payment=pay_shared,
        origin_address=addr_clean_orig, dest_address=addr_drop, weight_kg=2.0, declared_value=5000, shipping_cost=100, service="GROUND"
    )

    ring = FraudRing.objects.create(ring_score=95.0, shared_entities={'devices': [str(dev_shared.device_id)], 'payments': [str(pay_shared.payment_id)]})
    FraudRingMember.objects.create(ring=ring, account=acc_ring1)
    FraudRingMember.objects.create(ring=ring, account=acc_ring2)

    FraudSignal.objects.create(entity_type='ACCOUNT', entity_id=acc_ring1.account_id, signal_type='LINKED_TO_BLOCKED_ACCOUNT', severity=9, description="High velocity burner phone syndicate")
    FraudSignal.objects.create(entity_type='ACCOUNT', entity_id=acc_ring2.account_id, signal_type='LINKED_TO_BLOCKED_ACCOUNT', severity=9, description="High velocity burner phone syndicate")

    print("Seed complete! Created clear ML scenario entities.")

if __name__ == '__main__':
    seed_data()
