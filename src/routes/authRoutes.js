/**
 * Authentication routes (factory).
 *
 *   POST   /api/auth/register        guest, rate-limited, CSRF
 *   POST   /api/auth/login           guest, strict rate limit, CSRF
 *   POST   /api/auth/logout          auth, CSRF
 *   GET    /api/auth/me              auth
 *   PATCH  /api/auth/profile         auth, CSRF
 *   POST   /api/auth/change-password auth, stricter rate limit, CSRF
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import { registerLimiter, loginLimiter, passwordChangeLimiter } from '../middleware/rateLimits.js';
import {
  registerValidator,
  loginValidator,
  profileValidator,
  passwordChangeValidator,
} from '../validators/authValidators.js';

export function createAuthRoutes({ authController, requireAuth, guestOnly }) {
  const router = Router();

  router.post(
    '/register',
    guestOnly,
    registerLimiter,
    csrfProtection,
    validate(registerValidator),
    authController.register,
  );

  router.post(
    '/login',
    guestOnly,
    loginLimiter,
    csrfProtection,
    validate(loginValidator),
    authController.login,
  );

  router.post('/logout', requireAuth, csrfProtection, authController.logout);

  router.get('/me', requireAuth, authController.getCurrentUser);

  router.patch(
    '/profile',
    requireAuth,
    csrfProtection,
    validate(profileValidator),
    authController.updateProfile,
  );

  router.post(
    '/change-password',
    requireAuth,
    passwordChangeLimiter,
    csrfProtection,
    validate(passwordChangeValidator),
    authController.changePassword,
  );

  return router;
}

export default createAuthRoutes;
