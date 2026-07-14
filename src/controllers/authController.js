/**
 * Authentication controller (factory).
 *
 * Handlers use asyncHandler + the standard API envelope. Session identity is
 * limited to `req.session.userId` (no full user record is stored). Sessions are
 * regenerated on register/login/password-change to prevent fixation, and the
 * CSRF token is rotated to match the new session.
 */

import { config } from '../config/env.js';
import { SESSION_KEYS, EVENT_TYPES } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { regenerateSession, saveSession, destroySession } from '../utils/session.js';
import { rotateCsrfToken } from '../middleware/csrf.js';
import { AuthenticationError } from '../utils/errors.js';

import { authService as defaultAuthService } from '../services/authService.js';
import * as defaultUserRepository from '../repositories/userRepository.js';
import { loggingService as defaultLoggingService } from '../services/loggingService.js';

/** Project a sanitized user to the exact /me response shape. */
function toMeShape(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    timezone: user.timezone,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function createAuthController({
  authService = defaultAuthService,
  users = defaultUserRepository,
  logging = defaultLoggingService,
} = {}) {
  /** Establish a fresh authenticated session for the given user id. */
  async function establishSession(req, userId) {
    await regenerateSession(req);
    req.session[SESSION_KEYS.USER_ID] = String(userId);
    // New session ⇒ new CSRF token.
    rotateCsrfToken(req);
    await saveSession(req);
  }

  const register = asyncHandler(async (req, res) => {
    const { name, email, password, timezone } = req.body;
    const user = await authService.registerUser({ name, email, password, timezone }, { req });
    await establishSession(req, user.id);
    return sendSuccess(res, { user: toMeShape(user) }, 201);
  });

  const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await authService.authenticateUser({ email, password }, { req });
    await establishSession(req, user.id);
    return sendSuccess(res, { user: toMeShape(user) });
  });

  const logout = asyncHandler(async (req, res) => {
    const userId = req.user?.id ?? null;
    await destroySession(req);
    // Clear the cookie using the exact configured attributes.
    res.clearCookie(config.session.cookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
    });
    await logging.record(EVENT_TYPES.USER_LOGGED_OUT, {
      userId,
      message: 'User logged out',
    });
    return sendSuccess(res, { loggedOut: true });
  });

  const getCurrentUser = asyncHandler(async (req, res) => {
    // Always load fresh from the DB — never trust stale session profile data.
    const user = await users.getSanitizedUserById(req.user.id);
    if (!user) {
      // Session references a user that no longer exists.
      try {
        await destroySession(req);
      } catch {
        /* ignore */
      }
      throw new AuthenticationError('You must be signed in to do that');
    }
    return sendSuccess(res, { user: toMeShape(user) });
  });

  const updateProfile = asyncHandler(async (req, res) => {
    // Only name + timezone are read; any other field in the body is ignored.
    const { name, timezone } = req.body;
    const user = await authService.updateUserProfile(req.user.id, { name, timezone }, { req });
    return sendSuccess(res, { user: toMeShape(user) });
  });

  const changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(
      req.user.id,
      { currentPassword, newPassword },
      { req },
    );
    // Rotate the session after a password change, preserving identity.
    const userId = req.user.id;
    await regenerateSession(req);
    req.session[SESSION_KEYS.USER_ID] = String(userId);
    rotateCsrfToken(req);
    await saveSession(req);
    return sendSuccess(res, { passwordChanged: true });
  });

  return { register, login, logout, getCurrentUser, updateProfile, changePassword };
}

export default createAuthController;
