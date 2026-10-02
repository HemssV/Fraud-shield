import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "out"
ARTIFACTS_DIR = BASE_DIR / "artifacts"
DOCS_DIR = BASE_DIR / "docs"

# Ensure dirs exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

# Service Config
PORT = int(os.getenv("PORT", 8001))
MODEL_VERSION = "v1"

# Seeds
DEFAULT_SEED = 42

# Global thresholds (can be overwritten by policy.py)
FRAUD_THRESHOLD = 0.5
