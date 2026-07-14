/**
 * Social account repository — prepared-statement access to `social_accounts`.
 *
 * Public/list methods NEVER return encrypted token columns, IVs, or auth tags.
 * `findAccountWithEncryptedTokens` is the only method that returns ciphertext
 * (for internal decrypt-in-memory use). Every update/delete enforces user
 * ownership via a `user_id` predicate. Upserts key on the UNIQUE
 * (user_id, provider, provider_account_id) constraint (no duplicates).
 */

import { getPool } from '../db/pool.js';
import { SOCIAL_ACCOUNT_STATUS } from '../config/constants.js';

function runner(connection) {
  return connection ?? getPool();
}

/** Parse a JSON column value that may already be an object or a string. */
function safeParseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Map a raw row to a token-free sanitized object. */
export function sanitizeAccount(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    provider: row.provider,
    accountType: row.account_type,
    providerUserId: row.provider_user_id ?? null,
    providerAccountId: row.provider_account_id,
    displayName: row.display_name ?? null,
    username: row.username ?? null,
    status: row.status,
    tokenExpiresAt: row.token_expires_at ?? null,
    refreshTokenExpiresAt: row.refresh_token_expires_at ?? null,
    scopes: safeParseJson(row.scopes_json, []),
    providerMetadata: safeParseJson(row.provider_metadata_json, {}),
    lastVerifiedAt: row.last_verified_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

const NON_TOKEN_COLUMNS =
  'id, user_id, provider, account_type, provider_user_id, provider_account_id, ' +
  'display_name, username, token_expires_at, refresh_token_expires_at, scopes_json, ' +
  'provider_metadata_json, status, last_verified_at, created_at, updated_at';

export async function listAccountsForUser(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${NON_TOKEN_COLUMNS} FROM social_accounts
      WHERE user_id = ? ORDER BY created_at ASC`,
    [userId],
  );
  return rows.map(sanitizeAccount);
}

export async function findAccountByIdForUser(accountId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${NON_TOKEN_COLUMNS} FROM social_accounts
      WHERE id = ? AND user_id = ? LIMIT 1`,
    [accountId, userId],
  );
  return sanitizeAccount(rows[0] ?? null);
}

/** Internal only: includes encrypted token columns for decrypt-in-memory use. */
export async function findAccountWithEncryptedTokens(accountId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT id, user_id, provider, account_type, provider_user_id, provider_account_id,
            display_name, username, access_token_encrypted, refresh_token_encrypted,
            token_expires_at, refresh_token_expires_at, scopes_json, provider_metadata_json,
            status, last_verified_at, created_at, updated_at
       FROM social_accounts WHERE id = ? AND user_id = ? LIMIT 1`,
    [accountId, userId],
  );
  return rows[0] ?? null;
}

export async function findByProviderAccount(
  { userId, provider, accountType, providerAccountId },
  connection,
) {
  const [rows] = await runner(connection).execute(
    `SELECT ${NON_TOKEN_COLUMNS} FROM social_accounts
      WHERE user_id = ? AND provider = ? AND account_type = ? AND provider_account_id = ?
      LIMIT 1`,
    [userId, provider, accountType, providerAccountId],
  );
  return sanitizeAccount(rows[0] ?? null);
}

export async function upsertSocialAccount(input, connection) {
  const {
    userId,
    provider,
    accountType,
    providerUserId = null,
    providerAccountId,
    displayName = null,
    username = null,
    encryptedAccessToken = null,
    encryptedRefreshToken = null,
    tokenExpiresAt = null,
    refreshTokenExpiresAt = null,
    scopes = null,
    providerMetadata = null,
    status = SOCIAL_ACCOUNT_STATUS.ACTIVE,
    lastVerifiedAt = null,
  } = input;

  const conn = runner(connection);
  await conn.execute(
    `INSERT INTO social_accounts
       (user_id, provider, account_type, provider_user_id, provider_account_id,
        display_name, username, access_token_encrypted, refresh_token_encrypted,
        token_expires_at, refresh_token_expires_at, scopes_json, provider_metadata_json,
        status, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       account_type = VALUES(account_type),
       provider_user_id = VALUES(provider_user_id),
       display_name = VALUES(display_name),
       username = VALUES(username),
       access_token_encrypted = VALUES(access_token_encrypted),
       refresh_token_encrypted = VALUES(refresh_token_encrypted),
       token_expires_at = VALUES(token_expires_at),
       refresh_token_expires_at = VALUES(refresh_token_expires_at),
       scopes_json = VALUES(scopes_json),
       provider_metadata_json = VALUES(provider_metadata_json),
       status = VALUES(status),
       last_verified_at = VALUES(last_verified_at)`,
    [
      userId,
      provider,
      accountType,
      providerUserId,
      providerAccountId,
      displayName,
      username,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      refreshTokenExpiresAt,
      scopes == null ? null : JSON.stringify(scopes),
      providerMetadata == null ? null : JSON.stringify(providerMetadata),
      status,
      lastVerifiedAt,
    ],
  );

  return findByProviderAccount({ userId, provider, accountType, providerAccountId }, connection);
}

export async function updateEncryptedTokens(
  accountId,
  userId,
  { encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, refreshTokenExpiresAt },
  connection,
) {
  await runner(connection).execute(
    `UPDATE social_accounts
        SET access_token_encrypted = ?,
            refresh_token_encrypted = ?,
            token_expires_at = ?,
            refresh_token_expires_at = ?,
            status = ?
      WHERE id = ? AND user_id = ?`,
    [
      encryptedAccessToken,
      encryptedRefreshToken ?? null,
      tokenExpiresAt ?? null,
      refreshTokenExpiresAt ?? null,
      SOCIAL_ACCOUNT_STATUS.ACTIVE,
      accountId,
      userId,
    ],
  );
}

export async function updateVerificationStatus(
  accountId,
  userId,
  { displayName, lastVerifiedAt, status = SOCIAL_ACCOUNT_STATUS.ACTIVE },
  connection,
) {
  await runner(connection).execute(
    `UPDATE social_accounts
        SET display_name = COALESCE(?, display_name),
            last_verified_at = ?,
            status = ?
      WHERE id = ? AND user_id = ?`,
    [displayName ?? null, lastVerifiedAt ?? null, status, accountId, userId],
  );
  return findAccountByIdForUser(accountId, userId, connection);
}

async function setStatus(accountId, userId, status, connection) {
  await runner(connection).execute(
    'UPDATE social_accounts SET status = ? WHERE id = ? AND user_id = ?',
    [status, accountId, userId],
  );
}

export function markAccountExpired(accountId, userId, connection) {
  return setStatus(accountId, userId, SOCIAL_ACCOUNT_STATUS.EXPIRED, connection);
}

export function markAccountError(accountId, userId, connection) {
  return setStatus(accountId, userId, SOCIAL_ACCOUNT_STATUS.ERROR, connection);
}

/** Mark revoked and (optionally) securely erase encrypted tokens in place. */
export async function markAccountRevoked(accountId, userId, { eraseTokens = true } = {}, connection) {
  if (eraseTokens) {
    await runner(connection).execute(
      `UPDATE social_accounts
          SET status = ?, access_token_encrypted = NULL, refresh_token_encrypted = NULL,
              token_expires_at = NULL, refresh_token_expires_at = NULL
        WHERE id = ? AND user_id = ?`,
      [SOCIAL_ACCOUNT_STATUS.REVOKED, accountId, userId],
    );
  } else {
    await setStatus(accountId, userId, SOCIAL_ACCOUNT_STATUS.REVOKED, connection);
  }
}

export async function deleteAccountForUser(accountId, userId, connection) {
  const [result] = await runner(connection).execute(
    'DELETE FROM social_accounts WHERE id = ? AND user_id = ?',
    [accountId, userId],
  );
  return (result.affectedRows ?? 0) > 0;
}

/** True if any scheduled_post_targets reference this account (history to keep). */
export async function hasPublishedHistory(accountId, connection) {
  const [rows] = await runner(connection).execute(
    'SELECT 1 FROM scheduled_post_targets WHERE social_account_id = ? LIMIT 1',
    [accountId],
  );
  return rows.length > 0;
}

export default {
  sanitizeAccount,
  listAccountsForUser,
  findAccountByIdForUser,
  findAccountWithEncryptedTokens,
  findByProviderAccount,
  upsertSocialAccount,
  updateEncryptedTokens,
  updateVerificationStatus,
  markAccountExpired,
  markAccountError,
  markAccountRevoked,
  deleteAccountForUser,
  hasPublishedHistory,
};
