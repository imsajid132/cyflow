/**
 * Post revision repository — the per-platform copy timeline.
 *
 * Every read and write is scoped by user_id in the WHERE clause, so one user can
 * never see or write another's history even if an item id is guessed. Ownership
 * comes from the authenticated session, never from the request body.
 *
 * What is stored is COPY: the caption and hashtags as they were at a revision.
 * Never a prompt, a key, a token, or a raw provider response — there is no
 * column here that could hold one.
 */

import { createHash } from 'node:crypto';

import { getPool } from '../db/pool.js';

function runner(connection) {
  return connection ?? getPool();
}

function safeParseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const REVISION_TYPES = new Set(['generated', 'retry', 'manual_edit', 'approved', 'queued']);
const PLATFORMS = new Set(['facebook', 'instagram', 'threads']);

/**
 * A stable content hash of one revision's copy.
 *
 * This is the whole of the "no duplicate identical revision" rule: the same copy
 * and the same hashtags hash to the same value, so a repeated save, a reopened
 * drawer or a browser retry that re-posts the same body finds an existing row
 * and writes nothing. Order of hashtags is preserved deliberately — reordering
 * hashtags IS a change a user can make.
 *
 * Non-secret by construction: it hashes copy that is about to be stored in the
 * clear anyway.
 */
export function revisionContentHash(postCopy, hashtags) {
  const payload = JSON.stringify({
    copy: typeof postCopy === 'string' ? postCopy : '',
    tags: Array.isArray(hashtags) ? hashtags : [],
  });
  return createHash('sha256').update(payload).digest('hex');
}

function toApi(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    plannerRunItemId: row.planner_run_item_id == null ? null : String(row.planner_run_item_id),
    scheduledPostId: row.scheduled_post_id == null ? null : String(row.scheduled_post_id),
    platform: row.platform,
    revisionType: row.revision_type,
    postCopy: row.post_copy ?? null,
    hashtags: safeParseJson(row.hashtags_json, []),
    validationStatus: row.validation_status ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Record a revision, unless the identical copy is already the latest one for
 * this item and platform.
 *
 * Idempotent on content: the dedup check compares against the MOST RECENT
 * revision for the (item, platform) pair, not against all of history, because a
 * user who edits A -> B -> A genuinely made three changes and the timeline
 * should show them. Only an immediate no-op repeat is suppressed.
 *
 * @returns {Promise<{ created: boolean, revision: object|null }>}
 */
export async function recordRevision(input, connection) {
  const {
    userId, plannerRunItemId, scheduledPostId = null,
    platform, revisionType, postCopy = null, hashtags = [], validationStatus = null,
  } = input;

  if (!PLATFORMS.has(platform)) throw new Error(`unknown platform: ${platform}`);
  if (!REVISION_TYPES.has(revisionType)) throw new Error(`unknown revision type: ${revisionType}`);

  const contentHash = revisionContentHash(postCopy, hashtags);
  const conn = runner(connection);

  /*
   * The latest revision for this item+platform. Suppress only a repeat of the
   * SAME operation: same content AND same type. That is what makes a duplicate
   * save, a reopened drawer or a re-posted request add nothing, while still
   * recording lifecycle transitions — an `approved` snapshot after a `generated`
   * one has the same copy but a different type, and the timeline should show
   * both. Comparing content alone would swallow the whole lifecycle.
   */
  const [existing] = await conn.execute(
    `SELECT content_hash, revision_type FROM post_revisions
      WHERE planner_run_item_id = ? AND user_id = ? AND platform = ?
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [plannerRunItemId, userId, platform],
  );
  if (existing.length && existing[0].content_hash === contentHash
      && existing[0].revision_type === revisionType) {
    return { created: false, revision: null };
  }

  const [result] = await conn.execute(
    `INSERT INTO post_revisions
       (user_id, planner_run_item_id, scheduled_post_id, platform, revision_type,
        post_copy, hashtags_json, validation_status, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, plannerRunItemId, scheduledPostId, platform, revisionType,
      postCopy, JSON.stringify(Array.isArray(hashtags) ? hashtags : []), validationStatus, contentHash,
    ],
  );
  const [rows] = await conn.execute(
    'SELECT * FROM post_revisions WHERE id = ?',
    [result.insertId],
  );
  return { created: true, revision: toApi(rows[0]) };
}

/**
 * The revision timeline for one item, newest first, scoped to the owner.
 *
 * Returns [] for another user's item rather than throwing: the caller has
 * already confirmed ownership of the ITEM, and this second user_id predicate is
 * defence in depth, not the primary gate.
 */
export async function listRevisionsForItem(plannerRunItemId, userId, { limit = 50 } = {}) {
  const conn = runner();
  const [rows] = await conn.execute(
    `SELECT * FROM post_revisions
      WHERE planner_run_item_id = ? AND user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [plannerRunItemId, userId, Math.max(1, Math.min(200, Number(limit) || 50))],
  );
  return rows.map(toApi);
}

export default { recordRevision, listRevisionsForItem, revisionContentHash };
