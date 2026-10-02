// src/api/health.js
//
// GET /api/health — Health check endpoint
// GET /api/health/ready — Readiness check (includes DB connectivity)

const express = require('express');
const db = require('../db');
const { decisionThresholds } = require('../services/mockData');

const router = express.Router();

/**
 * GET /api/health — Basic liveness check
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fraudshield-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  });
});

/**
 * GET /api/health/ready — Readiness check with dependency verification
 */
router.get('/ready', async (req, res) => {
  const checks = {
    server: 'ok',
    database: 'unknown',
    decision_framework: 'ok',
  };

  try {
    await db.query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  const allOk = Object.values(checks).every(v => v === 'ok');

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ready' : 'degraded',
    checks,
    thresholds: decisionThresholds,
    timestamp: new Date().toISOString(),
  });
});


module.exports = router;
