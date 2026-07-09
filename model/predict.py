"""
predict.py

Inference wrapper for retail return fraud risk scoring.

Contract:
    def predict_risk(features: dict) -> dict

Input:
    dict with exactly these 6 feature keys:
        return_rate
        refund_frequency
        high_value_return_ratio
        version_diversity
        category_diversity
        avg_transaction_value

Output:
    {
        "score": int 0-100,
        "reasons": [str, str, str],
        "is_high_risk": bool
    }
"""

import json
import os

import joblib
import numpy as np
import pandas as pd
import shap
from tensorflow import keras


MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
HIGH_RISK_THRESHOLD = 85

FEATURE_REASON_TEXT = {
    "return_rate": "High return rate compared with normal buyer behavior",
    "refund_frequency": "Frequent refund activity detected",
    "high_value_return_ratio": "Large share of returns are high-value items",
    "version_diversity": "Returns span many product versions or variants",
    "category_diversity": "Returns span unusually diverse product categories",
    "avg_transaction_value": "High average transaction value increases refund risk",
}


def _load_artifacts():
    scaler = joblib.load(os.path.join(MODEL_DIR, "scaler.pkl"))
    isolation_forest = joblib.load(os.path.join(MODEL_DIR, "isolation_forest.pkl"))

    autoencoder = keras.models.load_model(
        os.path.join(MODEL_DIR, "model.h5"),
        compile=False,
    )

    with open(os.path.join(MODEL_DIR, "feature_columns.json"), "r") as f:
        feature_columns = json.load(f)

    return scaler, isolation_forest, autoencoder, feature_columns


SCALER, ISOLATION_FOREST, AUTOENCODER, FEATURE_COLUMNS = _load_artifacts()
SHAP_EXPLAINER = shap.TreeExplainer(ISOLATION_FOREST)


def _validate_features(features: dict) -> None:
    missing = [col for col in FEATURE_COLUMNS if col not in features]
    extra = [col for col in features if col not in FEATURE_COLUMNS]

    if missing:
        raise ValueError(f"Missing required feature keys: {missing}")

    if extra:
        raise ValueError(f"Unexpected feature keys: {extra}")


def _to_model_input(features: dict):
    row = pd.DataFrame([[features[col] for col in FEATURE_COLUMNS]], columns=FEATURE_COLUMNS)
    scaled = SCALER.transform(row)
    return row, scaled


def _score_customer(x_scaled: np.ndarray) -> int:
    # Isolation Forest: lower decision_function = more anomalous.
    iso_decision = ISOLATION_FOREST.decision_function(x_scaled)[0]
    iso_risk = 1.0 / (1.0 + np.exp(12.0 * iso_decision))

    reconstruction = AUTOENCODER.predict(x_scaled, verbose=0)
    reconstruction_error = np.mean(np.square(x_scaled - reconstruction), axis=1)[0]

    # Smoothly map reconstruction error to 0-1.
    ae_risk = 1.0 - np.exp(-reconstruction_error)

    combined = (0.5 * iso_risk) + (0.5 * ae_risk)
    score = int(round(np.clip(combined * 100, 0, 100)))

    return score


def _top_shap_reasons(x_scaled: np.ndarray) -> list[str]:
    shap_values = SHAP_EXPLAINER.shap_values(x_scaled)

    if isinstance(shap_values, list):
        shap_values = shap_values[0]

    shap_values = np.asarray(shap_values)

    if shap_values.ndim == 3:
        shap_values = shap_values[0, :, 0]
    else:
        shap_values = shap_values[0]

    top_indices = np.argsort(np.abs(shap_values))[::-1][:3]

    reasons = []
    for idx in top_indices:
        feature_name = FEATURE_COLUMNS[idx]
        reasons.append(FEATURE_REASON_TEXT.get(feature_name, f"{feature_name} contributed to risk"))

    while len(reasons) < 3:
        reasons.append("Anomalous pattern detected across customer return behavior")

    return reasons[:3]


def predict_risk(features: dict) -> dict:
    _validate_features(features)

    _, x_scaled = _to_model_input(features)

    score = _score_customer(x_scaled)
    reasons = _top_shap_reasons(x_scaled)
    is_high_risk = score >= HIGH_RISK_THRESHOLD

    return {
        "score": score,
        "reasons": reasons,
        "is_high_risk": is_high_risk,
    }


if __name__ == "__main__":
    sample_features = {
        "return_rate": 0.95,
        "refund_frequency": 18,
        "high_value_return_ratio": 0.90,
        "version_diversity": 12,
        "category_diversity": 6,
        "avg_transaction_value": 450.0,
    }

    result = predict_risk(sample_features)
    print(result)