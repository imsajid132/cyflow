/**
 * AI Studio routes (factory).
 *
 *   GET  /api/ai-studio/status     auth        is the AI configured?
 *   POST /api/ai-studio/generate   auth, CSRF   design a poster + write captions
 *
 * The generate route is expensive (two Claude calls + a render), so it uses the
 * image-generation rate limiter. Nothing here publishes.
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { imageGenerationLimiter } from '../middleware/rateLimits.js';

export function createAiStudioRoutes({ aiStudioController, requireAuth }) {
  const router = Router();

  router.get('/status', requireAuth, aiStudioController.status);
  router.post(
    '/generate',
    requireAuth,
    imageGenerationLimiter,
    csrfProtection,
    aiStudioController.generate,
  );

  return router;
}

export default createAiStudioRoutes;
