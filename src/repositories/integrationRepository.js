/**
 * Integration repository — prepared-statement access to `user_integrations`.
 *
 * Stores ONLY encrypted HCTI credentials. Decrypted values never touch this
 * layer. Exactly one row per user (enforced by a UNIQUE(user_id) constraint and
 * upsert). All functions accept an optional transaction `connection`.
 */

import { getPool } from '../db/pool.js';
import { ENCRYPTION_VERSION } from '../config/constants.js';

function runner(connection) {
  return connection ?? getPool();
}

/** Return the raw integration row for a user, or null. */
export async function findIntegrationByUserId(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT id, user_id, hcti_user_id_encrypted, hcti_api_key_encrypted,
            hcti_encryption_version, hcti_verified_at, created_at, updated_at
       FROM user_integrations WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Return only the encrypted HCTI credential material + verification state.
 * The caller decrypts (immediately before use) — this layer never decrypts.
 */
export async function getHctiCredentialRecord(userId, connection) {
  const row = await findIntegrationByUserId(userId, connection);
  if (!row) return null;
  return {
    userId: String(row.user_id),
    encryptedUserId: row.hcti_user_id_encrypted,
    encryptedApiKey: row.hcti_api_key_encrypted,
    encryptionVersion: row.hcti_encryption_version,
    verifiedAt: row.hcti_verified_at,
    configured:
      row.hcti_user_id_encrypted != null && row.hcti_api_key_encrypted != null,
  };
}

/** True when the user has both encrypted HCTI values stored. */
export async function hasConfiguredHctiCredentials(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT 1 FROM user_integrations
      WHERE user_id = ?
        AND hcti_user_id_encrypted IS NOT NULL
        AND hcti_api_key_encrypted IS NOT NULL
      LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Insert or update the encrypted HCTI credentials for a user. Saving new
 * credentials always resets verification (hcti_verified_at = NULL). Enforces a
 * single row per user via ON DUPLICATE KEY UPDATE on the UNIQUE(user_id) key.
 * @param {{userId, encryptedUserId, encryptedApiKey, encryptionVersion?}} input
 */
export async function upsertEncryptedHctiCredentials(input, connection) {
  const {
    userId,
    encryptedUserId,
    encryptedApiKey,
    encryptionVersion = ENCRYPTION_VERSION,
  } = input;

  await runner(connection).execute(
    `INSERT INTO user_integrations
       (user_id, hcti_user_id_encrypted, hcti_api_key_encrypted,
        hcti_encryption_version, hcti_verified_at)
     VALUES (?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       hcti_user_id_encrypted = VALUES(hcti_user_id_encrypted),
       hcti_api_key_encrypted = VALUES(hcti_api_key_encrypted),
       hcti_encryption_version = VALUES(hcti_encryption_version),
       hcti_verified_at = NULL`,
    [userId, encryptedUserId, encryptedApiKey, encryptionVersion],
  );
}

/** Mark the stored HCTI credentials as verified at the given UTC time. */
export async function markHctiVerified(userId, verifiedAt, connection) {
  await runner(connection).execute(
    'UPDATE user_integrations SET hcti_verified_at = ? WHERE user_id = ?',
    [verifiedAt, userId],
  );
}

/** Clear the verification timestamp (credentials remain configured). */
export async function clearHctiVerification(userId, connection) {
  await runner(connection).execute(
    'UPDATE user_integrations SET hcti_verified_at = NULL WHERE user_id = ?',
    [userId],
  );
}

/**
 * Remove HCTI credentials: null out encrypted values + verification, WITHOUT
 * deleting the integration row (or the user). Safe when no row exists.
 */
export async function deleteHctiCredentials(userId, connection) {
  await runner(connection).execute(
    `UPDATE user_integrations
        SET hcti_user_id_encrypted = NULL,
            hcti_api_key_encrypted = NULL,
            hcti_verified_at = NULL
      WHERE user_id = ?`,
    [userId],
  );
}

/** Ensure an integration row exists for the user (used at registration). */
export async function ensureIntegrationRow(userId, connection) {
  await runner(connection).execute(
    `INSERT INTO user_integrations (user_id) VALUES (?)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId],
  );
}

export default {
  findIntegrationByUserId,
  getHctiCredentialRecord,
  hasConfiguredHctiCredentials,
  upsertEncryptedHctiCredentials,
  markHctiVerified,
  clearHctiVerification,
  deleteHctiCredentials,
  ensureIntegrationRow,
};
