"""
inspect_top_risk_customers.py

Merges customer_risk_scores.csv (scores) with customer_features.csv (raw
features) to show WHY the top-risk customers were flagged.
"""

import pandas as pd

pd.set_option("display.max_columns", None)
pd.set_option("display.width", 200)

scores_df = pd.read_csv("customer_risk_scores.csv")
features_df = pd.read_csv("../data/customer_features.csv")

# Merge on Buyer ID
merged = scores_df.merge(features_df, on="Buyer ID", how="left")

feature_columns = [
    "return_rate",
    "refund_frequency",
    "high_value_return_ratio",
    "version_diversity",
    "category_diversity",
    "avg_transaction_value",
]

display_cols = ["Buyer ID"] + [c for c in feature_columns if c in merged.columns] + ["combined_risk"]

top15 = merged.sort_values("combined_risk", ascending=False).head(15)

print("Top 15 highest-risk real customers")
print("===================================")
print(top15[display_cols].to_string(index=False))

print("\nFor comparison — median customer (typical, low-suspicion) profile:")
median_row = merged.iloc[(merged["combined_risk"] - merged["combined_risk"].median()).abs().argsort()[:1]]
print(median_row[display_cols].to_string(index=False))