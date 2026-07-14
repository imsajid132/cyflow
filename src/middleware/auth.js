/**
 * Session-based authentication middleware (factory).
 *
 * `attachUser` is lightweight (session id only, no DB hit) and runs globally.
 * `requireAuth` verifies the user against the database on protected routes and
 * rejects sessions whose user is missing or disabled, destroying such sessions
 * where practical. A user id is NEVER accepted from the query string or body.
 */

import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
} from '../utils/errors.js';
import { USER_ROLES, USER_STATUS, SESSION_KEYS } from '../config/constants.js';
import { destroySession } from '../utils/session.js';
import * as defaultUserRepository from '../repositories/userRepository.js';

/** Read the current user id from the session (the ONLY source of identity). */
export function getSessionUserId(req) {
  return req.session?.[SESSION_KEYS.USER_ID] ?? null;
}

/**
 * @param {{ users?: { findUserById: Function } }} [deps]
 */
export function createAuthMiddleware({ users = defaultUserRepository } = {}) {
  /** Non-blocking: expose a minimal req.user from the session, no DB hit. */
  function attachUser(req, res, next) {
    const userId = getSessionUserId(req);
    req.user = userId ? { id: String(userId) } : null;
    next();
  }

  /** Require a valid, active, DB-backed session user; else 401. */
  async function requireAuth(req, res, next) {
    try {
      const userId = getSessionUserId(req);
      if (!userId) {
        return next(new AuthenticationError('You must be signed in to do that'));
      }
      const row = await users.findUserById(userId);
      if (!row || row.status === USER_STATUS.DISABLED) {
        // Invalid/stale session — destroy it where practical.
        try {
          await destroySession(req);
        } catch {
          /* ignore */
        }
        return next(new AuthenticationError('You must be signed in to do that'));
      }
      req.user = { id: String(row.id), role: row.role, status: row.status };
      return next();
    } catch (err) {
      return next(err);
    }
  }

  /** Require an authenticated admin. */
  function requireAdmin(req, res, next) {
    return requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (req.user?.role !== USER_ROLES.ADMIN) {
        return next(new AuthorizationError('Administrator access required'));
      }
      return next();
    });
  }

  /**
   * Guest-only: reject if already authenticated, so a logged-in user cannot
   * create a second session via register/login.
   */
  function guestOnly(req, res, next) {
    if (getSessionUserId(req)) {
      return next(new ConflictError('You are already signed in'));
    }
    return next();
  }

  return { attachUser, requireAuth, requireAdmin, guestOnly };
}

// Default singletons wired to the real repository (used by production app).
const defaults = createAuthMiddleware();
export const attachUser = defaults.attachUser;
export const requireAuth = defaults.requireAuth;
export const requireAdmin = defaults.requireAdmin;
export const guestOnly = defaults.guestOnly;

export default defaults;
