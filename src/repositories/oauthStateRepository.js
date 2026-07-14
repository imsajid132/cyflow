/**
 * OAuth state repository — prepared-statement access to `oauth_states`.
 *
 * Only the SHA-256 HASH of the raw state is ever stored (the service hashes
 * before calling here). Consumption is atomic: a transaction takes a row lock
 * (SELECT ... FOR UPDATE), validates provider/expiry/user/consumed, then marks
 * it consumed with a guarded UPDATE. Raw state never appears in this layer.
 */

import { getPool } from '../db/pool.js';
import { withTransaction as defaultWithTransaction } from '../db/transactions.js';
import { fromMysqlUtc } from '../utils/time.js';

function runner(connection) {
  return connection ?? getPool();
}

/**
 * Pure decision logic for a fetched state row. Exported for direct testing.
 * @param {object|null} row
 * @param {{ provider:string, expectedUserId:string|number, nowMs:number }} ctx
 * @returns {{ ok:boolean, reason?:string }}
 */
export function evaluateStateRow(row, { provider, expectedUserId, nowMs }) {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.provider !== provider) return { ok: false, reason: 'provider_mismatch' };
  if (row.consumed_at != null) return { ok: false, reason: 'already_consumed' };
  let expMs;
  try {
    expMs = fromMysqlUtc(row.expires_at).getTime();
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!Number.isFinite(expMs) || expMs <= nowMs) return { ok: false, reason: 'expired' };
  if (String(row.user_id) !== String(expectedUserId)) return { ok: false, reason: 'user_mismatch' };
  return { ok: true };
}

export function createOAuthStateRepository({ withTransaction = defaultWithTransaction } = {}) {
  async function createOAuthState(input, connection) {
    const {
      userId,
      provider,
      stateHash,
      encryptedCodeVerifier = null,
      redirectUri,
      expiresAt,
    } = input;
    await runner(connection).execute(
      `INSERT INTO oauth_states
         (user_id, provider, state_hash, code_verifier_encrypted, redirect_uri, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, provider, stateHash, encryptedCodeVerifier, redirectUri, expiresAt],
    );
  }

  /** Fetch a state row for update — MUST be called within a transaction. */
  async function findOAuthStateForUpdate({ stateHash, provider }, connection) {
    const [rows] = await connection.execute(
      `SELECT id, user_id, provider, state_hash, code_verifier_encrypted,
              redirect_uri, expires_at, consumed_at
         FROM oauth_states
        WHERE state_hash = ? AND provider = ?
        LIMIT 1
        FOR UPDATE`,
      [stateHash, provider],
    );
    return rows[0] ?? null;
  }

  /**
   * Atomically consume a state row exactly once.
   * @returns {Promise<{ ok:boolean, reason?:string, state?:object }>}
   */
  async function consumeOAuthState({ stateHash, provider, expectedUserId }) {
    return withTransaction(async (conn) => {
      const row = await findOAuthStateForUpdate({ stateHash, provider }, conn);
      const verdict = evaluateStateRow(row, {
        provider,
        expectedUserId,
        nowMs: Date.now(),
      });
      if (!verdict.ok) return { ok: false, reason: verdict.reason };

      const [result] = await conn.execute(
        'UPDATE oauth_states SET consumed_at = UTC_TIMESTAMP() WHERE id = ? AND consumed_at IS NULL',
        [row.id],
      );
      if (!result.affectedRows) {
        // Lost a race — already consumed.
        return { ok: false, reason: 'already_consumed' };
      }
      return {
        ok: true,
        state: {
          id: String(row.id),
          userId: String(row.user_id),
          provider: row.provider,
          redirectUri: row.redirect_uri,
          encryptedCodeVerifier: row.code_verifier_encrypted,
        },
      };
    });
  }

  async function deleteExpiredOAuthStates() {
    const [result] = await getPool().execute(
      'DELETE FROM oauth_states WHERE expires_at < UTC_TIMESTAMP()',
    );
    return result.affectedRows ?? 0;
  }

  async function deleteOAuthStatesForUserAndProvider(userId, provider, connection) {
    await runner(connection).execute(
      'DELETE FROM oauth_states WHERE user_id = ? AND provider = ?',
      [userId, provider],
    );
  }

  return {
    createOAuthState,
    findOAuthStateForUpdate,
    consumeOAuthState,
    deleteExpiredOAuthStates,
    deleteOAuthStatesForUserAndProvider,
  };
}

// Default singleton (production wiring).
const defaults = createOAuthStateRepository();
export const createOAuthState = defaults.createOAuthState;
export const findOAuthStateForUpdate = defaults.findOAuthStateForUpdate;
export const consumeOAuthState = defaults.consumeOAuthState;
export const deleteExpiredOAuthStates = defaults.deleteExpiredOAuthStates;
export const deleteOAuthStatesForUserAndProvider = defaults.deleteOAuthStatesForUserAndProvider;

export default defaults;
