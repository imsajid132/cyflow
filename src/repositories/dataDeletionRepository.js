/**
 * Data-deletion request repository — prepared-statement access to
 * `data_deletion_requests`. Stores confirmation-code receipts for Meta/Threads
 * data-deletion callbacks. No personal data is stored beyond an opaque provider
 * user id (never exposed by the status endpoint).
 */

import { getPool } from '../db/pool.js';

function runner(connection) {
  return connection ?? getPool();
}

/**
 * Record a data-deletion request.
 * @param {{ confirmationCode, provider, providerUserId?, status?, accountsRemoved? }} input
 */
export async function createDeletionRequest(input, connection) {
  const {
    confirmationCode,
    provider,
    providerUserId = null,
    status = 'received',
    accountsRemoved = 0,
  } = input;
  await runner(connection).execute(
    `INSERT INTO data_deletion_requests
       (confirmation_code, provider, provider_user_id, status, accounts_removed)
     VALUES (?, ?, ?, ?, ?)`,
    [confirmationCode, provider, providerUserId, status, accountsRemoved],
  );
}

/** Look up a deletion request by its confirmation code. Returns a safe subset. */
export async function findByConfirmationCode(confirmationCode, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT confirmation_code, provider, status, created_at
       FROM data_deletion_requests WHERE confirmation_code = ? LIMIT 1`,
    [confirmationCode],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    confirmationCode: row.confirmation_code,
    provider: row.provider,
    status: row.status,
    createdAt: row.created_at ?? null,
  };
}

export default { createDeletionRequest, findByConfirmationCode };
