/**
 * Transaction helper.
 *
 * `withTransaction(callback)` acquires a pooled connection, begins a
 * transaction, runs the callback with that connection, commits on success,
 * rolls back on any error, and ALWAYS releases the connection.
 */

import { getPool } from './pool.js';

/**
 * Execute `callback` inside a database transaction.
 *
 * @template T
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} callback
 * @returns {Promise<T>} whatever the callback returns
 */
export async function withTransaction(callback) {
  const conn = await getPool().getConnection();
  try {
    // Ensure this connection uses UTC for the transaction's lifetime.
    await conn.query("SET time_zone = '+00:00'");
    await conn.beginTransaction();
    try {
      const result = await callback(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // Ignore rollback failures — surface the original error instead.
      }
      throw err;
    }
  } finally {
    conn.release();
  }
}

export default { withTransaction };
