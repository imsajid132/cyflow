/**
 * Integration repository — prepared-statement access to `user_integrations`.
 *
 * Stores ONLY encrypted credentials (HCTI and OpenAI). Decrypted values never touch this
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
            hcti_encryption_version, hcti_verified_at,
            hcti_connection_label, hcti_last_success_at, hcti_last_failure_at,
            hcti_last_error_category, hcti_last_checked_at,
            openai_api_key_encrypted, openai_encryption_version, openai_model,
            openai_verified_at, openai_connection_label, openai_last_success_at,
            openai_last_failure_at, openai_last_error_category, openai_last_checked_at,
            created_at, updated_at
       FROM user_integrations WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** The safe, credential-free health block for a provider (for the panel). */
function hctiHealthOf(row) {
  return {
    connectionLabel: row.hcti_connection_label ?? null,
    lastSuccessAt: row.hcti_last_success_at ?? null,
    lastFailureAt: row.hcti_last_failure_at ?? null,
    lastErrorCategory: row.hcti_last_error_category ?? null,
    lastCheckedAt: row.hcti_last_checked_at ?? null,
  };
}
function openAiHealthOf(row) {
  return {
    connectionLabel: row.openai_connection_label ?? null,
    lastSuccessAt: row.openai_last_success_at ?? null,
    lastFailureAt: row.openai_last_failure_at ?? null,
    lastErrorCategory: row.openai_last_error_category ?? null,
    lastCheckedAt: row.openai_last_checked_at ?? null,
  };
}

/**
 * Record a SAFE provider health signal. Never stores a body/key — only a
 * normalized category, timestamps and a success flag. Best-effort UPDATE of the
 * existing row (a signal for a user with no row is a no-op).
 */
export async function recordHctiHealth(userId, { success, category = null, at }, connection) {
  await runner(connection).execute(
    `UPDATE user_integrations
        SET hcti_last_checked_at = ?,
            hcti_last_success_at = CASE WHEN ? THEN ? ELSE hcti_last_success_at END,
            hcti_last_failure_at = CASE WHEN ? THEN hcti_last_failure_at ELSE ? END,
            hcti_last_error_category = CASE WHEN ? THEN hcti_last_error_category ELSE ? END
      WHERE user_id = ?`,
    [at, success ? 1 : 0, at, success ? 1 : 0, at, success ? 1 : 0, category, userId],
  );
}

export async function recordOpenAiHealth(userId, { success, category = null, at }, connection) {
  await runner(connection).execute(
    `UPDATE user_integrations
        SET openai_last_checked_at = ?,
            openai_last_success_at = CASE WHEN ? THEN ? ELSE openai_last_success_at END,
            openai_last_failure_at = CASE WHEN ? THEN openai_last_failure_at ELSE ? END,
            openai_last_error_category = CASE WHEN ? THEN openai_last_error_category ELSE ? END
      WHERE user_id = ?`,
    [at, success ? 1 : 0, at, success ? 1 : 0, at, success ? 1 : 0, category, userId],
  );
}

/** Set the operator-chosen connection label (a name, never a credential). */
export async function setHctiLabel(userId, label, connection) {
  await runner(connection).execute(
    'UPDATE user_integrations SET hcti_connection_label = ? WHERE user_id = ?',
    [label, userId],
  );
}
export async function setOpenAiLabel(userId, label, connection) {
  await runner(connection).execute(
    'UPDATE user_integrations SET openai_connection_label = ? WHERE user_id = ?',
    [label, userId],
  );
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
    health: hctiHealthOf(row),
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

// --- OpenAI ------------------------------------------------------------------
//
// Deliberately the same shape as the HCTI functions above, because it is the
// same problem: one encrypted credential per user, saved, verified, replaced,
// removed. A second pattern in one table would be two things to get right.
//
// The gap this closes: OpenAI ran from ONE global application key for every
// customer, while HCTI was already per-user and encrypted.

/**
 * The encrypted OpenAI credential + its state. Never decrypts — the caller does
 * that immediately before use, exactly as with HCTI.
 */
export async function getOpenAiCredentialRecord(userId, connection) {
  const row = await findIntegrationByUserId(userId, connection);
  if (!row) return null;
  return {
    encryptedApiKey: row.openai_api_key_encrypted,
    encryptionVersion: row.openai_encryption_version,
    model: row.openai_model,
    verifiedAt: row.openai_verified_at,
    configured: row.openai_api_key_encrypted != null,
    health: openAiHealthOf(row),
  };
}

/** True when the user has an encrypted OpenAI key stored. */
export async function hasConfiguredOpenAiCredentials(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT 1 FROM user_integrations
      WHERE user_id = ? AND openai_api_key_encrypted IS NOT NULL LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Save or replace the encrypted OpenAI key.
 *
 * Replacing ALWAYS resets verification to NULL. A new key is an unproven key,
 * and carrying the old timestamp forward would show "verified" against a
 * credential nobody has ever used.
 *
 * @param {{userId, encryptedApiKey, model?, encryptionVersion?}} input
 */
export async function upsertEncryptedOpenAiCredentials(input, connection) {
  const {
    userId,
    encryptedApiKey,
    model = null,
    encryptionVersion = ENCRYPTION_VERSION,
  } = input;

  await runner(connection).execute(
    `INSERT INTO user_integrations
       (user_id, openai_api_key_encrypted, openai_encryption_version,
        openai_model, openai_verified_at)
     VALUES (?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       openai_api_key_encrypted = VALUES(openai_api_key_encrypted),
       openai_encryption_version = VALUES(openai_encryption_version),
       openai_model = VALUES(openai_model),
       openai_verified_at = NULL`,
    [userId, encryptedApiKey, encryptionVersion, model],
  );
}

/** Mark the stored OpenAI key as verified at the given UTC time. */
export async function markOpenAiVerified(userId, verifiedAt, connection) {
  await runner(connection).execute(
    'UPDATE user_integrations SET openai_verified_at = ? WHERE user_id = ?',
    [verifiedAt, userId],
  );
}

/** Clear verification without removing the key. */
export async function clearOpenAiVerification(userId, connection) {
  await runner(connection).execute(
    'UPDATE user_integrations SET openai_verified_at = NULL WHERE user_id = ?',
    [userId],
  );
}

/** Change only the selected model, leaving the key and its verification alone. */
export async function updateOpenAiModel(userId, model, connection) {
  await runner(connection).execute(
    'UPDATE user_integrations SET openai_model = ? WHERE user_id = ?',
    [model, userId],
  );
}

/**
 * Remove the OpenAI key: null the envelope, the model and the verification, and
 * reset the envelope version to its default (the column is NOT NULL, so
 * "cleared" means back to 1). The integration row survives, and so do the user's
 * HCTI credentials beside it. Safe when no row exists.
 */
export async function deleteOpenAiCredentials(userId, connection) {
  await runner(connection).execute(
    `UPDATE user_integrations
        SET openai_api_key_encrypted = NULL,
            openai_model = NULL,
            openai_encryption_version = 1,
            openai_verified_at = NULL
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
  getOpenAiCredentialRecord,
  hasConfiguredOpenAiCredentials,
  upsertEncryptedOpenAiCredentials,
  markOpenAiVerified,
  clearOpenAiVerification,
  updateOpenAiModel,
  deleteOpenAiCredentials,
  upsertEncryptedHctiCredentials,
  markHctiVerified,
  clearHctiVerification,
  deleteHctiCredentials,
  ensureIntegrationRow,
  recordHctiHealth,
  recordOpenAiHealth,
  setHctiLabel,
  setOpenAiLabel,
};
