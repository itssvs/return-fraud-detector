import os
import hashlib
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from app.model_stub import predict_risk

load_dotenv()

app = FastAPI(title="Retail Return Fraud Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MongoDB setup ---
MONGODB_URI = os.getenv("MONGODB_URI")
client = AsyncIOMotorClient(MONGODB_URI)
db = client["fraud_detection"]
predictions_collection = db["predictions"]


class CustomerInput(BaseModel):
    customer_id: str
    phone_number: str
    return_rate: float
    refund_frequency: float
    high_value_return_ratio: float
    version_diversity: int
    category_diversity: int
    avg_transaction_value: float


def get_risk_level(score: int) -> str:
    if score < 40:
        return "Low"
    elif score < 70:
        return "Medium"
    else:
        return "High"


def hash_phone(phone_number: str) -> str:
    return hashlib.sha256(phone_number.encode()).hexdigest()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
async def predict(input: CustomerInput):
    features = {
        "return_rate": input.return_rate,
        "refund_frequency": input.refund_frequency,
        "high_value_return_ratio": input.high_value_return_ratio,
        "version_diversity": input.version_diversity,
        "category_diversity": input.category_diversity,
        "avg_transaction_value": input.avg_transaction_value,
    }

    result = predict_risk(features)
    score = result["score"]
    risk_level = get_risk_level(score)
    timestamp = datetime.now(timezone.utc).isoformat()

    response = {
        "customer_id": input.customer_id,
        "risk_score": score,
        "risk_level": risk_level,
        "reasons": result["reasons"],
        "timestamp": timestamp,
    }

    # Store in MongoDB
    document = {
        "customer_id": input.customer_id,
        "phone_hash": hash_phone(input.phone_number),
        "risk_score": score,
        "risk_level": risk_level,
        "reasons": result["reasons"],
        "input_features": features,
        "timestamp": timestamp,
    }
    await predictions_collection.insert_one(document)

    return response


@app.get("/history/{customer_id}")
async def get_history_for_customer(customer_id: str):
    cursor = predictions_collection.find(
        {"customer_id": customer_id}, {"_id": 0}
    ).sort("timestamp", -1)
    results = await cursor.to_list(length=50)
    return results


@app.get("/history")
async def get_history():
    cursor = predictions_collection.find({}, {"_id": 0}).sort("timestamp", -1)
    results = await cursor.to_list(length=50)
    return results