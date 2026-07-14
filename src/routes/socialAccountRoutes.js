/**
 * Social account routes (factory).
 *
 *   GET    /api/social-accounts             auth
 *   POST   /api/social-accounts/:id/verify  auth, CSRF, rate-limited
 *   DELETE /api/social-accounts/:id         auth, CSRF, rate-limited (confirm: "DISCONNECT")
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import { accountVerifyLimiter, accountDisconnectLimiter } from '../middleware/rateLimits.js';
import { disconnectValidator } from '../validators/socialAccountValidators.js';

export function createSocialAccountRoutes({ socialAccountController, requireAuth }) {
  const router = Router();

  router.get('/', requireAuth, socialAccountController.listAccounts);

  router.post(
    '/:id/verify',
    requireAuth,
    accountVerifyLimiter,
    csrfProtection,
    socialAccountController.verifyAccount,
  );

  router.delete(
    '/:id',
    requireAuth,
    accountDisconnectLimiter,
    csrfProtection,
    validate(disconnectValidator),
    socialAccountController.disconnectAccount,
  );

  return router;
}

export default createSocialAccountRoutes;
