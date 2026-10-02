// src/middleware/requestLogger.js
const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl}`, {
      statusCode: res.statusCode,
      duration_ms: duration,
      ip: req.ip,
    });
  });

  next();
}

module.exports = requestLogger;
