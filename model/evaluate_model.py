"""
evaluate_model.py

Run from inside model/:
    python evaluate_model.py

Uses:
    ../data/customer_features.csv
    ./scaler.pkl
    ./isolation_forest.pkl
    ./model.h5
    ./feature_columns.json
"""

import argparse
import json
import os

import joblib
import numpy as np
import pandas as pd
from scipy.stats import rankdata
from sklearn.metrics import precision_score, recall_score, f1_score, roc_auc_score
from tensorflow import keras


RANDOM_SEED = 42
N_INJECTED_FRAUD = 20
TOP_RISK_PERCENT = 0.15


DEFAULT_FEATURE_COLUMNS = [
    "return_rate",
    "refund_frequency",
    "high_value_return_ratio",
    "version_diversity",
    "category_diversity",
    "avg_transaction_value",
]


def percentile_scale(scores: np.ndarray) -> np.ndarray:
    if len(scores) <= 1:
        return np.zeros_like(scores, dtype=float)

    ranks = rankdata(scores, method="average")
    return (ranks - 1) / (len(ranks) - 1) * 100


def top_percent_flags(scores: np.ndarray, percent: float = TOP_RISK_PERCENT) -> np.ndarray:
    n_top = max(1, int(np.ceil(len(scores) * percent)))
    cutoff = np.sort(scores)[-n_top]
    return scores >= cutoff


def load_feature_columns(model_dir: str) -> list[str]:
    path = os.path.join(model_dir, "feature_columns.json")

    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)

    return DEFAULT_FEATURE_COLUMNS


def inject_synthetic_fraud(df: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    rng = np.random.default_rng(RANDOM_SEED)
    injected_rows = []

    base_numeric = df[feature_columns].copy()

    for i in range(N_INJECTED_FRAUD):
        row = df.sample(1, random_state=RANDOM_SEED + i).iloc[0].copy()

        row["return_rate"] = min(
            1.0,
            max(
                0.95,
                base_numeric["return_rate"].quantile(0.99) * rng.uniform(1.05, 1.25),
            ),
        )

        row["refund_frequency"] = max(
            base_numeric["refund_frequency"].quantile(0.99) * rng.uniform(1.4, 2.0),
            base_numeric["refund_frequency"].max() * rng.uniform(1.05, 1.3),
        )

        row["version_diversity"] = max(
            base_numeric["version_diversity"].quantile(0.99) * rng.uniform(1.4, 2.0),
            base_numeric["version_diversity"].max() * rng.uniform(1.05, 1.3),
        )

        row["high_value_return_ratio"] = min(
            1.0,
            max(
                0.90,
                base_numeric["high_value_return_ratio"].quantile(0.99)
                * rng.uniform(1.05, 1.25),
            ),
        )

        row["category_diversity"] = max(
            base_numeric["category_diversity"].quantile(0.95),
            row["category_diversity"],
        )

        row["avg_transaction_value"] = max(
            base_numeric["avg_transaction_value"].quantile(0.90),
            row["avg_transaction_value"],
        )

        for col in df.columns:
            if col not in feature_columns:
                row[col] = f"injected_fraud_{i + 1}"

        row["is_injected_fraud"] = 1
        injected_rows.append(row)

    test_df = df.copy()
    test_df["is_injected_fraud"] = 0

    injected_df = pd.DataFrame(injected_rows)
    return pd.concat([test_df, injected_df], ignore_index=True)


def main(input_path: str, model_dir: str):
    feature_columns = load_feature_columns(model_dir)

    df = pd.read_csv(input_path)

    missing = [col for col in feature_columns if col not in df.columns]
    if missing:
        raise ValueError(f"Missing expected feature columns: {missing}")

    test_df = inject_synthetic_fraud(df, feature_columns)

    scaler = joblib.load(os.path.join(model_dir, "scaler.pkl"))
    isolation_forest = joblib.load(os.path.join(model_dir, "isolation_forest.pkl"))
    autoencoder = keras.models.load_model(
        os.path.join(model_dir, "model.h5"),
        compile=False,
    )

    X = test_df[feature_columns].copy()
    X_scaled = scaler.transform(X)

    iso_raw_scores = -isolation_forest.score_samples(X_scaled)

    reconstructions = autoencoder.predict(X_scaled, verbose=0)
    ae_raw_scores = np.mean(np.square(X_scaled - reconstructions), axis=1)

    iso_risk_score = percentile_scale(iso_raw_scores)
    ae_risk_score = percentile_scale(ae_raw_scores)
    combined_risk_score = (iso_risk_score + ae_risk_score) / 2

    y_true = test_df["is_injected_fraud"].astype(int).to_numpy()
    y_pred = top_percent_flags(combined_risk_score).astype(int)

    precision = precision_score(y_true, y_pred, zero_division=0)
    recall = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)
    auc_roc = roc_auc_score(y_true, combined_risk_score)

    injected_scores = combined_risk_score[y_true == 1]
    injected_in_top_15 = y_pred[y_true == 1].sum()

    ae_flags = top_percent_flags(ae_risk_score)
    iso_flags = top_percent_flags(iso_risk_score)
    agreement_rate = np.mean(ae_flags == iso_flags)

    print("\nEvaluation on synthetic held-out test set")
    print("----------------------------------------")
    print(f"Original customers: {len(df)}")
    print(f"Injected fraud customers: {N_INJECTED_FRAUD}")
    print(f"Total test customers: {len(test_df)}")

    print("\nInjected fraud top-15% check")
    print("----------------------------")
    print(f"Injected fraud customers in top 15% risk range: {injected_in_top_15}/{N_INJECTED_FRAUD}")
    print(f"Injected fraud combined risk mean: {injected_scores.mean():.2f}")
    print(f"Injected fraud combined risk min: {injected_scores.min():.2f}")
    print(f"Injected fraud combined risk max: {injected_scores.max():.2f}")

    print("\nMetrics")
    print("-------")
    print(f"Precision: {precision:.4f}")
    print(f"Recall:    {recall:.4f}")
    print(f"F1:        {f1:.4f}")
    print(f"AUC-ROC:   {auc_roc:.4f}")

    print("\nModel agreement")
    print("---------------")
    print(f"Autoencoder vs Isolation Forest top-15% flag agreement: {agreement_rate:.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate trained fraud anomaly models.")
    parser.add_argument(
        "--input",
        default="../data/customer_features.csv",
        help="Path to customer_features.csv",
    )
    parser.add_argument(
        "--model-dir",
        default=".",
        help="Directory containing model.h5, scaler.pkl, isolation_forest.pkl, feature_columns.json",
    )

    args = parser.parse_args()
    main(args.input, args.model_dir)