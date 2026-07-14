/**
 * OAuth routes (factory).
 *
 *   GET  /api/oauth/providers            auth
 *   POST /api/oauth/:provider/start      auth, CSRF, rate-limited
 *   GET  /api/oauth/meta/callback        auth (state provides callback protection)
 *   GET  /api/oauth/instagram/callback   auth
 *   GET  /api/oauth/threads/callback     auth
 *
 * Callbacks use OAuth state (not a CSRF header) for protection and redirect to
 * the dashboard with only safe query values.
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { oauthStartLimiter } from '../middleware/rateLimits.js';

export function createOAuthRoutes({ oauthController, requireAuth }) {
  const router = Router();

  router.get('/providers', requireAuth, oauthController.getProviders);

  router.post('/:provider/start', requireAuth, oauthStartLimiter, csrfProtection, oauthController.startOAuth);

  // Fixed callback paths (no CSRF header; state protects the callback).
  router.get('/meta/callback', requireAuth, oauthController.metaCallback);
  router.get('/instagram/callback', requireAuth, oauthController.instagramCallback);
  router.get('/threads/callback', requireAuth, oauthController.threadsCallback);

  return router;
}

export default createOAuthRoutes;
