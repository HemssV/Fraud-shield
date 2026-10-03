const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { v4: uuidv4 } = require('uuid');
const { screenShipment } = require('../services/fraudScreeningService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ─── POST /api/demo/upload ────────────────────────────────────────────────
// Parses CSV data and simulates fraud screening on each row.
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400, 'BAD_REQUEST');
    }

    const csvData = req.file.buffer.toString('utf-8');
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });

    const results = [];
    const stats = {
      total: records.length,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const row of records) {
      try {
        const screeningInput = {
          shipment_id: row.shipment_id || `SH${uuidv4().substring(0, 8).toUpperCase()}`,
          shipper_id: row.shipper_id || 'S1001',
          origin: row.origin || 'Mumbai',
          destination: row.destination || 'Delhi',
          destination_address_id: row.destination_address_id,
          weight: parseFloat(row.weight) || 5.0,
          service_type: row.service_type || 'EXPRESS',
          payment_id: row.payment_id || 'PAY1001',
          device_id: row.device_id || 'DEV1001',
          package_count: parseInt(row.package_count, 10) || 1,
          booking_timestamp: row.booking_timestamp || new Date().toISOString(),
          simulate: false, // Save to DB so it shows on Dashboard
        };

        const assessment = await screenShipment(screeningInput);
        
        results.push({
          row,
          assessment: {
            risk_score: assessment.risk_score,
            risk_level: assessment.risk_level,
            automated_decision: assessment.automated_decision,
          }
        });

        if (assessment.risk_level === 'CRITICAL') stats.critical++;
        else if (assessment.risk_level === 'HIGH') stats.high++;
        else if (assessment.risk_level === 'MEDIUM') stats.medium++;
        else stats.low++;

      } catch (err) {
        results.push({ row, error: err.message });
      }
    }

    res.json({
      success: true,
      stats,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
