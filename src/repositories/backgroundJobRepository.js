/**
 * background_jobs + worker_leases — the durable, database-backed job queue.
 *
 * The DATABASE is authoritative. A worker claims a job atomically (SELECT ...
 * FOR UPDATE inside a transaction, then a guarded UPDATE whose affectedRows
 * proves it won the race), writing a lease (locked_by / locked_until). A crashed
 * worker's job becomes reclaimable once its lease expires — nothing stays stuck
 * "running" forever. Enqueue is idempotent on idempotency_key, so a duplicated
 * scheduler tick or a double user click produces ONE job.
 *
 * This models general jobs (refill, slot-generation, reconcile, recovery). It is
 * deliberately separate from the per-post publish-job columns on scheduled_posts,
 * which belong to D2 provider publishing.
 */

import { getPool } from '../db/pool.js';
import { withTransaction } from '../db/transactions.js';
import { toMysqlUtc, fromMysqlUtc } from '../utils/time.js';
import { JOB_STATUS } from '../config/constants.js';

function runner(connection) {
  return connection ?? getPool();
}

/** Public, id-stringified shape. payload/errors included; never a raw secret. */
export function sanitizeJob(row) {
  if (!row) return null;
  let payload = null;
  if (row.payload_json != null) {
    payload = typeof row.payload_json === 'string' ? safeJson(row.payload_json) : row.payload_json;
  }
  return {
    id: String(row.id),
    userId: row.user_id == null ? null : String(row.user_id),
    automationId: row.automation_id == null ? null : String(row.automation_id),
    jobType: row.job_type,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    payload,
    scheduledFor: row.scheduled_for ?? null,
    availableAt: row.available_at ?? null,
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    lockedBy: row.locked_by ?? null,
    lockedUntil: row.locked_until ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    lastErrorCategory: row.last_error_category ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Idempotent enqueue. If a job with this idempotency_key already exists, no new
 * row is created and the existing job is returned with created=false.
 *
 * @returns {Promise<{ job: object, created: boolean }>}
 */
export async function enqueueJob(input, connection) {
  const conn = runner(connection);
  const availableAt = input.availableAt ? toMysqlUtc(input.availableAt) : toMysqlUtc(new Date());
  const [result] = await conn.execute(
    `INSERT INTO background_jobs
       (user_id, automation_id, job_type, status, idempotency_key, payload_json,
        scheduled_for, available_at, attempt_count, max_attempts)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      input.userId ?? null,
      input.automationId ?? null,
      input.jobType,
      input.idempotencyKey,
      input.payload == null ? null : JSON.stringify(input.payload),
      input.scheduledFor ? toMysqlUtc(input.scheduledFor) : null,
      availableAt,
      Number.isInteger(input.maxAttempts) ? input.maxAttempts : 5,
    ],
  );
  // affectedRows: 1 = inserted (created), 2 = matched an existing row (not created).
  const created = result.affectedRows === 1;
  const [rows] = await conn.execute('SELECT * FROM background_jobs WHERE id = ? LIMIT 1', [result.insertId]);
  return { job: sanitizeJob(rows[0]), created };
}

/**
 * Atomically claim the next runnable job for this worker. Returns the claimed
 * job (status flipped to running, lease written, attempt incremented) or null.
 *
 * The FOR UPDATE + guarded UPDATE is the single-flight guarantee: two workers
 * cannot both claim the same row.
 */
export async function claimNextJob({ workerId, leaseMs = 60000, now = new Date(), jobTypes = null }, connection) {
  const run = async (conn) => {
    const params = [toMysqlUtc(now), toMysqlUtc(now)];
    let typeClause = '';
    if (Array.isArray(jobTypes) && jobTypes.length) {
      typeClause = ` AND job_type IN (${jobTypes.map(() => '?').join(',')})`;
      params.push(...jobTypes);
    }
    const [rows] = await conn.execute(
      `SELECT id FROM background_jobs
        WHERE status IN ('pending','retry_scheduled')
          AND available_at <= ?
          AND (locked_until IS NULL OR locked_until <= ?)${typeClause}
        ORDER BY available_at ASC, id ASC
        LIMIT 1
        FOR UPDATE`,
      params,
    );
    const id = rows[0]?.id;
    if (!id) return null;
    const lockedUntil = toMysqlUtc(new Date(now.getTime() + leaseMs));
    const [res] = await conn.execute(
      `UPDATE background_jobs
          SET status = 'running', locked_by = ?, locked_until = ?, heartbeat_at = ?,
              attempt_count = attempt_count + 1
        WHERE id = ? AND status IN ('pending','retry_scheduled')`,
      [workerId, lockedUntil, toMysqlUtc(now), id],
    );
    if (!res.affectedRows) return null; // lost the race
    const [claimed] = await conn.execute('SELECT * FROM background_jobs WHERE id = ? LIMIT 1', [id]);
    return sanitizeJob(claimed[0]);
  };
  return connection ? run(connection) : withTransaction(run);
}

/** Extend the lease on a running job this worker owns. */
export async function heartbeatJob({ jobId, workerId, leaseMs = 60000, now = new Date() }, connection) {
  const [res] = await runner(connection).execute(
    `UPDATE background_jobs SET heartbeat_at = ?, locked_until = ?
      WHERE id = ? AND locked_by = ? AND status = 'running'`,
    [toMysqlUtc(now), toMysqlUtc(new Date(now.getTime() + leaseMs)), jobId, workerId],
  );
  return res.affectedRows > 0;
}

export async function completeJob({ jobId, workerId, now = new Date() }, connection) {
  const [res] = await runner(connection).execute(
    `UPDATE background_jobs
        SET status = 'completed', completed_at = ?, locked_by = NULL, locked_until = NULL
      WHERE id = ? AND locked_by = ?`,
    [toMysqlUtc(now), jobId, workerId],
  );
  return res.affectedRows > 0;
}

/** Schedule a transient-failure retry with a backed-off available_at. */
export async function retryJob({ jobId, workerId, availableAt, errorCategory, errorMessage }, connection) {
  const [res] = await runner(connection).execute(
    `UPDATE background_jobs
        SET status = 'retry_scheduled', available_at = ?, locked_by = NULL, locked_until = NULL,
            last_error_category = ?, last_error_message = ?
      WHERE id = ? AND locked_by = ?`,
    [toMysqlUtc(availableAt), errorCategory ?? null, truncate(errorMessage), jobId, workerId],
  );
  return res.affectedRows > 0;
}

/** Mark a job permanently failed (permanent error or attempts exhausted). */
export async function failJob({ jobId, workerId, errorCategory, errorMessage, now = new Date() }, connection) {
  const [res] = await runner(connection).execute(
    `UPDATE background_jobs
        SET status = 'failed', completed_at = ?, locked_by = NULL, locked_until = NULL,
            last_error_category = ?, last_error_message = ?
      WHERE id = ? AND locked_by = ?`,
    [toMysqlUtc(now), errorCategory ?? null, truncate(errorMessage), jobId, workerId],
  );
  return res.affectedRows > 0;
}

export async function cancelJobsForAutomation({ automationId, userId }, connection) {
  const [res] = await runner(connection).execute(
    `UPDATE background_jobs SET status = 'cancelled', locked_by = NULL, locked_until = NULL
      WHERE automation_id = ? AND user_id = ? AND status IN ('pending','retry_scheduled')`,
    [automationId, userId],
  );
  return res.affectedRows;
}

/**
 * Reclaim jobs whose lease expired while 'running' (a crashed worker). Under the
 * attempt cap they go back to claimable; at/over the cap they are failed so they
 * do not loop forever.
 */
export async function recoverStaleJobs({ now = new Date(), limit = 50 }, connection) {
  const conn = runner(connection);
  const nowStr = toMysqlUtc(now);
  const [reclaim] = await conn.execute(
    `UPDATE background_jobs
        SET status = 'retry_scheduled', available_at = ?, locked_by = NULL, locked_until = NULL,
            last_error_category = 'transient', last_error_message = 'Recovered after a stale worker lease'
      WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < ?
        AND attempt_count < max_attempts
      LIMIT ?`,
    [nowStr, nowStr, limit],
  );
  const [failed] = await conn.execute(
    `UPDATE background_jobs
        SET status = 'failed', completed_at = ?, locked_by = NULL, locked_until = NULL,
            last_error_category = 'transient', last_error_message = 'Exhausted attempts after stale worker lease'
      WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < ?
        AND attempt_count >= max_attempts
      LIMIT ?`,
    [nowStr, nowStr, limit],
  );
  return { reclaimed: reclaim.affectedRows, failed: failed.affectedRows };
}

export async function findJobByIdempotencyKey(idempotencyKey, connection) {
  const [rows] = await runner(connection).execute(
    'SELECT * FROM background_jobs WHERE idempotency_key = ? LIMIT 1', [idempotencyKey],
  );
  return sanitizeJob(rows[0]);
}

export async function findJobById(id, connection) {
  const [rows] = await runner(connection).execute('SELECT * FROM background_jobs WHERE id = ? LIMIT 1', [id]);
  return sanitizeJob(rows[0]);
}

/** Health/metrics: counts by status, and how many running leases are stale. */
export async function jobStats({ now = new Date() } = {}, connection) {
  const conn = runner(connection);
  const [byStatus] = await conn.execute('SELECT status, COUNT(*) AS n FROM background_jobs GROUP BY status');
  const counts = {};
  for (const r of byStatus) counts[r.status] = Number(r.n);
  const [stale] = await conn.execute(
    "SELECT COUNT(*) AS n FROM background_jobs WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < ?",
    [toMysqlUtc(now)],
  );
  const pending = (counts[JOB_STATUS.PENDING] || 0) + (counts[JOB_STATUS.RETRY_SCHEDULED] || 0);
  return { counts, pending, running: counts[JOB_STATUS.RUNNING] || 0, stale: Number(stale[0]?.n ?? 0) };
}

function truncate(text, max = 1000) {
  if (typeof text !== 'string') return null;
  return text.length > max ? text.slice(0, max) : text;
}

// --- worker_leases: named singleton locks -----------------------------------

/**
 * Acquire (or renew) a named lease. Returns true if this owner now holds it.
 * Correctness never depends on this — job idempotency keys and job leases do —
 * it only stops two workers doing the same sweep at once.
 */
export async function acquireLease({ lockName, owner, ttlMs, now = new Date() }, connection) {
  const run = async (conn) => {
    const [rows] = await conn.execute(
      'SELECT owner, expires_at FROM worker_leases WHERE lock_name = ? FOR UPDATE', [lockName],
    );
    const held = rows[0];
    if (held && held.owner !== owner && fromMysqlUtc(held.expires_at) > now) {
      return false; // a different owner holds a live lease
    }
    await conn.execute(
      `INSERT INTO worker_leases (lock_name, owner, acquired_at, expires_at, heartbeat_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE owner = VALUES(owner), acquired_at = VALUES(acquired_at),
                               expires_at = VALUES(expires_at), heartbeat_at = VALUES(heartbeat_at)`,
      [lockName, owner, toMysqlUtc(now), toMysqlUtc(new Date(now.getTime() + ttlMs)), toMysqlUtc(now)],
    );
    return true;
  };
  return connection ? run(connection) : withTransaction(run);
}

/**
 * Acquire (or renew) a named lease using DATABASE time.
 *
 * Same proven pattern as `acquireLease` — SELECT ... FOR UPDATE inside a
 * transaction, so two instances racing on the same lock_name serialise on the
 * row — but every timestamp comes from `UTC_TIMESTAMP()` rather than from the
 * caller's clock.
 *
 * That distinction matters for the case this exists to fix: several managed web
 * instances of the SAME application, each deciding for itself whether a lease
 * has expired. With JS time, a machine whose clock runs a few seconds fast
 * considers a live lease expired and takes it, and both instances run the tick.
 * With database time there is one clock, and it is the same clock that wrote
 * `expires_at`.
 *
 * `acquireLease` above keeps its caller-supplied clock: its tests drive expiry
 * by passing explicit timestamps, and that is a legitimate thing to want.
 *
 * @returns {Promise<boolean>} true when this owner now holds the lease
 */
export async function acquireLeaseDbTime({ lockName, owner, ttlSeconds }, connection) {
  const run = async (conn) => {
    const [rows] = await conn.execute(
      `SELECT owner, (expires_at > UTC_TIMESTAMP()) AS live
         FROM worker_leases WHERE lock_name = ? FOR UPDATE`,
      [lockName],
    );
    const held = rows[0];
    // A different owner with an unexpired lease wins; we skip this round.
    if (held && held.owner !== owner && Number(held.live) === 1) return false;
    await conn.execute(
      `INSERT INTO worker_leases (lock_name, owner, acquired_at, expires_at, heartbeat_at)
       VALUES (?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE owner = VALUES(owner), acquired_at = VALUES(acquired_at),
                               expires_at = VALUES(expires_at), heartbeat_at = VALUES(heartbeat_at)`,
      [lockName, owner, ttlSeconds],
    );
    return true;
  };
  return connection ? run(connection) : withTransaction(run);
}

export async function releaseLease({ lockName, owner }, connection) {
  const [res] = await runner(connection).execute(
    'DELETE FROM worker_leases WHERE lock_name = ? AND owner = ?', [lockName, owner],
  );
  return res.affectedRows > 0;
}

/**
 * G: cancel every still-pending job for a user (account deletion), so the worker
 * cannot claim one mid-delete. Running/completed jobs are left as-is. The rows
 * themselves cascade away with the user; this just stops new work first.
 */
export async function cancelAllJobsForUser(userId, connection) {
  const [res] = await runner(connection).execute(
    "UPDATE background_jobs SET status = 'cancelled' WHERE user_id = ? AND status IN ('pending','retry_scheduled')",
    [userId],
  );
  return res.affectedRows ?? 0;
}

export default {
  sanitizeJob,
  enqueueJob,
  claimNextJob,
  heartbeatJob,
  completeJob,
  retryJob,
  failJob,
  cancelJobsForAutomation,
  cancelAllJobsForUser,
  recoverStaleJobs,
  findJobByIdempotencyKey,
  findJobById,
  jobStats,
  acquireLease,
  acquireLeaseDbTime,
  releaseLease,
};
