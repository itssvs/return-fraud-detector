import argparse
import numpy as np
import pandas as pd
from faker import Faker

RANDOM_SEED = 42
DUPLICATE_FRACTION = 0.15   # fraction of buyers to duplicate
DUPLICATES_PER_BUYER = 2    # extra "platform" records per selected buyer
PERTURBATION_STD = 0.05     # 5% gaussian noise on perturbed features

FEATURE_COLS = [
    "return_rate",
    "refund_frequency",
    "high_value_return_ratio",
    "version_diversity",
    "category_diversity",
    "avg_transaction_value",
]


def compute_buyer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate transaction-level data to one row per Buyer ID with 6 features."""

    grouped = df.groupby("Buyer ID").agg(
        refunded_sum=("Refunded Item Count", "sum"),
        purchased_sum=("Purchased Item Count", "sum"),
        total_transactions=("Transaction ID", "count"),
        refund_transactions=("Refunded Item Count", lambda x: (x < 0).sum()),
        neg_revenue_sum=("Overall Revenue", lambda x: x[x < 0].sum()),
        pos_revenue_sum=("Overall Revenue", lambda x: x[x > 0].sum()),
        version_diversity=("Version", "nunique"),
        category_diversity=("Category", "nunique"),
        avg_transaction_value=("Final Revenue", "mean"),
    ).reset_index()

    # return_rate = refunded qty / purchased qty, guarded against div-by-zero
    grouped["return_rate"] = np.where(
        grouped["purchased_sum"] != 0,
        grouped["refunded_sum"] / grouped["purchased_sum"],
        0.0,
    )

    # refund_frequency = % of transactions with a negative Refunded Item Count
    grouped["refund_frequency"] = np.where(
        grouped["total_transactions"] != 0,
        (grouped["refund_transactions"] / grouped["total_transactions"]) * 100,
        0.0,
    )

    # high_value_return_ratio = |sum of negative Overall Revenue| / sum of positive Overall Revenue
    grouped["high_value_return_ratio"] = np.where(
        grouped["pos_revenue_sum"] != 0,
        grouped["neg_revenue_sum"].abs() / grouped["pos_revenue_sum"],
        0.0,
    )

    # avg_transaction_value may be NaN if a buyer has no rows (shouldn't happen post-groupby)
    grouped["avg_transaction_value"] = grouped["avg_transaction_value"].fillna(0.0)

    features = grouped[["Buyer ID"] + FEATURE_COLS].copy()
    return features


def assign_phone_numbers(buyer_ids: pd.Series, seed: int = RANDOM_SEED) -> dict:
    """Assign one synthetic phone number per unique Buyer ID."""
    fake = Faker()
    Faker.seed(seed)
    return {buyer: fake.phone_number() for buyer in buyer_ids.unique()}


def simulate_cross_platform_duplicates(
    features: pd.DataFrame,
    fraction: float = DUPLICATE_FRACTION,
    n_duplicates: int = DUPLICATES_PER_BUYER,
    noise_std: float = PERTURBATION_STD,
    seed: int = RANDOM_SEED,
) -> pd.DataFrame:
    """
    Select `fraction` of buyers and create `n_duplicates` extra rows for each,
    reusing the same phone number but perturbing the numeric feature values
    to simulate the same person behaving slightly differently on another platform.
    """
    rng = np.random.default_rng(seed)

    sampled_buyers = features["Buyer ID"].sample(frac=fraction, random_state=seed)

    new_rows = []
    for buyer in sampled_buyers:
        base_row = features.loc[features["Buyer ID"] == buyer].iloc[0]
        for i in range(1, n_duplicates + 1):
            new_row = base_row.copy()
            new_row["Buyer ID"] = f"{buyer}_platform{i}"
            new_row["Source Buyer ID"] = buyer
            new_row["Record Type"] = f"platform_{i}"

            for col in FEATURE_COLS:
                noise_factor = rng.normal(loc=1.0, scale=noise_std)
                perturbed = base_row[col] * noise_factor
                # keep diversity counts as sensible non-negative integers
                if col in ("version_diversity", "category_diversity"):
                    perturbed = max(1, round(perturbed))
                new_row[col] = perturbed

            new_rows.append(new_row)

    duplicate_df = pd.DataFrame(new_rows)
    return duplicate_df


def main(input_path: str, output_path: str):
    df = pd.read_csv(input_path)

    # Normalize Buyer ID to a clean integer/string (avoids "1000661.0" formatting
    # that appears when the column is read in as float64 with no actual NaNs).
    if pd.api.types.is_float_dtype(df["Buyer ID"]) and df["Buyer ID"].isna().sum() == 0:
        df["Buyer ID"] = df["Buyer ID"].astype("int64").astype(str)
    else:
        df["Buyer ID"] = df["Buyer ID"].astype(str)

    features = compute_buyer_features(df)

    # tag original/primary records before combining with duplicates
    features["Source Buyer ID"] = features["Buyer ID"]
    features["Record Type"] = "primary"

    # assign a phone number per real (original) Buyer ID
    phone_map = assign_phone_numbers(features["Buyer ID"])
    features["Phone Number"] = features["Buyer ID"].map(phone_map)

    # build the synthetic cross-platform duplicate records
    duplicates = simulate_cross_platform_duplicates(features)
    if not duplicates.empty:
        # duplicates reference the original buyer's phone number
        duplicates["Phone Number"] = duplicates["Source Buyer ID"].map(phone_map)

    final_df = pd.concat([features, duplicates], ignore_index=True)

    # column order for readability
    ordered_cols = ["Buyer ID", "Source Buyer ID", "Record Type", "Phone Number"] + FEATURE_COLS
    final_df = final_df[ordered_cols]

    final_df.to_csv(output_path, index=False)
    print(f"Wrote {len(final_df)} rows ({features['Buyer ID'].nunique()} unique buyers, "
          f"{len(duplicates)} synthetic platform duplicates) to {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build buyer-level features with synthetic cross-platform duplicates.")
    parser.add_argument("--input", default="transactions.csv", help="Path to input transaction CSV")
    parser.add_argument("--output", default="customer_features.csv", help="Path to output CSV")
    args = parser.parse_args()
    main(args.input, args.output)