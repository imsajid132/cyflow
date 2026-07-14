/**
 * API usage metering repository — prepared-statement access to `api_usage`.
 *
 * Records ONLY safe accounting values (service, operation, unit counts, a small
 * sanitized metadata object). Never stores prompts, captions, tokens, keys, or
 * raw provider responses (the caller is responsible for passing safe metadata).
 */

import { getPool } from '../db/pool.js';

function runner(connection) {
  return connection ?? getPool();
}

/**
 * Record one usage row.
 * @param {{ userId, scheduledPostId?, service, operation, requestIdentifier?,
 *           inputUnits?, outputUnits?, metadata? }} input
 */
export async function recordUsage(input, connection) {
  const {
    userId = null,
    scheduledPostId = null,
    service,
    operation,
    requestIdentifier = null,
    inputUnits = 0,
    outputUnits = 0,
    metadata = null,
  } = input;
  await runner(connection).execute(
    `INSERT INTO api_usage
       (user_id, scheduled_post_id, service, operation, request_identifier,
        input_units, output_units, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      scheduledPostId,
      service,
      operation,
      requestIdentifier,
      Number.isFinite(inputUnits) ? inputUnits : 0,
      Number.isFinite(outputUnits) ? outputUnits : 0,
      metadata == null ? null : JSON.stringify(metadata),
    ],
  );
}

/**
 * Count a user's operations since a UTC timestamp, optionally filtered by a set
 * of operation names. Used to enforce the daily generation limit.
 * @param {string|number} userId
 * @param {string} sinceMysqlUtc  'YYYY-MM-DD HH:MM:SS'
 * @param {{ operations?: string[] }} [opts]
 */
export async function countUserOperationsSince(userId, sinceMysqlUtc, opts = {}) {
  const operations = Array.isArray(opts.operations) ? opts.operations : null;
  let sql = 'SELECT COUNT(*) AS n FROM api_usage WHERE user_id = ? AND created_at >= ?';
  const params = [userId, sinceMysqlUtc];
  if (operations && operations.length > 0) {
    sql += ` AND operation IN (${operations.map(() => '?').join(', ')})`;
    params.push(...operations);
  }
  const [rows] = await runner(opts.connection).execute(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Summarize a user's usage since a UTC timestamp, grouped by service.
 * @returns {Promise<Array<{ service, calls, inputUnits, outputUnits }>>}
 */
export async function summarizeUserUsage(userId, sinceMysqlUtc, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT service,
            COUNT(*) AS calls,
            COALESCE(SUM(input_units), 0) AS input_units,
            COALESCE(SUM(output_units), 0) AS output_units
       FROM api_usage
      WHERE user_id = ? AND created_at >= ?
      GROUP BY service`,
    [userId, sinceMysqlUtc],
  );
  return rows.map((r) => ({
    service: r.service,
    calls: Number(r.calls),
    inputUnits: Number(r.input_units),
    outputUnits: Number(r.output_units),
  }));
}

export default { recordUsage, countUserOperationsSince, summarizeUserUsage };
