# FraudShield Hardening Decisions

This document logs the architectural and implementation decisions made during the `hardening-v1` phase.

## 1. Neon Database Integration
- **Decision**: Fully integrated Neon Postgres for primary persistence, removing in-memory and mock fallbacks for all critical paths.
- **Rationale**: The hackathon prototype used mock data and arrays which were not thread-safe or persistent across restarts. Moving to Neon ensures ACID compliance, real persistence, and a unified data source for both the backend node app and the Django Operations dashboard.
- **Trade-offs**: Introduces network latency (DB roundtrips) during the synchronous screening pipeline. Mitigated by indexing (`shipments.booking_ref`, `fraud_cases.shipment_id`) and parallel DB calls where possible.

## 2. Rule Engine Centralization
- **Decision**: Centralized all deterministic rules into `src/rules/constants/rules.js` and added startup validation via Joi in `validateRules.js`.
- **Rationale**: Hardcoded rules scattered in logic made the engine brittle. A centralized constant file with validation ensures all rules have correct properties (category, risk_points, evaluation functions) and fail fast on startup if a rule is malformed.
- **Trade-offs**: Startup validation adds negligible time, but ensures runtime safety.

## 3. Score Normalization & Fluctuation Fix
- **Decision**: Enforced hard clamping (`Math.min(100, Math.max(0, score))`) in `aggregateRisk` and added the missing rules (`HIGH_RISK_ROUTE`, `EXTREME_WEIGHT`) to ensure the maximum theoretical score is reachable and stable.
- **Rationale**: Prior to this fix, scores fluctuated due to dynamic array parsing and missing rule logic. The deterministic nature of the scoring engine must be guaranteed for compliance.
- **Trade-offs**: Clamping hides extreme risk outliers (e.g. 150 points becomes 100), but standardizes the output to a 0-100 scale for downstream ML and dashboard consumption.

## 4. Batch Simulation & Upload Pipeline
- **Decision**: Added a dedicated `api/demo/upload` endpoint and a frontend CSV injection UI to run bulk simulations.
- **Rationale**: Allows rapid load testing and data generation for the dashboard, mimicking real-world velocity spikes. The `simulate` flag was updated so that batch uploads can optionally persist to the DB for dashboard visibility.

## 5. Environment & Secrets Management
- **Decision**: Removed hardcoded secrets (Gemini API keys, DB URIs) and enforced strict `.env` loading.
- **Rationale**: Security best practices. Mock fallbacks remain *only* if the GenAI API key is strictly missing, preventing pipeline crashes while alerting operators.
