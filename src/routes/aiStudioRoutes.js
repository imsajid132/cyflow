/**
 * AI Studio routes (factory).
 *
 *   GET  /api/ai-studio/status     auth         is the AI configured?
 *   POST /api/ai-studio/analyze    auth, CSRF   read a website, suggest the brand
 *   POST /api/ai-studio/generate   auth, CSRF   design a poster + write post copy
 *
 * The generate route is expensive (two Claude calls + a render), so it uses the
 * image-generation rate limiter. Nothing here publishes.
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { imageGenerationLimiter, websiteAnalysisLimiter } from '../middleware/rateLimits.js';

export function createAiStudioRoutes({ aiStudioController, requireAuth }) {
  const router = Router();

  router.get('/status', requireAuth, aiStudioController.status);
  // Read a website and suggest a brand. Fetches an external site, so it carries
  // the same strict limiter the onboarding analyzer uses.
  router.post(
    '/analyze',
    requireAuth,
    websiteAnalysisLimiter,
    csrfProtection,
    aiStudioController.analyze,
  );
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
