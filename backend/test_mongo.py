import os
import certifi
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

uri = os.getenv("MONGODB_URI")

client = MongoClient(uri, tlsCAFile=certifi.where())

try:
    client.admin.command("ping")
    print("MongoDB connection successful!")
except Exception as e:
    print("Connection failed:", e)