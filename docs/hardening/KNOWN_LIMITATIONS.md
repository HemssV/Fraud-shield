# Known Limitations

This document lists known limitations and technical debt in the `hardening-v1` release of FraudShield.

## 1. Machine Learning Model Scalability
- **Limitation**: The current XGBoost model runs as a synchronous Python microservice (FastAPI/Uvicorn) called via HTTP during the Node pipeline.
- **Impact**: In a high-throughput environment (e.g., thousands of transactions per second), this synchronous HTTP call introduces a significant bottleneck and point of failure.
- **Resolution Path**: Decouple the ML scoring to an asynchronous Kafka topic or move the model inference directly into Node using ONNX runtime.

## 2. Rule Engine Cold Starts
- **Limitation**: The rule engine is instantiated and runs rules completely synchronously. Currently, there is no AST compilation or pre-compilation of rules.
- **Impact**: With 20 rules, it is fast enough, but scaling to 500+ complex rules with Regex evaluations will degrade the latency of the `/api/fraud/screen` endpoint.
- **Resolution Path**: Compile rules into WebAssembly (Wasm) or use a highly optimized engine like JSONRulesEngine.

## 3. Database Locks
- **Limitation**: The pipeline uses `pg_try_advisory_lock(hashtext($1))` based on `shipment_id`.
- **Impact**: While this prevents race conditions for the exact same shipment, if the Node process crashes mid-request, the lock isn't freed until the DB connection is returned or times out, potentially blocking retries.
- **Resolution Path**: Implement lock timeouts and graceful shutdown handlers to release advisory locks explicitly.

## 4. Frontend Polling
- **Limitation**: The frontend dashboard polls the backend or relies on manual refreshes.
- **Impact**: Not true real-time.
- **Resolution Path**: Add WebSockets / Server-Sent Events (SSE) to push live risk assessments directly to the dashboard React app.
