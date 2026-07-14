/**
 * Session-based authentication middleware.
 *
 * Phase 1 supports session-based user checking only (login/registration flows
 * arrive in a later phase). `req.session.userId` is treated as the signed-in
 * user. These guards throw the appropriate AppError, handled centrally.
 */

import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import { USER_ROLES, SESSION_KEYS } from '../config/constants.js';

/** Read the current user id from the session, if any. */
export function getSessionUserId(req) {
  return req.session?.[SESSION_KEYS.USER_ID] ?? null;
}

/**
 * Populate `req.user` (minimal: { id, role }) from the session when present.
 * Non-blocking — does not reject anonymous requests.
 */
export function attachUser(req, res, next) {
  const userId = getSessionUserId(req);
  if (userId) {
    req.user = { id: userId, role: req.session?.role ?? USER_ROLES.USER };
  } else {
    req.user = null;
  }
  next();
}

/** Require an authenticated session; otherwise 401. */
export function requireAuth(req, res, next) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return next(new AuthenticationError('You must be signed in to do that'));
  }
  if (!req.user) {
    req.user = { id: userId, role: req.session?.role ?? USER_ROLES.USER };
  }
  next();
}

/** Require an authenticated admin session; otherwise 401/403. */
export function requireAdmin(req, res, next) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return next(new AuthenticationError('You must be signed in to do that'));
  }
  const role = req.session?.role ?? req.user?.role ?? USER_ROLES.USER;
  if (role !== USER_ROLES.ADMIN) {
    return next(new AuthorizationError('Administrator access required'));
  }
  if (!req.user) req.user = { id: userId, role };
  next();
}

export default { attachUser, requireAuth, requireAdmin, getSessionUserId };
