/**
 * Safe structured logging for provider + background-job failures.
 *
 * Emits ONE greppable JSON line to stdout so an operator can search the runtime
 * logs for `provider_operation_failed`, `hcti`, `credits_exhausted`,
 * `image_render_failed`, `job_failed`, etc. This is deliberately a strict
 * ALLOW-LIST: only the safe, non-secret fields below are ever emitted. It never
 * logs an API key, an access token, an Authorization header, a full provider
 * response, prompt content or generated post copy — those keys are dropped even
 * if a caller passes them.
 *
 * It complements (does not replace) `loggingService.record`, which persists a
 * redacted event to `activity_logs` for the in-app diagnostics UI.
 */

// The only fields allowed onto a structured line. Anything else is discarded.
const SAFE_FIELDS = new Set([
  'event', 'provider', 'operation', 'category', 'errorCode', 'httpStatus',
  'retryable', 'requestId', 'jobType', 'jobId', 'automationId', 'attempt',
  'attemptNumber', 'maximumAttempts', 'plannerItemId', 'plannerRunId',
  'userIdHash', 'occurredAt', 'shortLabel', 'count', 'expected', 'created',
  'completed', 'failed', 'skippedPast', 'skippedDuplicate', 'ready',
  'candidate', 'alreadyPresent', 'readyDays', 'pending', 'horizon',
]);

function iso() {
  // Regular runtime code (unlike workflow scripts) may read the wall clock.
  try { return new Date().toISOString(); } catch { return null; }
}

/** Keep only allow-listed, primitive-ish fields; drop everything else. */
function pickSafe(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (!SAFE_FIELDS.has(k)) continue;
    if (v == null) continue;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * Emit a single safe structured log line.
 * @param {string} event a stable event token (e.g. 'provider_operation_failed')
 * @param {object} fields safe fields only (allow-listed)
 * @param {'warn'|'error'|'info'} [level]
 */
export function logProviderEvent(event, fields = {}, level = 'warn') {
  const line = { event, at: iso(), ...pickSafe({ ...fields, event: undefined }) };
  // Never throw from a log call.
  try {
    const text = JSON.stringify(line);
    if (level === 'error') console.error(text);
    else console.warn(text);
  } catch {
    /* ignore */
  }
}

/**
 * Emit a `provider_operation_failed` line from a normalized ProviderError.
 * @param {{toSafeJSON:Function}} providerError
 * @param {object} [extra] safe extra fields (jobType, jobId, automationId, ...)
 */
export function logProviderFailure(providerError, extra = {}) {
  const safe = typeof providerError?.toSafeJSON === 'function' ? providerError.toSafeJSON() : {};
  logProviderEvent('provider_operation_failed', { ...safe, ...extra }, 'warn');
}

export default { logProviderEvent, logProviderFailure };
