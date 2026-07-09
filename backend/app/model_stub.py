import random


def predict_risk(features: dict) -> dict:
    score = random.randint(0, 100)

    possible_reasons = [
        "Unusually high return rate compared to peer group",
        "Frequent refund requests within short time windows",
        "High ratio of high-value item returns",
        "Returns across many different product versions",
        "Returns spanning multiple unrelated categories",
        "Transaction values inconsistent with return pattern",
        "Refund frequency spike detected in recent activity",
        "Return behavior deviates from historical baseline",
    ]

    reasons = random.sample(possible_reasons, 3)

    return {
        "score": score,
        "reasons": reasons,
        "is_high_risk": score > 70,
    }