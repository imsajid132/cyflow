/**
 * Activity-log repository — prepared-statement inserts into `activity_logs`.
 *
 * Callers (loggingService) are responsible for redacting `context` BEFORE it
 * reaches this layer. This repository simply persists the already-safe row.
 */

import { getPool } from '../db/pool.js';

function runner(connection) {
  return connection ?? getPool();
}

/**
 * Insert one activity/security log row.
 * @param {{
 *   requestId?: string|null,
 *   userId?: string|number|null,
 *   scheduledPostId?: string|number|null,
 *   scheduledPostTargetId?: string|number|null,
 *   level?: string,
 *   eventType: string,
 *   message?: string|null,
 *   context?: object|null,
 * }} entry
 * @param {import('mysql2/promise').PoolConnection} [connection]
 */
export async function insertLog(entry, connection) {
  const {
    requestId = null,
    userId = null,
    scheduledPostId = null,
    scheduledPostTargetId = null,
    level = 'info',
    eventType,
    message = null,
    context = null,
  } = entry;

  await runner(connection).execute(
    `INSERT INTO activity_logs
       (request_id, user_id, scheduled_post_id, scheduled_post_target_id,
        level, event_type, message, context_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      requestId,
      userId,
      scheduledPostId,
      scheduledPostTargetId,
      level,
      eventType,
      message,
      context == null ? null : JSON.stringify(context),
    ],
  );
}

export default { insertLog };
