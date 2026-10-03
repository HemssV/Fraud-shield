# FraudShield Architecture & System Summary

Welcome to **FraudShield**, an enterprise-grade, hybrid real-time fraud detection and risk assessment platform designed specifically for high-velocity travel & booking systems. 

This document serves as the complete, authoritative guide to understanding **everything** happening inside FraudShield—from architecture, microservices, and database models to feature engineering, rule mechanics, machine learning pipelines, and AI copilot integrations.

---

## 📑 Table of Contents
1. [System Architecture Overview](#-system-architecture-overview)
2. [Microservices Breakdown](#-microservices-breakdown)
3. [End-to-End Real-Time Screening Flow](#-end-to-end-real-time-screening-flow)
4. [Mathematical & Scoring Framework](#-mathematical--scoring-framework)
5. [ML Model & Feature Engineering Pipeline](#-ml-model--feature-engineering-pipeline)
6. [GenAI Copilot Integration](#-genai-copilot-integration)
7. [Database Schema & Fallback Mechanics](#-database-schema--fallback-mechanics)
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
|               Neon PostgreSQL / Mock Data Layer                   |
+-------------------------------------------------------------------+
```

---

## 🧩 Microservices Breakdown

| Component | Tech Stack | Port | Core Responsibilities |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | React, Tailwind CSS, Lucide Icons, Vite | `5173` | Fraud Analyst Portal, Live Screening Simulator, Interactive Rule Builder, Visual Graph Analytics, Investigation Workbench. |
| **Core Screening Engine** | Node.js, Express | `3000` | Sub-100ms real-time booking screening, rule evaluation, z-score velocity calculation, entity profiling, database fallback logic. |
| **Analytics & GenAI Backend** | Python, Django, Django REST Framework | `8000` | Case management, audit logs, analytical dashboards, Gemini 3.8 Flash LLM orchestration, investigation note summaries. |
| **ML Inference Microservice** | Python, FastAPI, LightGBM, Scikit-Learn | `8001` | Anomaly detection via Isolation Forest, supervised fraud probability scoring via LightGBM model. |
| **Database Layer** | Neon PostgreSQL (Remote) / `mockData.js` | Cloud / Local | Entity history (Accounts, Payments, Devices, IPs), rules configuration, blacklists, cases. |

---

## ⚡ End-to-End Real-Time Screening Flow

When a booking request is posted to `POST /api/bookings/screen`, the engine executes an 8-step pipeline:

```
[Booking Ingestion] 
       │
       ▼
[Entity Upsert & History Lookup] (Account, Payment, Device, IP)
       │
       ▼
[Feature Engineering] (Z-Scores, Velocity Ratios, Route Entropy)
       │
       ▼
[Rule Engine Evaluation] (Deterministic Rules 0 - 100)
       │
       ▼
[ML Inference] ──► (FastAPI LightGBM Probability + Isolation Forest)
       │
       ▼
[Entity Graph Risk] (Risk propagation across shared IPs/Devices)
       │
       ▼
[Risk Aggregation] ──► (40% Rules + 40% ML + 20% Graph)
       │
       ▼
[Final Action Decision] ──► (ALLOW | MONITOR | VERIFY | REVIEW | BLOCK)
```

---

## 📐 Mathematical & Scoring Framework

### 1. Final Combined Risk Score Formula
$$\text{Final Risk Score} = \min\left(100, (0.40 \times \text{RuleScore}) + (0.40 \times \text{MLScore}) + (0.20 \times \text{GraphScore})\right)$$

*(Note: Blacklisted devices/IPs or suspended accounts trigger an automatic override forcing the score to `100` and action to `BLOCK`.)*

### 2. Velocity Z-Score Formula
$$\text{Velocity Z-Score} = \frac{x_{\text{current}} - \mu_{24h}}{\sigma_{24h} + 1e-5}$$
- Measures deviation in transactional frequency over a rolling 24-hour window for a given IP or User Account.

### 3. Route Entropy (Risk Indexing)
$$\text{Route Entropy} = -\sum_{i} P(\text{route}_i) \log_2 P(\text{route}_i) + \text{GeographicRiskMultiplier}$$
- High-risk origin/destination pairs (e.g., sanctioned/high-friction corridors) scale the base rule score by up to 2.5×.

### 4. Graph Propagation Risk Score
$$\text{Graph Score} = \max_{v \in \text{Neighbors}} \left( \text{Risk}(v) \times d^{-\text{distance}} \right)$$
- Propagates risk from linked suspended/fraudulent accounts attached to the same device fingerprint or IP subnet.

---

## 🤖 ML Model & Feature Engineering Pipeline

The FastAPI microservice ([`ml/main.py`](file:///c:/Users/samyu/Desktop/test/fraudshield-backend/ml/main.py)) runs two complementary models in parallel:

1. **LightGBM Classifier**: Trained on historical chargebacks, velocity spikes, card country vs IP country mismatches, and email domain age. Outputs a calibrated fraud probability $P(\text{Fraud}) \in [0, 1]$.
2. **Isolation Forest**: Unsupervised anomaly detection model trained on multi-dimensional transaction distributions. Detects novel zero-day fraud attacks.

---

## 🧠 GenAI Copilot Integration

Powered by **Google Gemini 3.8 Flash** via the official Python `google-genai` SDK:
- Located in Django [`investigations/views.py`](file:///c:/Users/samyu/Desktop/test/fraudshield-backend/investigations/views.py).
- Analyzes case signals, z-scores, graph connectivity, and risk rule outputs.
- Synthesizes a human-readable **Executive Summary**, **Risk Drivers**, **Graph Anomaly Highlights**, and **Actionable Recommendations**.

---

## 💾 Database Schema & Fallback Mechanics

To guarantee **zero downtime** and deterministic demo behavior:
- **Primary Data Store**: Neon Serverless PostgreSQL containing historical entity profiles (`UserAccount`, `PaymentMethod`, `DeviceFingerprint`, `IPAddress`).
- **Resilient Fallback Mechanism**: If the database connection times out or if demo entities (`S*` screening codes, `P*` payment tokens, `D*` devices) are queried, the engine seamlessly utilizes [`src/services/mockData.js`](file:///c:/Users/samyu/Desktop/test/fraudshield-backend/src/services/mockData.js). This ensures predictable, reproducible evaluations for critical test cases (such as High-Weight Suspicious Routes evaluating to Critical Risk).

---

## 🛠️ Setup & Running Locally

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- Pipenv / Virtual environment

### Running the Services

1. **Express Screening Engine**:
   ```bash
   npm start
   # Runs on http://localhost:3000
   ```

2. **Django Analytics & Copilot Backend**:
   ```bash
   python manage.py runserver 127.0.0.1:8000 --noreload
   # Runs on http://localhost:8000
   ```

3. **FastAPI ML Service**:
   ```bash
   cd ml
   uvicorn main:app --reload --port 8001
   # Runs on http://localhost:8001
   ```

4. **React Frontend**:
   ```bash
   cd frontend
   npm run dev
   # Runs on http://localhost:5173
   ```
