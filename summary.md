# FraudShield Project Summary

## Overview
FraudShield is a dual-backend, AI-powered fraud detection system for logistics and package tracking. It screens incoming shipments to detect high-risk anomalies such as illicit cargo diversion, volume attacks, account takeovers, and fraudulent payment activities.

## Architecture

The system consists of three main services:

### 1. Node.js / Express Backend (Person A) - Screening Engine
- **Purpose**: Real-time fraud screening pipeline.
- **Port**: 3000
- **Key Files**: 
  - `src/api/fraudScreen.js`: Entry point for the `/api/fraud/screen` endpoint.
  - `src/services/fraudScreeningService.js`: Core logic for aggregating features, scoring the rules, calling ML, and making decisions.
  - `src/features/featureGenerator.js`: Transforms raw booking data into behavioral, identity, velocity, and device features by comparing them against the shipper's digital twin.
  - `src/rules/ruleEngine.js`: Contains declarative logic for 20+ fraud detection rules (e.g., extreme weight, new device, blacklisted IP).

### 2. Django Backend (Person B) - Intelligence & Case Management
- **Purpose**: Operations dashboard, investigation workflows, and case management.
- **Port**: 8000
- **Key Files**:
  - `intelligence/services/case_service.py`: Generates the rich investigation bundle, aggregates audit events, and manages case assignment/lifecycle.
  - `intelligence/services/genai_service.py`: Integrates with Google Gemini to produce natural language explanations for fraud risk scores, acting as the "Fraud Copilot".
  - `intelligence/models.py`: Connects to the PostgreSQL schema (shared with the Node app) to query `fraud_cases`, `risk_assessments`, `shipments`, and `decisions`.

### 3. FastAPI Python Backend - Machine Learning Service
- **Purpose**: Synthetic data generation, ML training, and real-time prediction using LightGBM and Isolation Forest models.
- **Port**: 8001
- **Key Files**: 
  - `ml/service/app.py`: FastAPI routes.
  - `ml/engine.py`: Runs real-time inference on the engineered features outputted by Person A.

### 4. React Frontend - Operations Dashboard
- **Purpose**: Provides visual UI for analysts to monitor queue and investigate cases.
- **Port**: 5173/5175 (Vite)
- **Key Views**:
  - `Dashboard.jsx`: High-level metrics and trends.
  - `Screening.jsx`: Manual real-time shipment screening tester with visualizations.
  - `Investigation.jsx`: Deep dive into individual cases, showing ML breakdown, rule explanations, entity graph linkages, and the Gemini Fraud Copilot brief.
  - `FraudGraph.jsx`: Interactive relationship mapping of linked accounts and devices.

## Database & Persistence
- **Neon Postgres**: Acts as the shared data layer for both the Node.js screening engine (writes) and the Django operations backend (reads/updates).
- The schema relies heavily on relational tables for `Shipments`, `Accounts`, `Devices`, `RiskAssessments`, and an immutable `AuditLog`.

## Key Workflows
1. **Shipment Booking**: A shipment request is sent to `/api/fraud/screen` on Node.js.
2. **Feature Generation**: The system retrieves the account's digital twin (historical baseline) and generates variance features (e.g., "is the destination new?").
3. **Rule Evaluation**: The rules engine applies strict deterministic scoring based on the features.
4. **ML Prediction**: Features are sent to the FastAPI ML service for a probabilistic fraud score.
5. **Decision Engine**: Rule score, ML score, and threat intel are weighted (`RiskScore = min(100, (0.40 * Rules) + (0.40 * ML) + (0.20 * Graph))`). An automated action (`ALLOW`, `REVIEW`, `BLOCK`) is generated.
6. **Persistence**: The assessment is written to Postgres. If `REVIEW` or `BLOCK`, a fraud case is automatically opened.
7. **Investigation**: An analyst opens the React dashboard, loads the case from Django, views the GenAI copilot explanation, and makes a final verdict (`CONFIRMED_FRAUD` / `FALSE_POSITIVE`).

## Recent Fixes
- Added a `simulate` flag to bypass Neon DB insertions for the real-time screening endpoint, stopping endless velocity score inflation.
- Introduced `EXTREME_WEIGHT` and `HIGH_RISK_ROUTE` rules to the rule engine to accurately classify high-risk simulation scenarios as Critical.
- Cleared up Gemini AI API key logic. The system uses a mock fallback (`USE_MOCK_GENAI=true`) if an API key is not configured or throws an error.
