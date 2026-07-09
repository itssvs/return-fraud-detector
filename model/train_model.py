"""
train_model.py

Loads buyer-level features (customer_features.csv), fits a StandardScaler,
trains an Isolation Forest and a Keras Autoencoder for anomaly detection,
converts both models' anomaly signals into 0-100 percentile-scaled risk
scores, and saves all artifacts for later inference.

Run from inside model/:
    python train_model.py

Expects (by default) ../data/customer_features.csv relative to this file's
location, with at least these columns:
    return_rate, refund_frequency, high_value_return_ratio,
    version_diversity, category_diversity, avg_transaction_value,
    Phone Number  (identifier column)
"""

import argparse
import json
import os

import joblib
import numpy as np
import pandas as pd
from scipy.stats import rankdata
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, callbacks

RANDOM_SEED = 42
CONTAMINATION = 0.15

FEATURE_COLUMNS = [
    "return_rate",
    "refund_frequency",
    "high_value_return_ratio",
    "version_diversity",
    "category_diversity",
    "avg_transaction_value",
]

np.random.seed(RANDOM_SEED)
tf.random.set_seed(RANDOM_SEED)


def percentile_scale(scores: np.ndarray) -> np.ndarray:
    """
    Convert raw anomaly scores into a 0-100 risk score using percentile
    (rank-based) scaling. Highest raw anomaly score -> ~100, lowest -> ~0.
    """
    ranks = rankdata(scores, method="average")
    return (ranks - 1) / (len(ranks) - 1) * 100


def build_autoencoder(input_dim: int) -> keras.Model:
    """
    input -> dense(16) -> dense(bottleneck) -> dense(16) -> output

    The bottleneck is kept smaller than input_dim so the network is forced
    to actually compress the data instead of learning a near-identity
    mapping (which would make every sample "reconstruct perfectly" and
    destroy the anomaly signal). With 6 input features, a bottleneck of 3
    keeps a meaningful compression ratio while still leaving room to
    scale gracefully if more features are added later.
    """
    bottleneck_dim = max(2, input_dim // 2)
    inputs = keras.Input(shape=(input_dim,))
    x = layers.Dense(16, activation="relu")(inputs)
    x = layers.Dense(bottleneck_dim, activation="relu", name="bottleneck")(x)
    x = layers.Dense(16, activation="relu")(x)
    outputs = layers.Dense(input_dim, activation="linear")(x)

    model = keras.Model(inputs, outputs, name="autoencoder")
    model.compile(optimizer="adam", loss="mse")
    return model


def main(input_path: str, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)

    # ---------- 1. Load data, separate features from identifiers ----------
    df = pd.read_csv(input_path)

    missing = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Input file is missing expected feature columns: {missing}")

    identifier_cols = [c for c in df.columns if c not in FEATURE_COLUMNS]
    identifiers = df[identifier_cols].copy()
    X = df[FEATURE_COLUMNS].copy()

    print(f"Loaded {len(df)} rows, {len(FEATURE_COLUMNS)} features, "
          f"{len(identifier_cols)} identifier columns: {identifier_cols}")

    # ---------- 2. Fit StandardScaler, save as scaler.pkl ----------
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    joblib.dump(scaler, os.path.join(output_dir, "scaler.pkl"))
    print("Saved scaler.pkl")

    # ---------- 3. Train Isolation Forest ----------
    iso_forest = IsolationForest(
        contamination=CONTAMINATION,
        random_state=RANDOM_SEED,
        n_estimators=200,
    )
    iso_forest.fit(X_scaled)

    # score_samples: lower = more anomalous -> flip sign so higher = more anomalous
    iso_raw_scores = -iso_forest.score_samples(X_scaled)
    print("Trained Isolation Forest")

    # ---------- 4. Train Keras Autoencoder ----------
    X_train, X_val = train_val_split(X_scaled, val_fraction=0.2, seed=RANDOM_SEED)

    autoencoder = build_autoencoder(input_dim=X_scaled.shape[1])
    early_stop = callbacks.EarlyStopping(
        monitor="val_loss", patience=10, restore_best_weights=True
    )

    history = autoencoder.fit(
        X_train, X_train,
        validation_data=(X_val, X_val),
        epochs=200,
        batch_size=32,
        callbacks=[early_stop],
        verbose=0,
    )
    print(f"Trained Autoencoder for {len(history.history['loss'])} epochs "
          f"(early stopping patience=10)")

    print("\nTraining loss curve (epoch: train_loss -> val_loss):")
    for epoch, (train_loss, val_loss) in enumerate(
        zip(history.history["loss"], history.history["val_loss"]), start=1
    ):
        print(f"  epoch {epoch:3d}: {train_loss:.5f} -> {val_loss:.5f}")

    # reconstruction error on the FULL dataset (not just val split) for scoring
    reconstructions = autoencoder.predict(X_scaled, verbose=0)
    ae_raw_scores = np.mean(np.square(X_scaled - reconstructions), axis=1)

    # ---------- 5. Normalize both to 0-100 risk scores ----------
    iso_risk_score = percentile_scale(iso_raw_scores)
    ae_risk_score = percentile_scale(ae_raw_scores)
    combined_risk_score = (iso_risk_score + ae_risk_score) / 2

    # ---------- 6. Save models ----------
    autoencoder.save(os.path.join(output_dir, "model.h5"))
    joblib.dump(iso_forest, os.path.join(output_dir, "isolation_forest.pkl"))
    print("Saved model.h5 and isolation_forest.pkl")

    # ---------- 7. Save feature column order ----------
    with open(os.path.join(output_dir, "feature_columns.json"), "w") as f:
        json.dump(FEATURE_COLUMNS, f, indent=2)
    print("Saved feature_columns.json")

    # ---------- Score distribution stats ----------
    scores_df = pd.DataFrame({
        "isolation_forest_risk": iso_risk_score,
        "autoencoder_risk": ae_risk_score,
        "combined_risk": combined_risk_score,
    })
    print("\nRisk score distribution stats:")
    print(scores_df.describe())

    # bonus: write out a scored CSV joining identifiers + risk scores
    scored_output = pd.concat([identifiers.reset_index(drop=True), scores_df], axis=1)
    scored_path = os.path.join(output_dir, "customer_risk_scores.csv")
    scored_output.to_csv(scored_path, index=False)
    print(f"\nSaved scored output to {scored_path}")


def train_val_split(X: np.ndarray, val_fraction: float = 0.2, seed: int = 42):
    rng = np.random.default_rng(seed)
    n = X.shape[0]
    idx = rng.permutation(n)
    val_size = int(n * val_fraction)
    val_idx, train_idx = idx[:val_size], idx[val_size:]
    return X[train_idx], X[val_idx]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Isolation Forest + Autoencoder risk models.")
    parser.add_argument("--input", default="../data/customer_features.csv",
                         help="Path to customer_features.csv")
    parser.add_argument("--output-dir", default=".",
                         help="Directory to save model artifacts (scaler.pkl, model.h5, etc.)")
    args = parser.parse_args()
    main(args.input, args.output_dir)