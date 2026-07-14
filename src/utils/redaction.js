/**
 * Recursive redaction for logs and error contexts.
 *
 * Any object key whose normalized name matches a sensitive pattern has its
 * value replaced with `[REDACTED]`, at any depth (objects and arrays). Used
 * before writing structured logs or persisting error context.
 */

const REDACTED = '[REDACTED]';

/**
 * Sensitive key fragments (compared case-insensitively, ignoring separators
 * like `_` and `-`). A key matches if it CONTAINS any fragment.
 */
const SENSITIVE_FRAGMENTS = [
  'password',
  'passwd',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'token', // catches access_token, refresh_token, csrftoken, bearer tokens, etc.
  'authorization',
  'cookie',
  'session',
  'secret', // clientSecret, appSecret, session secret, etc.
  'clientsecret',
  'appsecret',
  'hctiuserid',
  'hctiapikey',
  'hcti',
  'code_verifier',
  'codeverifier',
  'oauthcode',
  'encryptionkey',
  'privatekey',
];

/** Normalize a key for matching: lowercase, strip `_`, `-`, and spaces. */
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[_\-\s]/g, '');
}

function isSensitiveKey(key) {
  const norm = normalizeKey(key);
  return SENSITIVE_FRAGMENTS.some((frag) => norm.includes(frag));
}

/**
 * Return a deep copy of `input` with sensitive values redacted.
 * Primitives are returned unchanged. Handles cycles safely.
 *
 * @param {unknown} input
 * @param {number} [maxDepth=8]
 * @returns {unknown}
 */
export function redact(input, maxDepth = 8) {
  return redactInner(input, maxDepth, new WeakSet());
}

function redactInner(value, depth, seen) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth <= 0) {
    return Array.isArray(value) ? '[Array]' : '[Object]';
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, depth - 1, seen));
  }

  // Special-case Error objects so we keep useful, safe fields.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
    };
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = redactInner(val, depth - 1, seen);
    }
  }
  return out;
}

/**
 * Sensitive URL query parameters that must never be logged (OAuth callbacks
 * carry these in req.originalUrl, not in the body).
 */
const URL_SENSITIVE_PARAMS = [
  'code',
  'state',
  'access_token',
  'refresh_token',
  'client_secret',
  'error_description',
];

/**
 * Return a log-safe version of a URL: the pathname is preserved and any
 * sensitive query parameter value is replaced with `REDACTED`. The full raw URL
 * is never returned.
 * @param {string} originalUrl e.g. "/api/oauth/meta/callback?code=abc&state=xyz"
 * @returns {string}
 */
export function redactUrl(originalUrl) {
  if (typeof originalUrl !== 'string' || originalUrl.length === 0) return '';
  const qIndex = originalUrl.indexOf('?');
  if (qIndex === -1) return originalUrl;

  const path = originalUrl.slice(0, qIndex);
  const query = originalUrl.slice(qIndex + 1);
  let params;
  try {
    params = new URLSearchParams(query);
  } catch {
    return path;
  }
  const out = new URLSearchParams();
  for (const [key, value] of params) {
    out.append(key, URL_SENSITIVE_PARAMS.includes(key.toLowerCase()) ? 'REDACTED' : value);
  }
  const redacted = out.toString();
  return redacted ? `${path}?${redacted}` : path;
}

export { REDACTED, isSensitiveKey };
export default { redact, isSensitiveKey, redactUrl, REDACTED };
