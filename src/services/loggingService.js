/**
 * Logging service — records sanitized security/activity events.
 *
 * Context objects are passed through the recursive redaction utility before
 * persistence, so passwords, API keys, tokens, cookies, and HCTI credentials
 * can never be written even if a caller passes them by mistake. Logging is
 * best-effort: a persistence failure NEVER propagates to the caller (it must
 * not turn a successful auth into an error), but it is surfaced to the
 * sanitized server logger.
 */

import { redact } from '../utils/redaction.js';
import * as defaultLogRepository from '../repositories/logRepository.js';

/**
 * @param {{ logRepository?: { insertLog: Function } }} [deps]
 */
export function createLoggingService({ logRepository = defaultLogRepository } = {}) {
  /**
   * Record a single event.
   * @param {string} eventType one of EVENT_TYPES
   * @param {{ req?: object, userId?: string|number|null, level?: string,
   *           message?: string|null, context?: object|null,
   *           connection?: object }} [opts]
   */
  async function record(eventType, opts = {}) {
    const { req, userId, level = 'info', message = null, context = null, connection } = opts;
    try {
      const safeContext = context == null ? null : redact(context);
      await logRepository.insertLog(
        {
          requestId: req?.id ?? null,
          userId: userId ?? req?.session?.userId ?? null,
          level,
          eventType,
          message,
          context: safeContext,
        },
        connection,
      );
    } catch (err) {
      // Never let logging break the primary flow. Surface a sanitized note.
      // eslint-disable-next-line no-console
      console.warn(
        '[logging] failed to persist event',
        JSON.stringify({ eventType, error: err?.code || err?.name || 'unknown' }),
      );
    }
  }

  return { record };
}

export const loggingService = createLoggingService();
export default loggingService;
