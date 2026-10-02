// src/server.js
//
// FraudShield Backend — Express server entry point
// Neon PostgreSQL integration active — all screenings persist to DB.
//
// API Routes (Backend A):
//   POST /api/bookings              — Primary booking ingestion + real-time fraud screening
//   GET  /api/accounts/:shipper_id  — Account service (DB + mock fallback)
//   GET  /api/payments/:payment_id  — Payment service (DB + mock fallback)
//   GET  /api/fraud-signals/:id     — Fraud signal service (DB + mock fallback)
//   GET  /api/address-confidence/:id — Address intelligence service
//   POST /api/fraud/screen          — Standalone fraud screening endpoint
//   POST /api/rules/evaluate        — ⭐ NEW: Standalone rule engine evaluation
//   POST /api/risk/calculate        — ⭐ NEW: Standalone risk score calculation
//   GET  /api/health                — Health check

require('dotenv').config();

const express = require('express');
const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const db = require('./db/index');

// Route imports
const healthRoutes = require('./api/health');
const bookingRoutes = require('./api/bookings');
const accountRoutes = require('./api/accounts');
const paymentRoutes = require('./api/payments');
const fraudSignalRoutes = require('./api/fraudSignals');
const addressRoutes = require('./api/addressConfidence');
const fraudScreenRoutes = require('./api/fraudScreen');
const rulesRoutes = require('./api/rules');
const riskRoutes = require('./api/risk');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

// CORS — allow all origins in dev; restrict in production
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────

// Health & readiness
app.use('/api/health', healthRoutes);

// Primary booking ingestion (triggers fraud screening → DB persistence)
app.use('/api/bookings', bookingRoutes);

// Upstream signal services (DB-backed with mock fallback)
app.use('/api/accounts', accountRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/fraud-signals', fraudSignalRoutes);
app.use('/api/address-confidence', addressRoutes);

// Standalone fraud screening
app.use('/api/fraud/screen', fraudScreenRoutes);

// ⭐ New: standalone rule engine & risk calculator
app.use('/api/rules/evaluate', rulesRoutes);
app.use('/api/risk/calculate', riskRoutes);

// ─── 404 handler ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
});

// ─── Error handler ────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`
╔══════════════════════════════════════════════════════════════╗
║          🛡️  FraudShield Backend v2.0                       ║
║          Neon PostgreSQL — LIVE                              ║
║          Running on port ${PORT}                               ║
╠══════════════════════════════════════════════════════════════╣
║  POST /api/bookings              Booking + fraud screen     ║
║  POST /api/fraud/screen          Standalone screening       ║
║  POST /api/rules/evaluate  ⭐    Rule engine                 ║
║  POST /api/risk/calculate  ⭐    Risk aggregator             ║
║  GET  /api/accounts/:id          Account service            ║
║  GET  /api/payments/:id          Payment service            ║
║  GET  /api/fraud-signals/:id     Fraud signals              ║
║  GET  /api/address-confidence/:id Address intelligence      ║
║  GET  /api/health                Health check               ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
