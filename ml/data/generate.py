import argparse
import json
import logging
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any

import numpy as np
import pandas as pd

from ml.config import DATA_DIR, DEFAULT_SEED
from ml.features.schema import FEATURE_SPEC, ORDERED_FEATURE_NAMES
from ml.features.transform import flatten_features

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Enum definitions matching Node
FRAUD_TYPES = ['ACCOUNT_TAKEOVER', 'VOLUME_ATTACK', 'DESTINATION_ANOMALY', 'PAYMENT_MISMATCH', 'FRAUD_RING', 'LOW_AND_SLOW']
SERVICES = ['GROUND', 'EXPRESS', 'EXPRESS_SAVER', 'FREIGHT', 'INTERNATIONAL']
CITIES = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Ahmedabad', 'Chennai', 'Kolkata', 'Surat', 'Pune', 'Jaipur', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Thane', 'Bhopal', 'Visakhapatnam', 'Pimpri-Chinchwad', 'Patna', 'Vadodara']
COUNTRIES = ['IN', 'US', 'GB', 'CA', 'AU', 'SG']


class ShipperState:
    """Maintains the 'Digital Twin' state for a shipper to prevent future leakage."""
    def __init__(self, shipper_id: str, company: str, is_trusted: bool = False, created_at: datetime = None):
        self.shipper_id = shipper_id
        self.company = company
        self.is_trusted = is_trusted
        self.created_at = created_at or datetime(2023, 1, 1)
        
        self.total_shipments = 0
        self.known_devices = set()
        self.known_payments = set()
        self.usual_destinations = set()
        self.usual_origins = set()
        self.usual_services = set()
        self.usual_hours = set()
        
        self.weights = []
        self.daily_counts = {}  # date string -> count
        
        # Identity state
        self.password_changed_at = None
        self.profile_updated_at = None
        self.status = 'ACTIVE'
        self.is_verified = True
        self.previous_fraud_cases = 0
        self.previous_review_cases = 0

    def update(self, row: dict, dt: datetime):
        self.total_shipments += 1
        self.known_devices.add(row['device_id'])
        self.known_payments.add(row['payment_id'])
        self.usual_destinations.add(row['destination'])
        self.usual_origins.add(row['origin'])
        self.usual_services.add(row['service_type'])
        self.usual_hours.add(dt.hour)
        
        self.weights.append(row['weight'])
        if len(self.weights) > 1000:
            self.weights = self.weights[-1000:]
            
        date_str = dt.strftime('%Y-%m-%d')
        self.daily_counts[date_str] = self.daily_counts.get(date_str, 0) + int(row['package_count'])

    def compute_features(self, row: dict, dt: datetime, global_state: dict) -> dict:
        """Computes features AT THE TIME of booking, using ONLY past state."""
        
        # Base stats
        avg_weight = np.mean(self.weights) if self.weights else row['weight']
        std_weight = np.std(self.weights) if len(self.weights) > 1 else (avg_weight * 0.3)
        if std_weight == 0: std_weight = 1.0
        max_weight = np.max(self.weights) if self.weights else row['weight']
        
        avg_daily = np.mean(list(self.daily_counts.values())) if self.daily_counts else 1.0
        
        # Behavioral
        weight_z = (row['weight'] - avg_weight) / std_weight if avg_weight > 0 else 0
        weight_ratio = row['weight'] / avg_weight if avg_weight > 0 else 1.0
        
        # Identity
        account_age_days = (dt - self.created_at).days
        
        pwd_recent = False
        if self.password_changed_at:
            pwd_recent = (dt - self.password_changed_at).total_seconds() < 72 * 3600
            
        prof_recent = False
        if self.profile_updated_at:
            prof_recent = (dt - self.profile_updated_at).total_seconds() < 48 * 3600
            
        # Payment details
        pay_id = row['payment_id']
        pay_global = global_state['payments'].get(pay_id, {})
        
        # Device details
        dev_id = row['device_id']
        dev_global = global_state['devices'].get(dev_id, {})
        
        # Build raw nested dict
        f = {
            "behavioral": {
                "weight_z_score": weight_z,
                "weight_ratio_to_avg": weight_ratio,
                "weight_exceeds_max": row['weight'] > max_weight if self.total_shipments > 0 else False,
                "is_unusual_hour": dt.hour not in self.usual_hours if self.usual_hours else False,
                "booking_hour": dt.hour,
                "is_new_destination": row['destination'] not in self.usual_destinations if self.usual_destinations else False,
                "is_new_origin": row['origin'] not in self.usual_origins if self.usual_origins else False,
                "is_unusual_service": row['service_type'] not in self.usual_services if self.usual_services else False,
                "package_count_ratio": row['package_count'] / avg_daily if avg_daily > 0 else 1.0,
                "total_historical_shipments": self.total_shipments,
                "is_low_history": self.total_shipments < 10,
            },
            "identity": {
                "is_new_device": dev_id not in self.known_devices if self.known_devices else False,
                "is_new_payment_for_account": pay_id not in self.known_payments if self.known_payments else False,
                "password_changed_recently": pwd_recent,
                "profile_updated_recently": prof_recent,
                "account_age_days": account_age_days,
                "is_new_account": account_age_days < 30,
                "account_status": self.status,
                "is_suspended": self.status == 'SUSPENDED',
                "is_under_investigation": self.status == 'UNDER_INVESTIGATION',
                "is_verified": self.is_verified,
                "previous_fraud_cases": self.previous_fraud_cases,
                "previous_review_cases": self.previous_review_cases,
            },
            "payment": {
                "payment_found": True,
                "is_new_payment_method": pay_global.get('is_new', False),
                "cardholder_match": pay_global.get('cardholder_match', True),
                "billing_shipping_match": pay_global.get('billing_shipping_match', True),
                "previous_transactions": pay_global.get('tx_count', 0),
                "previous_shipments": pay_global.get('tx_count', 0),
                "amount_spend_30d": pay_global.get('tx_count', 0) * 100.0,
                "previous_fraud_count": pay_global.get('fraud_count', 0),
                "foreign_card": pay_global.get('country', 'IN') != 'IN',
                "payment_type": pay_global.get('type', 'CREDIT_CARD'),
            },
            "device": {
                "device_found": True,
                "known_device": dev_global.get('known', True),
                "known_for_this_account": dev_id in self.known_devices,
                "accounts_linked": dev_global.get('accounts_linked', 1),
                "device_risk_score": dev_global.get('risk_score', 10),
                "ip_country": dev_global.get('ip_country', 'IN'),
                "ip_reputation": dev_global.get('ip_rep', 'CLEAN'),
                "vpn_detected": dev_global.get('vpn', False),
                "proxy_detected": dev_global.get('proxy', False),
                "device_blacklisted": dev_global.get('blacklisted', False),
                "ip_blacklisted": dev_global.get('ip_blacklisted', False),
                "device_linked_to_fraud": dev_global.get('linked_fraud', False),
                "linked_fraud_account_count": dev_global.get('fraud_accounts', 0),
                "linked_fraud_accounts": [],
            },
            "address": {
                "address_found": True,
                "address_valid": True,
                "confidence_score": 0.90 if row['destination'] in ['Mumbai', 'Bangalore', 'Delhi'] else 0.60,
                "risk_tier": "HIGH" if row['destination'] in ['International Reshipper Hub', 'Unknown City'] else "LOW",
                "is_new_destination_for_shipper": row['destination'] not in self.usual_destinations,
                "delivery_success_rate": 0.95,
                "signals": [],
            },
            "velocity": {
                "booking_hour": dt.hour,
                "is_late_night": dt.hour >= 22 or dt.hour <= 4,
                "is_weekend": dt.weekday() >= 5,
                "avg_daily_volume": avg_daily,
                "estimated_daily_rate": row['package_count'],
                "volume_spike_detected": row['package_count'] > avg_daily * 3 and avg_daily > 0,
            }
        }
        
        # Record global updates for NEXT time
        pay_global['tx_count'] = pay_global.get('tx_count', 0) + 1
        global_state['payments'][pay_id] = pay_global
        
        return f

def setup_seeds(start_dt: datetime) -> List[ShipperState]:
    shippers = []
    # S1001: Chennai Export Pvt Ltd
    s1 = ShipperState('S1001', 'Chennai Export Pvt Ltd', created_at=start_dt - timedelta(days=1268))
    # S2002: Mumbai Small Shipper
    s2 = ShipperState('S2002', 'Mumbai Small Shipper', created_at=start_dt - timedelta(days=47))
    # S3003: Delhi Enterprise Corp
    s3 = ShipperState('S3003', 'Delhi Enterprise Corp', created_at=start_dt - timedelta(days=2456))
    
    return [s1, s2, s3]

def generate_data(n_shippers: int, days: int, out_dir: Path):
    random.seed(DEFAULT_SEED)
    np.random.seed(DEFAULT_SEED)
    
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=days)
    
    shippers = setup_seeds(start_dt)
    
    # Generate remaining shippers
    for i in range(4, n_shippers + 1):
        age = random.randint(1, 1000)
        shippers.append(ShipperState(f'S{i}', f'Company {i}', created_at=start_dt - timedelta(days=age)))
        
    global_state = {
        'payments': {},
        'devices': {}
    }
    
    # Pre-assign some personas
    personas = {}
    for s in shippers:
        size = random.choices(['THIN', 'SMALL', 'MEDIUM', 'ENTERPRISE'], weights=[0.2, 0.5, 0.25, 0.05])[0]
        if s.shipper_id == 'S1001': size = 'MEDIUM'
        elif s.shipper_id == 'S2002': size = 'THIN'
        elif s.shipper_id == 'S3003': size = 'ENTERPRISE'
        
        origins = random.sample(CITIES, k=random.randint(1, 3))
        dests = random.sample(CITIES, k=random.randint(2, 8))
        
        weight_mean = random.uniform(1.0, 50.0)
        
        personas[s.shipper_id] = {
            'size': size,
            'origins': origins,
            'dests': dests,
            'weight_mean': weight_mean,
            'devices': [f"D_{s.shipper_id}_{i}" for i in range(random.randint(1, 3))],
            'payments': [f"P_{s.shipper_id}_{i}" for i in range(random.randint(1, 2))],
            'prob_book_day': {'THIN': 0.05, 'SMALL': 0.2, 'MEDIUM': 0.8, 'ENTERPRISE': 1.0}[size],
            'n_per_day': {'THIN': 1, 'SMALL': 1, 'MEDIUM': 3, 'ENTERPRISE': 20}[size]
        }
    
    rows = []
    
    # Time loop
    current_dt = start_dt
    while current_dt <= end_dt:
        # Determine who books today
        for s in shippers:
            p = personas[s.shipper_id]
            if random.random() < p['prob_book_day']:
                # Number of bookings
                n_books = p['n_per_day']
                if p['size'] == 'ENTERPRISE': n_books = int(np.random.normal(20, 5))
                n_books = max(1, n_books)
                
                for _ in range(n_books):
                    hour = int(np.random.normal(14, 3))
                    hour = max(0, min(23, hour))
                    book_dt = current_dt.replace(hour=hour, minute=random.randint(0, 59))
                    
                    # Decide if this is a fraud event (~1.5% chance) or hard negative (~3% chance)
                    is_fraud = random.random() < 0.015
                    is_hn = random.random() < 0.03 and not is_fraud
                    
                    fraud_type = ""
                    scenario = "NORMAL"
                    
                    # Base fields
                    device_id = random.choice(p['devices'])
                    payment_id = random.choice(p['payments'])
                    origin = random.choice(p['origins'])
                    dest = random.choice(p['dests'])
                    weight = max(0.1, np.random.normal(p['weight_mean'], p['weight_mean']*0.3))
                    service = random.choices(SERVICES, weights=[0.6, 0.25, 0.1, 0.04, 0.01])[0]
                    pkg_count = 1
                    
                    if is_fraud:
                        fraud_type = random.choice(FRAUD_TYPES)
                        scenario = fraud_type
                        if fraud_type == 'ACCOUNT_TAKEOVER':
                            device_id = f"ATTACKER_DEV_{random.randint(1,100)}"
                            payment_id = f"ATTACKER_PAY_{random.randint(1,100)}"
                            dest = "Unknown City"
                            s.password_changed_at = book_dt - timedelta(hours=2)
                        elif fraud_type == 'VOLUME_ATTACK':
                            pkg_count = random.randint(10, 50)
                            weight *= pkg_count
                        elif fraud_type == 'DESTINATION_ANOMALY':
                            dest = "International Reshipper Hub"
                            weight *= 3
                        elif fraud_type == 'PAYMENT_MISMATCH':
                            payment_id = f"STOLEN_PAY_{random.randint(1,100)}"
                            global_state['payments'][payment_id] = {'tx_count': 0, 'fraud_count': 1, 'is_new': True, 'cardholder_match': False, 'billing_shipping_match': False}
                        elif fraud_type == 'FRAUD_RING':
                            device_id = "RING_DEVICE_1"
                            payment_id = "RING_PAY_1"
                            global_state['devices'][device_id] = {'accounts_linked': 5, 'linked_fraud': True}
                        elif fraud_type == 'LOW_AND_SLOW':
                            # Very subtle, no big deviations
                            pkg_count = 1
                            dest = random.choice(p['dests'])
                    
                    elif is_hn:
                        scenario = "SEASONAL_LEGIT_SPIKE" if random.random() < 0.3 else "LEGIT_NEW_BEHAVIOR"
                        if scenario == "SEASONAL_LEGIT_SPIKE":
                            pkg_count = random.randint(5, 15)
                            s.is_trusted = True
                        else:
                            # New device but legit
                            if random.random() < 0.5:
                                device_id = f"D_{s.shipper_id}_NEW"
                            else:
                                dest = random.choice(CITIES)
                                
                    row = {
                        "booking_id": str(uuid.uuid4()),
                        "shipper_id": s.shipper_id,
                        "timestamp": book_dt.isoformat(),
                        "booking_timestamp": book_dt.isoformat(),
                        "origin": origin,
                        "destination": dest,
                        "weight": weight,
                        "service_type": service,
                        "payment_id": payment_id,
                        "device_id": device_id,
                        "package_count": pkg_count,
                        "ip_address": f"192.168.1.{random.randint(1,255)}",
                        "label": 1 if is_fraud else 0,
                        "fraud_type": fraud_type,
                        "scenario": scenario,
                        "is_hard_negative": is_hn
                    }
                    
                    # Compute features AT THIS POINT IN TIME
                    feat_dict = s.compute_features(row, book_dt, global_state)
                    
                    # Flatten features
                    flat = flatten_features(feat_dict)
                    for i, fname in enumerate(ORDERED_FEATURE_NAMES):
                        row[fname] = flat[i]
                        
                    rows.append(row)
                    
                    # Update state FOR FUTURE
                    s.update(row, book_dt)
                    
        current_dt += timedelta(days=1)
        
    df = pd.DataFrame(rows)
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    out_file = out_dir / "bookings.parquet"
    df.to_parquet(out_file)
    logging.info(f"Generated {len(df)} rows. Saved to {out_file}")
    
    # Class balance
    logging.info("\nClass Balance:")
    logging.info(df['label'].value_counts(normalize=True))
    logging.info("\nFraud Typologies:")
    logging.info(df[df['label']==1]['fraud_type'].value_counts())
    
    # Emit scenarios.json test cases
    scenarios = df[df['scenario'] != "NORMAL"].drop_duplicates('scenario').to_dict('records')
    scenarios.append(df[df['scenario'] == "NORMAL"].iloc[0].to_dict())
    
    with open(out_dir / "scenarios.json", "w") as f:
        json.dump(scenarios, f, indent=2)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-shippers", type=int, default=2000)
    parser.add_argument("--days", type=int, default=180)
    parser.add_argument("--out", type=str, default=str(DATA_DIR))
    args = parser.parse_args()
    
    out_path = Path(args.out)
    out_path.mkdir(parents=True, exist_ok=True)
    generate_data(args.n_shippers, args.days, out_path)
