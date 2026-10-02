# FraudShield ML Module

## Setup

1. Use Windows PowerShell.
2. Create and activate a virtual environment:
   ```powershell
   python -m venv venv
   .\venv\Scripts\activate
   ```
3. Install requirements:
   ```powershell
   pip install -r requirements.txt
   ```

## Workflow

- **Generate Synthetic Data**: `python -m ml.data.generate --n-shippers 2000 --days 180 --out ml/data/out`
- **Train Models**: `python -m ml.models.train`
- **Evaluate Models**: `python -m ml.models.evaluate`
- **Run API Service**: `python -m uvicorn ml.service.app:app --host 0.0.0.0 --port 8001`
- **Demo Scenarios**: `python -m ml.scripts.demo_scenarios`
- **Retrain with Feedback**: `python -m ml.scripts.retrain`
