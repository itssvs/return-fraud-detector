"""
local_db.py

Local JSON-backed storage layer used as a MongoDB replacement for the
hackathon demo backend.

Stores prediction documents in one JSON file on disk and exposes helper
functions that mimic the MongoDB operations used by app/main.py.
"""

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from typing import Any, Optional


DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local_predictions.json")
_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_safe(value: Any) -> Any:
    """
    Convert numpy/pandas scalar values into plain JSON-safe Python values.
    Keeps this module usable with model outputs and dataframe rows.
    """
    if hasattr(value, "item"):
        return value.item()

    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}

    if isinstance(value, list):
        return [_json_safe(v) for v in value]

    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]

    return value


def _empty_db() -> dict:
    return {
        "predictions": {},
        "history": [],
    }


def _read_db() -> dict:
    if not os.path.exists(DB_PATH):
        return _empty_db()

    try:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty_db()

    if not isinstance(data, dict):
        return _empty_db()

    data.setdefault("predictions", {})
    data.setdefault("history", [])

    return data


def _write_db(data: dict) -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    fd, temp_path = tempfile.mkstemp(
        prefix="local_predictions_",
        suffix=".json",
        dir=os.path.dirname(DB_PATH),
    )

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, DB_PATH)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def upsert_prediction(customer_id: str, prediction_doc: dict) -> dict:
    """
    Insert or replace the latest prediction document for a customer_id.
    Also appends a snapshot into history for audit/history endpoints.
    """
    if customer_id is None:
        raise ValueError("customer_id is required")

    customer_id = str(customer_id)
    doc = _json_safe(dict(prediction_doc))
    doc["customer_id"] = customer_id
    doc.setdefault("timestamp", _now_iso())

    with _LOCK:
        data = _read_db()
        data["predictions"][customer_id] = doc
        data["history"].append(doc)
        _write_db(data)

    return doc
def upsert_predictions_bulk(prediction_docs: list[dict]) -> list[dict]:
    """
    Insert/replace many prediction documents and write to disk once.
    Used by /score-all-customers to avoid thousands of Windows file writes.
    """
    saved_docs = []

    with _LOCK:
        data = _read_db()

        for prediction_doc in prediction_docs:
            if "customer_id" not in prediction_doc:
                raise ValueError("Each prediction document needs customer_id")

            customer_id = str(prediction_doc["customer_id"])
            doc = _json_safe(dict(prediction_doc))
            doc["customer_id"] = customer_id
            doc.setdefault("timestamp", _now_iso())

            data["predictions"][customer_id] = doc
            data["history"].append(doc)
            saved_docs.append(doc)

        _write_db(data)

    return saved_docs


def get_all_predictions() -> list[dict]:
    """Return latest prediction document for every customer."""
    with _LOCK:
        data = _read_db()

    return list(data["predictions"].values())


def get_prediction(customer_id: str) -> Optional[dict]:
    """Return latest prediction document for one customer_id."""
    if customer_id is None:
        return None

    with _LOCK:
        data = _read_db()

    return data["predictions"].get(str(customer_id))


def get_predictions_by_phone_hash(phone_hash: str) -> list[dict]:
    """Return all latest prediction docs matching a phone_hash."""
    if not phone_hash:
        return []

    phone_hash = str(phone_hash)

    return [
        doc
        for doc in get_all_predictions()
        if str(doc.get("phone_hash", "")) == phone_hash
    ]


def get_history(customer_id: Optional[str] = None) -> list[dict]:
    """
    Return prediction history sorted newest first.
    If customer_id is provided, return only that customer's history.
    """
    with _LOCK:
        data = _read_db()

    rows = data["history"]

    if customer_id is not None:
        customer_id = str(customer_id)
        rows = [doc for doc in rows if str(doc.get("customer_id")) == customer_id]

    return sorted(rows, key=lambda doc: doc.get("timestamp", ""), reverse=True)


def count_by_risk_level() -> dict:
    """Return counts grouped by Low/Medium/High risk_level."""
    counts = {
        "Low": 0,
        "Medium": 0,
        "High": 0,
    }

    for doc in get_all_predictions():
        risk_level = doc.get("risk_level")
        if risk_level in counts:
            counts[risk_level] += 1

    return counts


def get_average_risk_score() -> float:
    """Return average risk_score across latest predictions."""
    predictions = get_all_predictions()
    scores = [
        float(doc.get("risk_score", 0))
        for doc in predictions
        if doc.get("risk_score") is not None
    ]

    if not scores:
        return 0.0

    return sum(scores) / len(scores)


def get_filtered_customers(
    risk_level: Optional[str] = None,
    sort_by: str = "risk_score",
    page: int = 1,
    page_size: int = 50,
) -> dict:
    """
    Return filtered, sorted, paginated latest customer predictions.

    Used by:
        GET /dashboard/customers?risk_level=&sort_by=&page=&page_size=
    """
    page = max(int(page or 1), 1)
    page_size = max(int(page_size or 50), 1)

    customers = get_all_predictions()

    if risk_level:
        customers = [
            doc for doc in customers
            if str(doc.get("risk_level", "")).lower() == str(risk_level).lower()
        ]

    reverse = True
    sort_key = sort_by or "risk_score"

    if sort_key.startswith("-"):
        sort_key = sort_key[1:]
        reverse = True

    allowed_sort_keys = {
        "customer_id",
        "risk_score",
        "risk_level",
        "timestamp",
        "phone_hash",
    }

    if sort_key not in allowed_sort_keys:
        sort_key = "risk_score"

    def key_func(doc: dict):
        value = doc.get(sort_key)

        if sort_key == "risk_score":
            return float(value or 0)

        return "" if value is None else str(value)

    customers = sorted(customers, key=key_func, reverse=reverse)

    total = len(customers)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "results": customers[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def clear_db() -> None:
    """
    Optional utility for local testing only.
    Do not call this from production/demo endpoints unless intentionally resetting.
    """
    with _LOCK:
        _write_db(_empty_db())