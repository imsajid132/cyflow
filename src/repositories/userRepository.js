/**
 * User repository — prepared-statement access to the `users` table.
 *
 * All values are passed as placeholders (never interpolated). Every function
 * optionally accepts a transaction `connection`; when omitted, the shared pool
 * is used. Passwords/hashes are never logged. BIGINT ids are surfaced to the
 * API as strings to avoid precision loss.
 */

import { getPool } from '../db/pool.js';
import { normalizeEmail } from '../utils/validation.js';
import { USER_ROLES, USER_STATUS } from '../config/constants.js';

/** Resolve the query executor: a transaction connection or the shared pool. */
function runner(connection) {
  return connection ?? getPool();
}

/**
 * Map a raw DB row to the sanitized API shape. Never includes `password_hash`.
 * @param {object|null} row
 */
export function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    email: row.email,
    timezone: row.timezone,
    role: row.role,
    status: row.status,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    lastLoginAt: row.last_login_at ?? null,
  };
}

const SELECT_COLUMNS =
  'id, name, email, password_hash, timezone, role, status, created_at, updated_at, last_login_at';

/** Find a user by id. Returns the full row (incl. password_hash) or null. */
export async function findUserById(id, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${SELECT_COLUMNS} FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Find a user by email (normalized). Returns the full row or null. */
export async function findUserByEmail(email, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${SELECT_COLUMNS} FROM users WHERE email = ? LIMIT 1`,
    [normalizeEmail(email)],
  );
  return rows[0] ?? null;
}

/** True if a user already exists with the given (normalized) email. */
export async function emailExists(email) {
  const [rows] = await getPool().execute(
    'SELECT 1 FROM users WHERE email = ? LIMIT 1',
    [normalizeEmail(email)],
  );
  return rows.length > 0;
}

/**
 * Insert a new user. Returns the created user's sanitized representation.
 * @param {{name,email,passwordHash,timezone,role?,status?}} input
 * @param {import('mysql2/promise').PoolConnection} [connection]
 */
export async function createUser(input, connection) {
  const {
    name,
    email,
    passwordHash,
    timezone,
    role = USER_ROLES.USER,
    status = USER_STATUS.ACTIVE,
  } = input;

  const conn = runner(connection);
  const [result] = await conn.execute(
    `INSERT INTO users (name, email, password_hash, timezone, role, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, normalizeEmail(email), passwordHash, timezone, role, status],
  );
  const insertId = result.insertId;
  const row = await findUserById(insertId, connection);
  return sanitizeUser(row);
}

/** Update last_login_at = now (UTC) for a user. */
export async function updateLastLogin(userId, connection) {
  await runner(connection).execute(
    'UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?',
    [userId],
  );
}

/** Update editable profile fields (name, timezone) only. */
export async function updateProfile(userId, { name, timezone }, connection) {
  await runner(connection).execute(
    'UPDATE users SET name = ?, timezone = ? WHERE id = ?',
    [name, timezone, userId],
  );
  return getSanitizedUserById(userId, connection);
}

/** Update the password hash for a user. */
export async function updatePassword(userId, passwordHash, connection) {
  await runner(connection).execute(
    'UPDATE users SET password_hash = ? WHERE id = ?',
    [passwordHash, userId],
  );
}

/** Fetch a sanitized user by id (never includes password_hash). */
export async function getSanitizedUserById(userId, connection) {
  const row = await findUserById(userId, connection);
  return sanitizeUser(row);
}

/**
 * G: permanently delete a user. InnoDB ON DELETE CASCADE removes every
 * user-owned table (integrations, social accounts + tokens, posts, targets,
 * publish attempts, media rows, business/planner/automation data, jobs, oauth
 * states); activity_logs / api_usage are SET NULL (retained, anonymized). The
 * caller must capture on-disk media keys BEFORE calling this, and unlink the
 * bytes afterwards. Returns the number of user rows removed (0 if already gone).
 */
export async function deleteUserById(userId, connection) {
  const [res] = await runner(connection).execute('DELETE FROM users WHERE id = ?', [userId]);
  return res.affectedRows ?? 0;
}

export default {
  sanitizeUser,
  findUserById,
  findUserByEmail,
  emailExists,
  createUser,
  updateLastLogin,
  updateProfile,
  updatePassword,
  getSanitizedUserById,
  deleteUserById,
};
