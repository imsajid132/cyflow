/**
 * MySQL connection pool (mysql2/promise).
 *
 * Provides a single shared pool, a health-check, and a graceful close. Database
 * credentials come from validated config and are NEVER logged.
 */

import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

let pool = null;

/** Lazily create and return the shared connection pool. */
export function getPool() {
  if (pool) return pool;

  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionLimit: config.db.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    // Store/read all DATETIMEs as UTC.
    timezone: 'Z',
    charset: 'utf8mb4',
    // Keep DATETIME columns as strings to avoid implicit local-time coercion;
    // the application treats them as UTC wall-clock values.
    dateStrings: true,
    namedPlaceholders: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

  return pool;
}

/**
 * Run a parameterized query against the pool.
 * @param {string} sql
 * @param {Array|object} [params]
 * @returns {Promise<any>} rows
 */
export async function query(sql, params) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/**
 * Health-check: confirms the pool can round-trip a trivial query.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function checkHealth() {
  try {
    const conn = await getPool().getConnection();
    try {
      // Ensure the session speaks UTC, then ping.
      await conn.query("SET time_zone = '+00:00'");
      await conn.query('SELECT 1');
      return { ok: true };
    } finally {
      conn.release();
    }
  } catch (err) {
    // Return a sanitized error string — never include credentials/DSN.
    return { ok: false, error: err.code || 'DB_UNAVAILABLE' };
  }
}

/** Gracefully close the pool (used on shutdown). Safe to call repeatedly. */
export async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

export default { getPool, query, checkHealth, closePool };
