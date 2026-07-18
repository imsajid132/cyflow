/**
 * D2 publishing data access: publish_attempts (the reconciliation ledger) and
 * the target-level publish state on scheduled_post_targets. Every method is
 * user-scoped in SQL, exactly as ownership requires. Only SAFE fields are stored
 * or returned — no tokens, no raw provider bodies.
 */

import { getPool } from '../db/pool.js';
import { withTransaction } from '../db/transactions.js';
import { toMysqlUtc } from '../utils/time.js';
import { ACCOUNT_TYPE_TO_PLATFORM } from '../config/constants.js';

function runner(connection) {
  return connection ?? getPool();
}
const jsonCol = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

// --- publish_attempts -------------------------------------------------------

const ATTEMPT_COLS = 'id, user_id, scheduled_post_id, scheduled_post_target_id, social_account_id, '
  + 'background_job_id, provider, status, idempotency_key, provider_container_id, provider_post_id, '
  + 'provider_request_id, provider_status, attempt_number, error_category, safe_error_message, '
  + 'started_at, submitted_at, published_at, last_checked_at, next_reconcile_at, created_at, updated_at';

export function sanitizeAttempt(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    scheduledPostId: String(row.scheduled_post_id),
    targetId: String(row.scheduled_post_target_id),
    socialAccountId: row.social_account_id == null ? null : String(row.social_account_id),
    backgroundJobId: row.background_job_id == null ? null : String(row.background_job_id),
    provider: row.provider,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    providerContainerId: row.provider_container_id ?? null,
    providerPostId: row.provider_post_id ?? null,
    providerRequestId: row.provider_request_id ?? null,
    providerStatus: row.provider_status ?? null,
    attemptNumber: Number(row.attempt_number ?? 1),
    errorCategory: row.error_category ?? null,
    safeErrorMessage: row.safe_error_message ?? null,
    startedAt: row.started_at ?? null,
    submittedAt: row.submitted_at ?? null,
    publishedAt: row.published_at ?? null,
    lastCheckedAt: row.last_checked_at ?? null,
    nextReconcileAt: row.next_reconcile_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * Idempotently create a publish attempt. The UNIQUE(idempotency_key) means a
 * duplicated publish job reuses the SAME attempt row rather than creating a
 * second one (and therefore a second provider post).
 */
export async function createAttemptIfAbsent(input, connection) {
  const conn = runner(connection);
  const [res] = await conn.execute(
    `INSERT INTO publish_attempts
       (user_id, scheduled_post_id, scheduled_post_target_id, social_account_id, background_job_id,
        provider, status, idempotency_key, attempt_number, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'started', ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [input.userId, input.scheduledPostId, input.targetId, input.socialAccountId ?? null,
      input.backgroundJobId ?? null, input.provider, input.idempotencyKey,
      input.attemptNumber ?? 1, toMysqlUtc(new Date())],
  );
  const created = res.affectedRows === 1;
  const [rows] = await conn.execute(`SELECT ${ATTEMPT_COLS} FROM publish_attempts WHERE id = ? LIMIT 1`, [res.insertId]);
  return { attempt: sanitizeAttempt(rows[0]), created };
}

const ATTEMPT_UPDATABLE = new Map([
  ['status', 'status'], ['providerContainerId', 'provider_container_id'], ['providerPostId', 'provider_post_id'],
  ['providerRequestId', 'provider_request_id'], ['providerStatus', 'provider_status'],
  ['errorCategory', 'error_category'], ['safeErrorMessage', 'safe_error_message'],
  ['submittedAt', 'submitted_at'], ['publishedAt', 'published_at'], ['lastCheckedAt', 'last_checked_at'],
  ['nextReconcileAt', 'next_reconcile_at'], ['attemptNumber', 'attempt_number'],
]);

export async function updateAttempt(id, userId, fields, connection) {
  const sets = []; const params = [];
  for (const [key, col] of ATTEMPT_UPDATABLE) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`\`${col}\` = ?`);
      params.push(fields[key] instanceof Date ? toMysqlUtc(fields[key]) : fields[key] ?? null);
    }
  }
  if (!sets.length) return findAttemptById(id, userId, connection);
  params.push(id, userId);
  await runner(connection).execute(`UPDATE publish_attempts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  return findAttemptById(id, userId, connection);
}

export async function findAttemptById(id, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${ATTEMPT_COLS} FROM publish_attempts WHERE id = ? AND user_id = ? LIMIT 1`, [id, userId],
  );
  return sanitizeAttempt(rows[0]);
}

export async function findAttemptByIdempotencyKey(key, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${ATTEMPT_COLS} FROM publish_attempts WHERE idempotency_key = ? LIMIT 1`, [key],
  );
  return sanitizeAttempt(rows[0]);
}

/** Safe attempt history for a target (newest first). */
export async function listAttemptsForTarget(targetId, userId, { limit = 20 } = {}, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${ATTEMPT_COLS} FROM publish_attempts
      WHERE scheduled_post_target_id = ? AND user_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [targetId, userId, Math.max(1, Math.min(100, limit))],
  );
  return rows.map(sanitizeAttempt);
}

/** Attempts whose result is uncertain and due for reconciliation. */
export async function listAttemptsToReconcile({ now = new Date(), limit = 50 } = {}, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${ATTEMPT_COLS} FROM publish_attempts
      WHERE status IN ('submitted','reconciling','unknown_result')
        AND (next_reconcile_at IS NULL OR next_reconcile_at <= ?)
      ORDER BY next_reconcile_at IS NULL DESC, next_reconcile_at ASC
      LIMIT ?`,
    [toMysqlUtc(now), limit],
  );
  return rows.map(sanitizeAttempt);
}

// --- target publish state ---------------------------------------------------

const TARGET_JOIN = `
  FROM scheduled_post_targets t
  JOIN scheduled_posts p ON p.id = t.scheduled_post_id
  JOIN social_accounts sa ON sa.id = t.social_account_id`;

const TARGET_SELECT = `
  t.id AS target_id, t.scheduled_post_id, t.social_account_id, t.status, t.publish_status,
  t.attempt_count, t.next_attempt_at, t.remote_post_id, t.remote_post_url, t.attention_reason,
  t.last_publish_attempt_id, t.caption_override,
  p.user_id, p.status AS post_status, p.scheduled_at_utc, p.generated_platform_captions_json,
  p.generated_base_caption, p.media_asset_id,
  sa.provider, sa.account_type, sa.provider_account_id, sa.status AS account_status,
  sa.display_name, sa.username`;

function sanitizeTargetForPublish(row) {
  if (!row) return null;
  const platform = ACCOUNT_TYPE_TO_PLATFORM[row.account_type] || null;
  const captions = jsonCol(row.generated_platform_captions_json) || {};
  const perPlatform = platform ? captions[platform] : null;
  // Precedence: explicit override -> platform-specific copy -> base caption.
  const caption = row.caption_override || perPlatform?.caption || row.generated_base_caption || '';
  return {
    targetId: String(row.target_id),
    scheduledPostId: String(row.scheduled_post_id),
    userId: String(row.user_id),
    socialAccountId: String(row.social_account_id),
    provider: row.provider,
    accountType: row.account_type,
    platform,
    providerAccountId: row.provider_account_id,
    accountStatus: row.account_status,
    displayName: row.display_name ?? null,
    username: row.username ?? null,
    status: row.status,
    publishStatus: row.publish_status,
    attemptCount: Number(row.attempt_count ?? 0),
    attentionReason: row.attention_reason ?? null,
    lastPublishAttemptId: row.last_publish_attempt_id == null ? null : String(row.last_publish_attempt_id),
    remotePostId: row.remote_post_id ?? null,
    postStatus: row.post_status,
    scheduledAtUtc: row.scheduled_at_utc ?? null,
    mediaAssetId: row.media_asset_id == null ? null : String(row.media_asset_id),
    caption,
  };
}

export async function findTargetForPublish(targetId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${TARGET_SELECT} ${TARGET_JOIN} WHERE t.id = ? AND p.user_id = ? LIMIT 1`, [targetId, userId],
  );
  return sanitizeTargetForPublish(rows[0]);
}

/**
 * Targets that are ready to publish: their post is queued and due, and the
 * target has not yet been published (scheduled or a retry that is now due).
 */
export async function listDuePublishTargets({ now = new Date(), limit = 50 } = {}, connection) {
  const nowStr = toMysqlUtc(now);
  const [rows] = await runner(connection).execute(
    `SELECT ${TARGET_SELECT} ${TARGET_JOIN}
      WHERE p.status IN ('queued','processing','partial','retrying')
        AND p.scheduled_at_utc IS NOT NULL AND p.scheduled_at_utc <= ?
        AND t.publish_status IN ('scheduled','retry_scheduled')
        AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= ?)
      ORDER BY p.scheduled_at_utc ASC, t.id ASC
      LIMIT ?`,
    [nowStr, nowStr, limit],
  );
  return rows.map(sanitizeTargetForPublish);
}

/**
 * E (Publish Now): the enqueue-able targets of ONE owned post — those still
 * `scheduled`/`retry_scheduled`, regardless of due time. Ownership is enforced
 * by the post's user_id. Used to enqueue durable publish jobs immediately when a
 * user chooses "Publish Now" (the job itself still respects the live flag).
 */
export async function listPublishTargetsForPost(postId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${TARGET_SELECT} ${TARGET_JOIN}
      WHERE p.id = ? AND p.user_id = ?
        AND t.publish_status IN ('scheduled','retry_scheduled')
      ORDER BY t.id ASC`,
    [postId, userId],
  );
  return rows.map(sanitizeTargetForPublish);
}

/** Atomically claim a target for a publish attempt (scheduled/retry -> publishing). */
export async function claimTargetForPublish(targetId, userId, connection) {
  const run = async (conn) => {
    const [rows] = await conn.execute(
      `SELECT t.id, t.publish_status FROM scheduled_post_targets t
        JOIN scheduled_posts p ON p.id = t.scheduled_post_id
        WHERE t.id = ? AND p.user_id = ? LIMIT 1 FOR UPDATE`, [targetId, userId],
    );
    const row = rows[0];
    if (!row || !['scheduled', 'retry_scheduled'].includes(row.publish_status)) return false;
    const [res] = await conn.execute(
      `UPDATE scheduled_post_targets SET publish_status = 'publishing', last_attempt_at = ?, attempt_count = attempt_count + 1
        WHERE id = ? AND publish_status IN ('scheduled','retry_scheduled')`,
      [toMysqlUtc(new Date()), targetId],
    );
    return res.affectedRows > 0;
  };
  return connection ? run(connection) : withTransaction(run);
}

const TARGET_UPDATABLE = new Map([
  ['status', 'status'], ['publishStatus', 'publish_status'], ['attentionReason', 'attention_reason'],
  ['nextAttemptAt', 'next_attempt_at'], ['remotePostId', 'remote_post_id'], ['remotePostUrl', 'remote_post_url'],
  ['lastErrorCode', 'last_error_code'], ['lastErrorMessage', 'last_error_message'],
  ['publishedAt', 'published_at'], ['lastPublishAttemptId', 'last_publish_attempt_id'],
]);

/** Update a target's publish state, scoped to the owner via the post. */
export async function updateTargetPublishState(targetId, userId, fields, connection) {
  const sets = []; const params = [];
  for (const [key, col] of TARGET_UPDATABLE) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`t.\`${col}\` = ?`);
      params.push(fields[key] instanceof Date ? toMysqlUtc(fields[key]) : fields[key] ?? null);
    }
  }
  if (fields.providerResponse !== undefined) {
    sets.push('t.`provider_response_json` = CAST(? AS JSON)');
    params.push(fields.providerResponse == null ? null : JSON.stringify(fields.providerResponse));
  }
  if (!sets.length) return;
  params.push(targetId, userId);
  await runner(connection).execute(
    `UPDATE scheduled_post_targets t JOIN scheduled_posts p ON p.id = t.scheduled_post_id
       SET ${sets.join(', ')} WHERE t.id = ? AND p.user_id = ?`, params,
  );
}

/**
 * Manually retry a failed/attention target: bump attempt_count (so the next
 * enqueue gets a fresh idempotency key) and re-schedule it, in one atomic UPDATE.
 */
export async function retryTargetForPublish(targetId, userId, connection) {
  const [res] = await runner(connection).execute(
    `UPDATE scheduled_post_targets t JOIN scheduled_posts p ON p.id = t.scheduled_post_id
        SET t.publish_status = 'retry_scheduled', t.attention_reason = NULL,
            t.next_attempt_at = ?, t.attempt_count = t.attempt_count + 1
      WHERE t.id = ? AND p.user_id = ? AND t.publish_status IN ('failed','attention_needed')`,
    [toMysqlUtc(new Date()), targetId, userId],
  );
  return res.affectedRows > 0;
}

/**
 * Recompute the post-level status from its targets (partial-success honesty):
 * all published -> published; some published -> partial; none published but any
 * publishing/scheduled -> processing; all failed -> failed; all cancelled ->
 * cancelled. Never claims a blanket success when a target still fails.
 */
export async function rollupPostStatus(postId, userId, connection) {
  const conn = runner(connection);
  const [rows] = await conn.execute(
    `SELECT publish_status, COUNT(*) AS n FROM scheduled_post_targets
      WHERE scheduled_post_id = ? GROUP BY publish_status`, [postId],
  );
  const c = {}; let total = 0;
  for (const r of rows) { c[r.publish_status] = Number(r.n); total += Number(r.n); }
  if (!total) return null;
  const published = c.published || 0;
  const terminalBad = (c.failed || 0) + (c.cancelled || 0) + (c.skipped || 0) + (c.attention_needed || 0);
  let status;
  if (published === total) status = 'published';
  else if (published > 0 && published + terminalBad === total) status = 'partial';
  else if (published > 0) status = 'partial';
  else if ((c.cancelled || 0) === total) status = 'cancelled';
  else if (terminalBad === total) status = 'failed';
  else status = 'processing';
  await conn.execute(
    `UPDATE scheduled_posts SET status = ?, published_at = IF(? = 'published', COALESCE(published_at, UTC_TIMESTAMP()), published_at)
      WHERE id = ? AND user_id = ?`, [status, status, postId, userId],
  );
  return status;
}

export default {
  sanitizeAttempt, createAttemptIfAbsent, updateAttempt, findAttemptById, findAttemptByIdempotencyKey,
  listAttemptsForTarget, listAttemptsToReconcile,
  findTargetForPublish, listDuePublishTargets, listPublishTargetsForPost, claimTargetForPublish, updateTargetPublishState,
  retryTargetForPublish, rollupPostStatus,
};
