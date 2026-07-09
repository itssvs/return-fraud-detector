import hashlib
import os
import sys
from datetime import datetime, timezone
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from deep_translator import GoogleTranslator

from app.local_db import (
    count_by_risk_level,
    get_all_predictions,
    get_average_risk_score,
    get_filtered_customers,
    get_history,
    get_prediction,
    get_predictions_by_phone_hash,
    upsert_prediction,
    upsert_predictions_bulk,
)

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
MODEL_DIR = os.path.join(PROJECT_ROOT, "model")
DATA_PATH = os.path.join(PROJECT_ROOT, "data", "customer_features.csv")

sys.path.append(MODEL_DIR)

from predict import predict_risk, predict_risk_batch  # noqa: E402


FEATURE_COLUMNS = [
    "return_rate",
    "refund_frequency",
    "high_value_return_ratio",
    "version_diversity",
    "category_diversity",
    "avg_transaction_value",
]
LANGUAGE_CODES = {
    "English": "en",
    "Hindi": "hi",
    "Spanish": "es",
    "French": "fr",
    "Tamil": "ta",
    "Telugu": "te",
    "Kannada": "kn",
    "Malayalam": "ml",
    "Bengali": "bn",
    "Marathi": "mr",
}


app = FastAPI(title="Return Fraud Detection API")


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    customer_id: str
    phone_number: str
    return_rate: float
    refund_frequency: float
    high_value_return_ratio: float
    version_diversity: float
    category_diversity: float
    avg_transaction_value: float
class TranslateRequest(BaseModel):
    target_language: str
    content: dict

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def phone_hash(phone_number: str) -> str:
    return hashlib.sha256(str(phone_number).encode("utf-8")).hexdigest()


def risk_level_from_score(score: int) -> str:
    if score < 40:
        return "Low"

    if score < 70:
        return "Medium"

    return "High"


def extract_features(payload: PredictRequest) -> dict:
    return {
        "return_rate": payload.return_rate,
        "refund_frequency": payload.refund_frequency,
        "high_value_return_ratio": payload.high_value_return_ratio,
        "version_diversity": payload.version_diversity,
        "category_diversity": payload.category_diversity,
        "avg_transaction_value": payload.avg_transaction_value,
    }


def find_column(df: pd.DataFrame, candidates: list[str]) -> Optional[str]:
    normalized = {col.lower().replace(" ", "_"): col for col in df.columns}

    for candidate in candidates:
        key = candidate.lower().replace(" ", "_")
        if key in normalized:
            return normalized[key]

    return None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "storage": "local_json",
        "model_loaded": True,
    }


@app.post("/predict")
def predict(payload: PredictRequest):
    features = extract_features(payload)
    result = predict_risk(features)

    score = int(result["score"])
    risk_level = risk_level_from_score(score)
    timestamp = now_iso()

    doc = {
        "customer_id": payload.customer_id,
        "phone_number": payload.phone_number,
        "phone_hash": phone_hash(payload.phone_number),
        "features": features,
        "risk_score": score,
        "risk_level": risk_level,
        "reasons": result["reasons"],
        "timestamp": timestamp,
    }

    upsert_prediction(payload.customer_id, doc)

    return {
        "customer_id": payload.customer_id,
        "risk_score": score,
        "risk_level": risk_level,
        "reasons": result["reasons"],
        "timestamp": timestamp,
    }


@app.get("/history/{customer_id}")
def customer_history(customer_id: str):
    return get_history(customer_id)


@app.get("/history")
def all_history():
    return get_history()

@app.post("/score-all-customers")
def score_all_customers():
    if not os.path.exists(DATA_PATH):
        raise HTTPException(status_code=500, detail=f"Missing data file: {DATA_PATH}")

    df = pd.read_csv(DATA_PATH)

    missing = [col for col in FEATURE_COLUMNS if col not in df.columns]
    if missing:
        raise HTTPException(status_code=500, detail=f"Missing feature columns: {missing}")

    customer_id_col = find_column(df, ["customer_id", "buyer_id", "Buyer ID", "Source Buyer ID"])
    phone_col = find_column(df, ["phone_number", "Phone Number", "phone"])

    if customer_id_col is None:
        raise HTTPException(status_code=500, detail="Could not find customer id column")

    if phone_col is None:
        raise HTTPException(status_code=500, detail="Could not find phone number column")

    scored_df = predict_risk_batch(df[FEATURE_COLUMNS].copy())

    high_risk_count = 0
    medium_risk_count = 0
    low_risk_count = 0
    timestamp = now_iso()
    docs_to_save = []

    for idx, row in df.iterrows():
        score = int(scored_df.loc[idx, "score"])
        risk_level = risk_level_from_score(score)

        if risk_level == "High":
            high_risk_count += 1
        elif risk_level == "Medium":
            medium_risk_count += 1
        else:
            low_risk_count += 1

        customer_id = str(row[customer_id_col])
        phone_number = str(row[phone_col])

        features = {
            col: float(row[col])
            for col in FEATURE_COLUMNS
        }

        reasons = scored_df.loc[idx, "reasons"] if "reasons" in scored_df.columns else ["Click for detailed reasons"]
        if not isinstance(reasons, list):
            reasons = ["Click for detailed reasons"]

        docs_to_save.append({
            "customer_id": customer_id,
            "phone_number": phone_number,
            "phone_hash": phone_hash(phone_number),
            "features": features,
            "risk_score": score,
            "risk_level": risk_level,
            "reasons": reasons,
            "timestamp": timestamp,
        })

    upsert_predictions_bulk(docs_to_save)

    return {
        "total_scored": len(df),
        "high_risk_count": high_risk_count,
        "medium_risk_count": medium_risk_count,
        "low_risk_count": low_risk_count,
    }
@app.get("/dashboard/summary")
def dashboard_summary():
    predictions = get_all_predictions()

    high_risk_count = 0
    medium_risk_count = 0
    low_risk_count = 0
    total_score = 0.0

    for doc in predictions:
        risk_level = doc.get("risk_level")
        risk_score = float(doc.get("risk_score", 0) or 0)

        total_score += risk_score

        if risk_level == "High":
            high_risk_count += 1
        elif risk_level == "Medium":
            medium_risk_count += 1
        elif risk_level == "Low":
            low_risk_count += 1

    total_customers = len(predictions)
    avg_risk_score = total_score / total_customers if total_customers else 0.0

    return {
        "total_customers": total_customers,
        "high_risk_count": high_risk_count,
        "medium_risk_count": medium_risk_count,
        "low_risk_count": low_risk_count,
        "avg_risk_score": avg_risk_score,
    }
        
@app.get("/dashboard/customers")
def dashboard_customers(
    risk_level: Optional[str] = Query(default=None),
    sort_by: str = Query(default="risk_score"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1),
):
    return get_filtered_customers(
        risk_level=risk_level,
        sort_by=sort_by,
        page=page,
        page_size=page_size,
    )


@app.get("/dashboard/customer/{customer_id}")
def dashboard_customer(customer_id: str):
    doc = get_prediction(customer_id)

    if doc is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    features = doc.get("features")
    if not features:
        raise HTTPException(status_code=500, detail="Customer features missing")

    detailed_result = predict_risk(features)

    score = int(detailed_result["score"])
    risk_level = risk_level_from_score(score)

    updated_doc = dict(doc)
    updated_doc["risk_score"] = score
    updated_doc["risk_level"] = risk_level
    updated_doc["reasons"] = detailed_result["reasons"]
    updated_doc["timestamp"] = now_iso()

    upsert_prediction(customer_id, updated_doc)

    return updated_doc


@app.get("/dashboard/linked-accounts/{phone_hash}")
def dashboard_linked_accounts(phone_hash: str):
    linked_accounts = get_predictions_by_phone_hash(phone_hash)

    if not linked_accounts:
        raise HTTPException(status_code=404, detail="No linked accounts found")

    scores = [float(doc.get("risk_score", 0)) for doc in linked_accounts]
    aggregate_risk_score = sum(scores) / len(scores) if scores else 0.0

    platforms = sorted(
        {
            str(doc.get("platform") or doc.get("record_type") or doc.get("source") or "unknown")
            for doc in linked_accounts
        }
    )

    return {
        "phone_hash": phone_hash,
        "linked_accounts": linked_accounts,
        "aggregate_risk_score": aggregate_risk_score,
        "platforms_flagged_on": platforms,
    }
@app.get("/dashboard/customer/{customer_id}/recommendations")
def customer_policy_recommendations(customer_id: str):
    doc = get_prediction(customer_id)

    if doc is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    features = doc.get("features", {})
    reasons = doc.get("reasons", [])
    score = int(doc.get("risk_score", 0))
    level = doc.get("risk_level", "Low")
    linked_accounts = get_predictions_by_phone_hash(doc.get("phone_hash", ""))

    recommendations = []

    if level == "High" or score >= 70:
        recommendations.append({
            "title": "Apply stricter return controls",
            "action": "Shorten the return window and route refunds to manual review.",
            "reason": f"This customer is flagged {level} risk with score {score}.",
            "severity": "High",
            "confidence": min(95, score + 5),
        })

    if len(linked_accounts) > 1:
        recommendations.append({
            "title": "Monitor linked accounts",
            "action": "Review accounts sharing the same phone hash before approving refunds.",
            "reason": f"{len(linked_accounts)} accounts share the same hashed phone number.",
            "severity": "High",
            "confidence": 90,
        })

    if features.get("refund_frequency", 0) >= 40:
        recommendations.append({
            "title": "Require refund verification",
            "action": "Require receipt, order ID, and item condition verification.",
            "reason": "Refund frequency is unusually high for this customer.",
            "severity": "Medium",
            "confidence": 85,
        })

    if features.get("high_value_return_ratio", 0) >= 1:
        recommendations.append({
            "title": "Disable instant refunds for high-value items",
            "action": "Hold high-value refunds until the returned item is inspected.",
            "reason": "High-value return ratio is elevated.",
            "severity": "High",
            "confidence": 88,
        })

    if features.get("version_diversity", 0) >= 3:
        recommendations.append({
            "title": "Inspect variant-swapping behavior",
            "action": "Compare SKU, version, and serial details before accepting returns.",
            "reason": "Returns span multiple product versions or variants.",
            "severity": "Medium",
            "confidence": 80,
        })

    if not recommendations:
        recommendations.append({
            "title": "Maintain standard return policy",
            "action": "Allow normal return flow with routine monitoring.",
            "reason": "No strong policy adjustment signal was found.",
            "severity": "Low",
            "confidence": 75,
        })

    return {
        "customer_id": customer_id,
        "recommendations": recommendations[:5],
        "signals_used": {
            "risk_score": score,
            "risk_level": level,
            "reasons": reasons,
            "linked_account_count": len(linked_accounts),
        },
    }


@app.post("/translate")
def translate_content(payload: TranslateRequest):
    target_code = LANGUAGE_CODES.get(payload.target_language)

    if not target_code:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language: {payload.target_language}",
        )

    if target_code == "en":
        return {
            "target_language": payload.target_language,
            "translated_content": payload.content,
        }

    translator = GoogleTranslator(source="auto", target=target_code)

    translated = {}

    for key, value in payload.content.items():
        if isinstance(value, str):
            translated[key] = translator.translate(value)
        else:
            translated[key] = value

    return {
        "target_language": payload.target_language,
        "translated_content": translated,
    }
@app.get("/dashboard/risk-histogram")
async def risk_histogram():
    all_predictions = get_all_predictions()

    buckets = {"0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0}
    reason_counts = {}

    for doc in all_predictions:
        score = doc.get("risk_score", 0)
        if score < 20:
            buckets["0-20"] += 1
        elif score < 40:
            buckets["20-40"] += 1
        elif score < 60:
            buckets["40-60"] += 1
        elif score < 80:
            buckets["60-80"] += 1
        else:
            buckets["80-100"] += 1

        for reason in doc.get("reasons", []):
            if reason and reason != "Click for detailed reasons":
                reason_counts[reason] = reason_counts.get(reason, 0) + 1

    top_reasons = sorted(reason_counts.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "histogram": [{"range": k, "count": v} for k, v in buckets.items()],
        "top_reasons": [{"reason": r, "count": c} for r, c in top_reasons],
    }