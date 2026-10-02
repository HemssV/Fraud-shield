// src/server.js
//
// FraudShield Backend — Express server entry point
//
// API Routes:
//   POST /api/bookings              — Primary booking ingestion + real-time fraud screening
//   GET  /api/accounts/:shipper_id  — Mock account service (shipper digital twin)
//   GET  /api/payments/:payment_id  — Mock payment service
//   GET  /api/fraud-signals/:device_id — Mock fraud signal service (device/IP intelligence)
//   GET  /api/address-confidence/:id — Mock address intelligence service
//   POST /api/fraud/screen          — Standalone fraud screening endpoint
//   GET  /api/health                — Health check
//   GET  /api/health/ready          — Readiness check

require('dotenv').config();

const express = require('express');
const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');

// Route imports
const healthRoutes = require('./api/health');
const bookingRoutes = require('./api/bookings');
const accountRoutes = require('./api/accounts');
const paymentRoutes = require('./api/payments');
const fraudSignalRoutes = require('./api/fraudSignals');
const addressRoutes = require('./api/addressConfidence');
const fraudScreenRoutes = require('./api/fraudScreen');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

// CORS (allow all origins for development)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────

// Health & readiness
app.use('/api/health', healthRoutes);

// Primary booking ingestion (triggers fraud screening)
app.use('/api/bookings', bookingRoutes);

// Mock upstream services (provide signals, not decisions)
app.use('/api/accounts', accountRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/fraud-signals', fraudSignalRoutes);
app.use('/api/address-confidence', addressRoutes);

// Standalone fraud screening (can be called independently)
app.use('/api/fraud/screen', fraudScreenRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

// ─── Error handler ───────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start server ────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`
╔═══════════════════════════════════════════════════════════╗
║          🛡️  FraudShield Backend v1.0.0                  ║
║          Fraud Detection Engine running on :${PORT}         ║
╠═══════════════════════════════════════════════════════════╣
║  POST /api/bookings              Booking ingestion       ║
║  POST /api/fraud/screen          Fraud screening         ║
║  GET  /api/accounts/:id          Account service         ║
║  GET  /api/payments/:id          Payment service         ║
║  GET  /api/fraud-signals/:id     Fraud signals           ║
║  GET  /api/address-confidence/:id Address intelligence   ║
║  GET  /api/health                Health check            ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
