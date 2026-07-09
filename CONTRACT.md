# PROJECT CONTRACT — DO NOT DEVIATE WITHOUT A TEAM SYNC

This file is the single source of truth for names, shapes, and signatures.
Paste this entire file into your AI prompts whenever generating model, backend,
or frontend code. If your AI suggests renaming anything here, STOP — do not
accept the change, re-paste this file, and force it back in line.

---

## 1. Raw source columns

Dataset 1 (product-sales-returns.csv):
['Item Name', 'Category', 'Version', 'Item Code', 'Item ID', 'Buyer ID', 'Transaction ID', 'Date', 'Final Quantity', 'Total Revenue', 'Price Reductions', 'Refunds', 'Final Revenue', 'Sales Tax', 'Overall Revenue', 'Refunded Item Count', 'Purchased Item Count']

Dataset 2 (ecommerce-customer-behavior.csv):
['order_id', 'customer_age', 'customer_gender', 'product_category', 'payment_method', 'order_value_usd', 'delivery_time_days', 'customer_rating', 'returned', 'order_date']
(Note: no customer ID — used only for supplementary category/return-rate charts, not the core model.)

---

## 2. Engineered feature columns (exact names, exact order — LOCKED)

feature_columns = [
    "return_rate",
    "refund_frequency",
    "high_value_return_ratio",
    "version_diversity",
    "category_diversity",
    "avg_transaction_value"
]

---

## 3. Model artifact filenames (Person A delivers these to /model/)

- model.h5              (Keras Autoencoder)
- isolation_forest.pkl  (scikit-learn, joblib-saved)
- scaler.pkl            (StandardScaler, joblib-saved, fit on TRAIN split only)
- feature_columns.json  (list from section 2, as JSON)

---

## 4. predict_risk() function signature

def predict_risk(features: dict) -> dict:
    """
    Input:
      {
        "return_rate": float,
        "refund_frequency": float,
        "high_value_return_ratio": float,
        "version_diversity": int,
        "category_diversity": int,
        "avg_transaction_value": float
      }
    Output:
      {
        "score": int,          # 0-100
        "reasons": [str, str, str],
        "is_high_risk": bool
      }
    """

Person B builds a STUB version of this matching the exact signature and
return shape, using random/fake values, starting hour 0. Person A's real
version is swapped in later as a one-line import change.

---

## 5. API endpoint contracts

POST /predict
  Request body:
    {
      "customer_id": str,
      "phone_number": str,
      "return_rate": float,
      "refund_frequency": float,
      "high_value_return_ratio": float,
      "version_diversity": int,
      "category_diversity": int,
      "avg_transaction_value": float
    }
  Response body:
    {
      "customer_id": str,
      "risk_score":