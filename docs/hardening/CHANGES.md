# FraudShield Hardening Changes Log

This document records the exact changes made to the codebase during the hardening sprint.

## 1. Database Configuration
- Updated `.env` and `src/db/index.js` to strictly enforce Neon PostgreSQL connections.
- Mapped table schemas (`fraud_cases`, `shipments`) to ensure the Node backend accurately matches the Django Operations Dashboard schema.

## 2. API Routes
- Added `POST /api/rules/evaluate` for standalone deterministic rule evaluation.
- Added `POST /api/risk/calculate` for final aggregate risk math calculation.
- Added `POST /api/demo/upload` for bulk CSV ingestion testing.

## 3. Rules Engine Refactoring
- Created `src/rules/constants/rules.js` to externalize hardcoded rules.
- Created `src/rules/validateRules.js` with `Joi` schema validation.
- Updated `src/rules/ruleEngine.js` to import external rules and run startup validation.

## 4. Frontend Updates
- Modified `Simulator.jsx` to include a CSV file input and upload handler.
- Integrated the batch CSV route with UI alerts to display processing statistics (Critical, High, Medium, Low totals).

## 5. Script Updates
- Added `scripts/generate_demo_csv.js` to automatically generate `demo_shipments.csv` with injected fraud clusters (20% fraud rate).
- Added `scripts/validate_pipeline.js` as an end-to-end node integration test against the running pipeline.
- Added `validate` command to `package.json` scripts.

## 6. Model / Scoring Math
- Fixed score clamping in `src/services/riskAggregator.js`.
- Fixed missing `identity.is_familiar` in `src/features/featureSchema.js` which caused validation errors.
- Fixed `_persistEntities` in `fraudScreeningService.js` to properly respect the `simulate: true` flag and skip locking database inserts for pure simulations, whilst falling back to actual inserts when populating the dashboard.
