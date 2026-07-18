/**
 * Account-data repository — `user_data_exports` and `account_deletion_requests`
 * (migration 017). Every read/write is user-scoped; the raw download token is
 * never stored (only its SHA-256 hash), and no personal data lives here beyond
 * ids, status and safe timestamps.
 */

import { getPool } from '../db/pool.js';

function runner(connection) {
  return connection ?? getPool();
}

function sanitizeExport(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: row.status,
    // The token hash and storage key are internal — never surfaced.
    hasFile: Boolean(row.storage_key),
    fileSizeBytes: row.file_size_bytes == null ? null : Number(row.file_size_bytes),
    errorMessage: row.error_message ?? null,
    requestedAt: row.requested_at ?? null,
    completedAt: row.completed_at ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

function sanitizeDeletion(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: row.user_id == null ? null : String(row.user_id),
    status: row.status,
    confirmationCode: row.confirmation_code,
    requestedAt: row.requested_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

const EXPORT_COLS =
  'id, user_id, status, storage_driver, storage_key, file_size_bytes, error_message, ' +
  'requested_at, completed_at, expires_at, created_at';

// --- exports ---------------------------------------------------------------

export async function createExportRequest(userId, connection) {
  const [res] = await runner(connection).execute(
    "INSERT INTO user_data_exports (user_id, status) VALUES (?, 'requested')",
    [userId],
  );
  return findExportById(res.insertId, userId, connection);
}

export async function findExportById(id, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${EXPORT_COLS} FROM user_data_exports WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return sanitizeExport(rows[0] ?? null);
}

export async function findLatestExportForUser(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${EXPORT_COLS} FROM user_data_exports WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  return sanitizeExport(rows[0] ?? null);
}

/** Count exports a user requested since a MySQL-UTC cutoff (rate limiting). */
export async function countRecentExports(userId, sinceMysqlUtc, connection) {
  const [rows] = await runner(connection).execute(
    'SELECT COUNT(*) AS n FROM user_data_exports WHERE user_id = ? AND created_at >= ?',
    [userId, sinceMysqlUtc],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Update a user's export row. Returns the sanitized row (safe fields only). */
export async function updateExport(id, userId, fields, connection) {
  const map = {
    status: 'status', downloadTokenHash: 'download_token_hash', storageDriver: 'storage_driver',
    storageKey: 'storage_key', fileSizeBytes: 'file_size_bytes', errorMessage: 'error_message',
    completedAt: 'completed_at', expiresAt: 'expires_at',
  };
  const sets = []; const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) { sets.push(`${col} = ?`); params.push(fields[key]); }
  }
  if (!sets.length) return findExportById(id, userId, connection);
  params.push(id, userId);
  await runner(connection).execute(
    `UPDATE user_data_exports SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    params,
  );
  return findExportById(id, userId, connection);
}

/**
 * The private storage location of a user's READY, unexpired export — for the
 * session-authenticated download route ONLY (the sanitized row omits the key).
 * Ownership is enforced by user_id here as well.
 */
export async function findExportStorage(id, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT storage_driver, storage_key FROM user_data_exports
      WHERE id = ? AND user_id = ? AND status = 'ready'
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP()) LIMIT 1`,
    [id, userId],
  );
  const row = rows[0];
  if (!row || !row.storage_key) return null;
  return { storageDriver: row.storage_driver, storageKey: row.storage_key };
}

// --- deletion requests -----------------------------------------------------

export async function createDeletionRequest({ userId, confirmationCode, reason = null }, connection) {
  const [res] = await runner(connection).execute(
    "INSERT INTO account_deletion_requests (user_id, status, confirmation_code, reason) VALUES (?, 'requested', ?, ?)",
    [userId, confirmationCode, reason],
  );
  const [rows] = await runner(connection).execute(
    'SELECT id, user_id, status, confirmation_code, requested_at, completed_at FROM account_deletion_requests WHERE id = ? LIMIT 1',
    [res.insertId],
  );
  return sanitizeDeletion(rows[0] ?? null);
}

export async function findActiveDeletionForUser(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT id, user_id, status, confirmation_code, requested_at, completed_at
       FROM account_deletion_requests
      WHERE user_id = ? AND status IN ('requested','processing') ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  return sanitizeDeletion(rows[0] ?? null);
}

export async function updateDeletionRequest(id, fields, connection) {
  const map = { status: 'status', completedAt: 'completed_at' };
  const sets = []; const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) { sets.push(`${col} = ?`); params.push(fields[key]); }
  }
  if (!sets.length) return;
  params.push(id);
  await runner(connection).execute(
    `UPDATE account_deletion_requests SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );
}

export default {
  createExportRequest, findExportById, findLatestExportForUser, countRecentExports,
  updateExport, findExportStorage,
  createDeletionRequest, findActiveDeletionForUser, updateDeletionRequest,
};
