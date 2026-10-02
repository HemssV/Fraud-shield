import json
import logging
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import precision_score, recall_score, confusion_matrix, roc_curve, precision_recall_curve

from ml.config import DATA_DIR, ARTIFACTS_DIR, DOCS_DIR
import ml.models.train as train_module

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def evaluate_models():
    data_path = DATA_DIR / "bookings.parquet"
    df = pd.read_parquet(data_path)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # We evaluate on the TEST set (Month 6)
    start_date = df['timestamp'].min()
    val_end = start_date + pd.Timedelta(days=150)
    test_df = df[df['timestamp'] >= val_end].copy()
    
    logging.info(f"Evaluating on Test Set ({len(test_df)} rows)")
    
    # Load model and engine
    # Instead of rewriting prediction logic, let's load it
    import joblib
    import lightgbm as lgb
    
    model_dir = ARTIFACTS_DIR / "v1"
    lgb_model = lgb.Booster(model_file=str(model_dir / "model.txt"))
    iforest = joblib.load(model_dir / "iforest.joblib")
    calibrator = joblib.load(model_dir / "calibrator.joblib")
    
    from ml.features.schema import ORDERED_FEATURE_NAMES
    X_test = test_df[ORDERED_FEATURE_NAMES].values
    y_test = test_df['label'].values
    
    bev_vel_idx = [i for i, f in enumerate(ORDERED_FEATURE_NAMES) if f.startswith('behavioral_') or f.startswith('velocity_')]
    if_scores = -iforest.decision_function(X_test[:, bev_vel_idx])
    
    X_test_full = np.column_stack([X_test, if_scores])
    raw_preds = lgb_model.predict(X_test_full)
    probs = calibrator.predict(raw_preds)
    
    test_df['pred_prob'] = probs
    
    # 1. Metrics at FPR 1% and 0.5%
    fpr, tpr, roc_thresholds = roc_curve(y_test, probs)
    
    idx_1_fpr = np.where(fpr <= 0.01)[0][-1]
    idx_05_fpr = np.where(fpr <= 0.005)[0][-1]
    
    logging.info(f"Recall at 1.0% FPR: {tpr[idx_1_fpr]:.3f} (Threshold: {roc_thresholds[idx_1_fpr]:.3f})")
    logging.info(f"Recall at 0.5% FPR: {tpr[idx_05_fpr]:.3f} (Threshold: {roc_thresholds[idx_05_fpr]:.3f})")
    
    # 2. Precision at top-k
    k = min(500, sum(y_test))
    top_k_idx = np.argsort(probs)[::-1][:k]
    top_k_precision = np.mean(y_test[top_k_idx])
    logging.info(f"Precision at Top-{k}: {top_k_precision:.3f}")
    
    # 3. Confusion Matrix at Threshold 0.5
    chosen_thresh = 0.5
    preds = (probs >= chosen_thresh).astype(int)
    cm = confusion_matrix(y_test, preds)
    logging.info(f"Confusion Matrix (Thresh={chosen_thresh}):\n{cm}")
    
    # 4. Per-Fraud-Type Recall
    logging.info("--- Per Typology Recall ---")
    fraud_df = test_df[test_df['label'] == 1]
    for typ in fraud_df['fraud_type'].unique():
        typ_mask = test_df['fraud_type'] == typ
        typ_recall = recall_score(test_df[typ_mask]['label'], preds[typ_mask], zero_division=0)
        logging.info(f"  {typ:20s}: {typ_recall:.3f} ({sum(typ_mask)} cases)")
        
    # 5. Hard Negatives FPR
    hn_mask = test_df['is_hard_negative'] == True
    hn_fpr = np.mean(preds[hn_mask]) if sum(hn_mask) > 0 else 0
    logging.info(f"Hard Negatives FPR: {hn_fpr:.3f} ({sum(hn_mask)} cases)")
    
    # 6. Cost Curve Generation
    # Assumptions: 
    # Cost of missed fraud = shipment value avg (approx 2500 INR) + friction
    # Cost of false positive = manual review cost (approx 50 INR / 5 min)
    thresholds = np.linspace(0.01, 0.99, 100)
    costs = []
    for th in thresholds:
        p = (probs >= th).astype(int)
        fn = np.sum((y_test == 1) & (p == 0))
        fp = np.sum((y_test == 0) & (p == 1))
        cost = (fn * 2500) + (fp * 50)
        costs.append(cost)
        
    optimal_idx = np.argmin(costs)
    optimal_thresh = thresholds[optimal_idx]
    logging.info(f"Optimal Threshold from Cost Curve: {optimal_thresh:.3f} (Min Cost: {costs[optimal_idx]} INR)")
    
    # Plot cost curve
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    fig_dir = DOCS_DIR / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)
    
    plt.figure()
    plt.plot(thresholds, costs)
    plt.axvline(optimal_thresh, color='r', linestyle='--', label=f'Optimal {optimal_thresh:.2f}')
    plt.title('Expected Cost vs Threshold (INR)')
    plt.xlabel('Threshold')
    plt.ylabel('Cost')
    plt.legend()
    plt.savefig(fig_dir / "cost_curve.png")
    
    # 7. Write EVAL.md
    eval_md = f"""# Evaluation Report

## Metrics
- **Recall at 1% FPR**: {tpr[idx_1_fpr]:.3f}
- **Recall at 0.5% FPR**: {tpr[idx_05_fpr]:.3f}
- **Precision at Top-{k}**: {top_k_precision:.3f}

## Confusion Matrix (Threshold {chosen_thresh})
| | Predicted Legit | Predicted Fraud |
|---|---|---|
| **Actual Legit** | {cm[0,0]} | {cm[0,1]} |
| **Actual Fraud** | {cm[1,0]} | {cm[1,1]} |

## Typology Recall
"""
    for typ in fraud_df['fraud_type'].unique():
        typ_mask = test_df['fraud_type'] == typ
        typ_recall = recall_score(test_df[typ_mask]['label'], preds[typ_mask], zero_division=0)
        eval_md += f"- **{typ}**: {typ_recall:.3f} ({sum(typ_mask)} cases)\n"
        
    eval_md += f"\n## Hard Negatives\n- FPR on Hard Negatives: {hn_fpr:.3f}\n"
    
    eval_md += f"\n## Cost Curve Analysis\n- Assumptions: Missed Fraud Cost = 2500 INR, False Positive Cost = 50 INR.\n- Optimal Threshold: {optimal_thresh:.3f}\n"
    
    eval_md += """
## Limitations
- **Synthetic Data**: The model is trained on data generated by our own heuristics, which guarantees high performance but overstates real-world effectiveness.
- **Label Delay**: Simulated a 14-day delay, but real-world chargebacks can take 30-60 days.
- **LOW_AND_SLOW**: Remains challenging as it intentionally mimics legitimate behavior.
"""
    
    with open(DOCS_DIR / "EVAL.md", "w") as f:
        f.write(eval_md)
        
    logging.info("Evaluation complete. EVAL.md and figures saved.")

if __name__ == "__main__":
    evaluate_models()
