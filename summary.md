# FraudShield Architecture & System Summary

Welcome to **FraudShield**, an enterprise-grade, hybrid real-time fraud detection and risk assessment platform designed specifically for high-velocity travel & booking systems.

This document serves as the complete, authoritative guide to understanding **everything** happening inside FraudShield—from architecture, microservices, and database models to feature engineering, rule mechanics, machine learning pipelines, and AI copilot integrations. It includes recent system hardening and correctness fixes applied to Phase 1.

---

## 📑 Table of Contents
1. [System Architecture Overview](#-system-architecture-overview)
2. [Microservices Breakdown](#-microservices-breakdown)
3. [End-to-End Real-Time Screening Flow](#-end-to-end-real-time-screening-flow)
4. [Mathematical & Scoring Framework](#-mathematical--scoring-framework)
5. [ML Model & Feature Engineering Pipeline](#-ml-model--feature-engineering-pipeline)
6. [GenAI Copilot Integration](#-genai-copilot-integration)
7. [Database Schema & Hardening Mechanics](#-database-schema--hardening-mechanics)
8. [Setup & Running Locally](#-setup--running-locally)

---

## 🏗️ System Architecture Overview

FraudShield employs a **multi-tier microservice architecture** separating high-speed transactional screening from heavy analytical reporting and machine learning inference.

```
                  +-------------------------------+
                  |    React / Vite Frontend      |
                  |     (Port 5173 / 3000)        |
                  +---------------+---------------+
                                  |
              +-------------------+-------------------+
              |                                       |
              v                                       v
+---------------------------+           +---------------------------+
| Express / Node.js Engine  |           |      Django Backend       |
|    Real-Time Screening    |           | Analytics, Cases & Copilot|
|        (Port 3000)        |           |        (Port 8000)        |
+-------------+-------------+           +-------------+-------------+
              |                                       |
              | (HTTP `/score`)                       | (SDK)
              v                                       v
+---------------------------+           +---------------------------+
|    FastAPI ML Service     |           |     Google Gemini 3.8     |
| LightGBM & Anomaly Engine |           |        Flash Model        |
|        (Port 8001)        |           +---------------------------+
+-------------+-------------+
              |
              v
+-------------------------------------------------------------------+
|               Neon PostgreSQL Database                            |
+-------------------------------------------------------------------+
```

---

## 🧩 Microservices Breakdown

| Component | Tech Stack | Port | Core Responsibilities |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | React, Tailwind CSS, Lucide Icons, Vite | `5173` | Fraud Analyst Portal, Live Screening Simulator, Interactive Rule Builder, Visual Graph Analytics, Investigation Workbench. |
| **Core Screening Engine** | Node.js, Express | `3000` | Sub-100ms real-time booking screening, rule evaluation, Poisson-style z-score velocity calculation, canonical feature flattening, strict error handling, and advisory locking for concurrent requests. |
| **Analytics & GenAI Backend** | Python, Django, Django REST Framework | `8000` | Case management, audit logs, analytical dashboards, Gemini 3.8 Flash LLM orchestration, investigation note summaries. |
| **ML Inference Microservice** | Python, FastAPI, LightGBM, Scikit-Learn | `8001` | Anomaly detection via Isolation Forest, supervised fraud probability scoring via LightGBM model. Expects a canonical 1D flattened feature vector. |
| **Database Layer** | Neon PostgreSQL (Remote) | Cloud | Entity history (Accounts, Payments, Devices, IPs), rules configuration, blacklists, cases, and shipment records. |

---

## ⚡ End-to-End Real-Time Screening Flow

When a booking request is posted to `POST /api/fraud/screen`, the engine executes a strict 10-step pipeline:

1. **Advisory Locking**: Acquires a Postgres advisory lock on `hashtext(booking_ref)` to prevent concurrent double-writes.
2. **Entity Lookups (Null Safety)**: Fetches historical entity data (Account, Payment, Device, Address). Throws `EntityNotFoundError` if the Account does not exist (in production mode).
3. **Velocity Z-Score Computation**: Runs index-backed queries in parallel via `Promise.all` to compute 30-day baseline vs. last 24h metrics for Account, Device, Payment, and IP.
4. **Feature Engineering**: Calculates weight Z-scores, departure time math, route entropy, and clips unbounded features. Flattens features into a 1D vector and strictly enforces a canonical feature schema.
5. **Rule Engine Evaluation**: Runs deterministic heuristics on the generated features to produce a `rule_score`.
6. **ML Inference**: Calls the FastAPI ML service (`/score`). Overridden completely if `rule_score >= 100`.
7. **Risk Aggregation**: Combines `rule_score`, `ml_score`, and `graph_score` into a single bounded `risk_score` (0-100).
8. **Decision Engine**: Determines final action (ALLOW, ALLOW_MONITOR, VERIFY, REVIEW, BLOCK) based on hard thresholds (e.g. REVIEW >= 70, BLOCK >= 90).
9. **Reason & Signal Generation**: Extracts top categorical reasons explaining the decision.
10. **Persistence**: Saves the full Risk Assessment and releases the advisory lock.

---

## 📐 Mathematical & Scoring Framework

### 1. Final Combined Risk Score Formula
If `RuleScore >= 100`, bypass ML entirely and set action to `BLOCK` (Risk Score = 100, Fraud Prob = 1.0).
Otherwise:
$$\text{Final Risk Score} = \min\left(100, (0.40 \times \text{RuleScore}) + (0.40 \times \text{MLScore}) + (0.20 \times \text{GraphScore})\right)$$
*Note: Severe signals (like suspended accounts or blacklisted IPs) conditionally raise the minimum final score.*

### 2. Velocity Z-Score Formula (Poisson-Style)
Computed per-entity (Account, IP, Device, Payment) over a 30-day baseline (excluding the last 24h):
$$\text{Velocity Z-Score} = \frac{\text{Count}_{24h} - \text{BaselineDaily}}{\sqrt{\max(\text{BaselineDaily}, 0.5)}}$$
*This prevents divide-by-zero explosions for low-activity entities. Z-Scores are rigidly clipped to `[-10, 10]`.*

### 3. Route Entropy
Shannon entropy guards against completely novel route combinations (capped at $\log_2(\text{Total Routes})$):
$$\text{Route Entropy} = -\sum P(route_i) \log_2 P(route_i)$$
*Empty routes return entropy 0, `is_new_route = true`.*

### 4. Feature Bounds & Clipping
To ensure stable ML inference:
- `weight_z_score`: Clipped to `[-5, 10]`
- `weight_ratio_to_avg`: Clipped to `[0, 50]`
- `package_count_ratio`: Clipped to `[0, 20]`

---

## 🤖 ML Model & Feature Engineering Pipeline

The Node.js engine strictly maps raw data to a 1D vector governed by `src/features/featureSchema.js`. Missing or unexpected features throw immediate errors.

The FastAPI microservice (`ml/app.py`) consumes this canonical vector through:
1. **LightGBM Classifier**: Evaluates the structured array to output a calibrated fraud probability $P(\text{Fraud}) \in [0, 1]$.
2. **Isolation Forest**: Computes multidimensional anomaly scores to detect novel zero-day behaviors that LightGBM might miss.

---

## 🧠 GenAI Copilot Integration

Powered by **Google Gemini 1.5 Flash** (via the `google-genai` SDK):
- Located in Django `investigations/views.py`.
- Evaluates case signals, structured JSON artifacts, z-scores, graph connectivity, and risk rules.
- Autonomously generates a human-readable **Executive Summary**, **Risk Drivers**, **Graph Anomaly Highlights**, and **Actionable Recommendations** on the Investigation dashboard.

---

## 💾 Database Schema & Hardening Mechanics

FraudShield relies heavily on **Neon Serverless PostgreSQL**. Recent hardening ensures:
- **Null Safety**: Entities fetched from the DB strictly handle missing records via `EntityNotFoundError`, stripping away legacy silent mock fallbacks.
- **Concurrent Request Safety**: Session-level Postgres advisory locks (`pg_try_advisory_lock`) on `hashtext(booking_ref)` prevent duplicate concurrent POST requests from causing duplicate rule processing or double-writes.
- **Velocity Efficiency**: DB logic uses highly optimized `FILTER (WHERE ...)` aggregations across index-backed queries to fetch 30-day baselines in a single pass.

---

## 🛠️ Setup & Running Locally

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- Postgres (Neon DB URL)

### Running the Services

1. **Express Screening Engine**:
   ```bash
   npm run dev
   # Runs on http://localhost:3000
   ```

2. **Django Analytics & Copilot Backend**:
   ```bash
   cd intelligence
   python manage.py runserver 127.0.0.1:8000 --noreload
   # Runs on http://localhost:8000
   ```

3. **FastAPI ML Service**:
   ```bash
   cd ml
   uvicorn service.app:app --reload --port 8001
   # Runs on http://localhost:8001
   ```

4. **React Frontend**:
   ```bash
   cd frontend
   npm run dev
   # Runs on http://localhost:5173
   ```
