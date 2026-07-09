from predict import predict_risk


sample_features = {
    "return_rate": 0.95,
    "refund_frequency": 18,
    "high_value_return_ratio": 0.90,
    "version_diversity": 12,
    "category_diversity": 6,
    "avg_transaction_value": 450.0,
}


result = predict_risk(sample_features)

print("Prediction result:")
print(result)