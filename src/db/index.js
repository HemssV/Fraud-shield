// src/db/index.js
// Neon PostgreSQL connection pool — shared across entire Node.js backend
require('dotenv').config();
const { Pool } = require('pg');

const logger = require('../utils/logger');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxUses: 7500, // Close connection and open new one after 7500 queries
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message, stack: err.stack });
});

/**
 * Execute a parameterized query.
 * @param {string} text - SQL query with $1, $2 placeholders
 * @param {Array}  params - Query parameters
 */
const query = (text, params) => pool.query(text, params);

/**
 * Get a client for transactions.
 */
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };