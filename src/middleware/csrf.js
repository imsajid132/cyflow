/**
 * CSRF protection using session-stored synchronizer tokens.
 *
 * A random token is generated per session and stored server-side in the session
 * (`req.session.csrfToken`). Clients read it from `GET /api/csrf-token` and echo
 * it on state-changing requests via the `X-CSRF-Token` header (or `_csrf` body
 * field). Validation uses a timing-safe comparison.
 *
 * Safe, idempotent methods (GET/HEAD/OPTIONS) are not checked. This is a
 * self-contained implementation — it does NOT depend on the abandoned `csurf`
 * package.
 */

import { generateSecureToken, timingSafeEqual } from '../services/encryptionService.js';
import { SESSION_KEYS, ERROR_CODES } from '../config/constants.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_BYTES = 32;

/** Ensure a CSRF token exists on the session; return it. */
export function ensureCsrfToken(req) {
  if (!req.session) {
    // Session middleware must run before this; guard just in case.
    throw new Error('Session is not initialized');
  }
  let token = req.session[SESSION_KEYS.CSRF_TOKEN];
  if (!token || typeof token !== 'string') {
    token = generateSecureToken(TOKEN_BYTES);
    req.session[SESSION_KEYS.CSRF_TOKEN] = token;
  }
  return token;
}

/** Force-generate a fresh CSRF token (e.g. after privilege change). */
export function rotateCsrfToken(req) {
  const token = generateSecureToken(TOKEN_BYTES);
  req.session[SESSION_KEYS.CSRF_TOKEN] = token;
  return token;
}

/** Extract the client-supplied token from header or body. */
function extractToken(req) {
  const header =
    req.get('x-csrf-token') || req.get('x-xsrf-token') || req.get('csrf-token');
  if (header) return header;
  if (req.body && typeof req.body === 'object' && typeof req.body._csrf === 'string') {
    return req.body._csrf;
  }
  return null;
}

/**
 * CSRF-protection middleware for state-changing requests.
 * Rejects with a 403 CSRF error envelope on mismatch/missing token.
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const sessionToken = req.session?.[SESSION_KEYS.CSRF_TOKEN];
  const clientToken = extractToken(req);

  if (!sessionToken || !clientToken || !timingSafeEqual(sessionToken, clientToken)) {
    return res.status(403).json({
      success: false,
      error: {
        code: ERROR_CODES.CSRF_ERROR,
        message: 'Invalid or missing CSRF token',
      },
      requestId: req.id ?? null,
    });
  }

  return next();
}

export default { csrfProtection, ensureCsrfToken, rotateCsrfToken };
