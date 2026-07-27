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

  /*
   * What to put back on screen when the studio opens: the brand this user last
   * corrected, and the week that is still building. Both outlive the tab they
   * were started in, so the page can restore itself after a refresh instead of
   * starting from an empty URL box. A plain read.
   */
  router.get('/session', requireAuth, aiStudioController.resume);
  // Keep the brand as edited. Changes state, so CSRF applies.
  router.post('/brand', requireAuth, csrfProtection, aiStudioController.saveBrand);

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

  /*
   * Plan a week and start building it. The plan is made in the request (one
   * model call, and the thing the user wants to see); the seven posters become
   * durable jobs, so closing the tab does not stop them.
   */
  router.post(
    '/week',
    requireAuth,
    imageGenerationLimiter,
    csrfProtection,
    aiStudioController.startWeek,
  );
  // Progress. A plain read, polled while the week builds, so no CSRF.
  router.get('/week/:runId', requireAuth, aiStudioController.getWeek);

  /*
   * Redo one piece of one day: `kind` is `poster` or `caption`. Each is a model
   * call and (for a poster) a render, so it carries the image-generation limiter
   * and runs as a durable job — the response says "queued", and the screen's
   * existing poll shows the result when it lands.
   */
  router.post(
    // A plain parameter, checked in the controller: a regex constraint in the
    // path works on Express 4 and throws on Express 5, and the check has to
    // exist in the controller anyway.
    '/week/:runId/day/:day/:kind',
    requireAuth,
    imageGenerationLimiter,
    csrfProtection,
    aiStudioController.regenerate,
  );

  /*
   * Step 4: the accounts to choose from. A plain read of the user's own
   * connections — no tokens, no provider ids.
   */
  router.get('/accounts', requireAuth, aiStudioController.accounts);

  /*
   * Step 5 and 6: activate. The chosen accounts, a timezone and a daily time
   * become a real schedule; the first post is timed to go straight away and the
   * rest follow one a day.
   *
   * This does NOT publish. Live publishing is off by design and the response
   * reports that honestly rather than implying a post has gone out.
   */
  router.post(
    '/week/:runId/activate',
    requireAuth,
    csrfProtection,
    aiStudioController.activate,
  );

  return router;
}

export default createAiStudioRoutes;
