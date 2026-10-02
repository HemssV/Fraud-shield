import json
import logging
from datetime import timedelta
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, roc_auc_score, precision_score, recall_score, confusion_matrix

from ml.config import DATA_DIR, ARTIFACTS_DIR
from ml.features.schema import FEATURE_SPEC, ORDERED_FEATURE_NAMES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def get_simple_rule_score(row):
    """Simplified Python version of the Node rules for ablation baseline."""
    score = 0
    if row.get('behavioral_weight_ratio_to_avg', 1.0) >= 3: score += 15
    if row.get('identity_is_new_device', False): score += 12
    if row.get('identity_is_new_payment_for_account', False): score += 8
    if row.get('address_is_new_destination_for_shipper', False): score += 8
    if row.get('identity_is_suspended', False): score += 30
    if row.get('payment_is_new_payment_method', False): score += 10
    if row.get('velocity_volume_spike_detected', False): score += 12
    return min(100, score)

def train_models():
    data_path = DATA_DIR / "bookings.parquet"
    if not data_path.exists():
        logging.error(f"Data not found at {data_path}. Run generate.py first.")
        return
        
    df = pd.read_parquet(data_path)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # 1. Time-based split
    # Total days = 180. Train=0..120, Val=120..150, Test=150..180
    start_date = df['timestamp'].min()
    train_end = start_date + timedelta(days=120)
    val_end = start_date + timedelta(days=150)
    
    # Label delay simulation: for training, ignore labels from the last 14 days of the train period
    label_cutoff = train_end - timedelta(days=14)
    
    train_df = df[df['timestamp'] < train_end].copy()
    val_df = df[(df['timestamp'] >= train_end) & (df['timestamp'] < val_end)].copy()
    test_df = df[df['timestamp'] >= val_end].copy()
    
    logging.info(f"Split sizes: Train={len(train_df)}, Val={len(val_df)}, Test={len(test_df)}")
    
    # Apply label delay
    delayed_mask = train_df['timestamp'] >= label_cutoff
    train_df.loc[delayed_mask, 'label'] = 0
    logging.info(f"Label delay applied to {delayed_mask.sum()} train rows.")

    X_train = train_df[ORDERED_FEATURE_NAMES].values
    y_train = train_df['label'].values
    X_val = val_df[ORDERED_FEATURE_NAMES].values
    y_val = val_df['label'].values
    X_test = test_df[ORDERED_FEATURE_NAMES].values
    y_test = test_df['label'].values
    
    # 2. Isolation Forest (Behavioral / Velocity)
    # Filter features that start with behavioral_ or velocity_
    bev_vel_idx = [i for i, f in enumerate(ORDERED_FEATURE_NAMES) if f.startswith('behavioral_') or f.startswith('velocity_')]
    
    # Fit unsupervised on legit-looking train rows only
    legit_train_idx = np.where(y_train == 0)[0]
    X_train_iforest = X_train[legit_train_idx][:, bev_vel_idx]
    
    logging.info("Fitting Isolation Forest...")
    iforest = IsolationForest(n_estimators=100, random_state=42, n_jobs=-1, contamination=0.05)
    iforest.fit(X_train_iforest)
    
    # Score all sets (lower score = more anomalous. We invert to higher = anomalous)
    def get_iforest_scores(X):
        scores = -iforest.decision_function(X[:, bev_vel_idx])
        # percentile normalize roughly (0 to 1) using train stats
        # For simplicity, we just use the raw inverted scores as a feature
        return scores
        
    train_if_scores = get_iforest_scores(X_train)
    val_if_scores = get_iforest_scores(X_val)
    test_if_scores = get_iforest_scores(X_test)
    
    # Add iforest score as new feature
    X_train_full = np.column_stack([X_train, train_if_scores])
    X_val_full = np.column_stack([X_val, val_if_scores])
    X_test_full = np.column_stack([X_test, test_if_scores])
    
    new_feature_names = ORDERED_FEATURE_NAMES + ['anomaly_score']
    
    # 3. LightGBM
    logging.info("Training LightGBM...")
    train_data = lgb.Dataset(X_train_full, label=y_train, feature_name=new_feature_names)
    val_data = lgb.Dataset(X_val_full, label=y_val, feature_name=new_feature_names)
    
    # Handle class imbalance using scale_pos_weight
    pos_weight = (len(y_train) - sum(y_train)) / max(1, sum(y_train))
    
    params = {
        'objective': 'binary',
        'metric': 'average_precision',
        'learning_rate': 0.05,
        'num_leaves': 31,
        'scale_pos_weight': pos_weight,
        'random_state': 42,
        'verbose': -1
    }
    
    lgb_model = lgb.train(
        params,
        train_data,
        num_boost_round=1000,
        valid_sets=[val_data],
        callbacks=[lgb.early_stopping(stopping_rounds=50)]
    )
    
    # 4. Calibration
    logging.info("Calibrating probabilities...")
    val_raw_preds = lgb_model.predict(X_val_full)
    calibrator = IsotonicRegression(out_of_bounds='clip')
    calibrator.fit(val_raw_preds, y_val)
    
    # 5. Evaluation Ablation (on Test set)
    logging.info("--- Ablation Study (Test Set) ---")
    
    # a) Rules only
    test_df['rule_score'] = test_df.apply(get_simple_rule_score, axis=1)
    rule_preds = (test_df['rule_score'] >= 70).astype(int)
    logging.info(f"Rules Baseline -> Precision: {precision_score(y_test, rule_preds):.3f}, Recall: {recall_score(y_test, rule_preds):.3f}")
    
    # b) IForest only (unsupervised anomaly detection)
    if_only_preds = (test_if_scores > np.percentile(train_if_scores, 95)).astype(int)
    logging.info(f"IForest Only   -> Precision: {precision_score(y_test, if_only_preds):.3f}, Recall: {recall_score(y_test, if_only_preds):.3f}")
    
    # c) Full Stack (LightGBM + IForest + Calibration)
    test_raw_preds = lgb_model.predict(X_test_full)
    test_cal_preds = calibrator.predict(test_raw_preds)
    
    lgb_pr_auc = average_precision_score(y_test, test_cal_preds)
    lgb_roc_auc = roc_auc_score(y_test, test_cal_preds)
    logging.info(f"Full Stack     -> PR-AUC: {lgb_pr_auc:.3f}, ROC-AUC: {lgb_roc_auc:.3f}")
    
    # 6. Save Bundle
    out_dir = ARTIFACTS_DIR / "v1"
    out_dir.mkdir(parents=True, exist_ok=True)
    
    lgb_model.save_model(out_dir / "model.txt")
    joblib.dump(iforest, out_dir / "iforest.joblib")
    joblib.dump(calibrator, out_dir / "calibrator.joblib")
    
    # feature spec 
    with open(out_dir / "feature_spec.json", "w") as f:
        json.dump(FEATURE_SPEC, f, indent=2)
        
    # thresholds
    thresholds = {
        "fraud_probability_high": 0.5,
        "fraud_probability_critical": 0.8
    }
    with open(out_dir / "thresholds.json", "w") as f:
        json.dump(thresholds, f, indent=2)
        
    metadata = {
        "model_version": "v1.0.0",
        "train_date_range": [start_date.isoformat(), train_end.isoformat()],
        "metrics": {
            "test_pr_auc": lgb_pr_auc,
            "test_roc_auc": lgb_roc_auc
        },
        "seed": 42
    }
    with open(out_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)
        
    logging.info(f"Model bundle saved to {out_dir}")

if __name__ == "__main__":
    train_models()
