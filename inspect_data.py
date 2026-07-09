import pandas as pd

df1 = pd.read_csv('data/order_dataset.csv')
df2 = pd.read_csv('data/ecommerce_customer_behavior_5000.csv')

print("DATASET 1:", df1.shape)
print(df1.columns.tolist())
print(df1.head(3))
print()

print("DATASET 2:", df2.shape)
print(df2.columns.tolist())
print(df2.head(3))