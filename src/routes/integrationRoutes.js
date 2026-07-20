/**
 * Integration routes (factory) — HCTI and OpenAI.
 *
 *   GET    /api/integrations/hcti          auth
 *   PUT    /api/integrations/hcti          auth, rate-limited, CSRF
 *   POST   /api/integrations/hcti/test     auth, strict rate limit, CSRF
 *   DELETE /api/integrations/hcti          auth, CSRF (confirm: "DELETE")
 *
 *   GET    /api/integrations/openai        auth
 *   PUT    /api/integrations/openai        auth, rate-limited, CSRF
 *   POST   /api/integrations/openai/test   auth, strict rate limit, CSRF
 *   DELETE /api/integrations/openai        auth, CSRF (confirm: "DELETE")
 *
 * Social OAuth accounts are NOT here — they live under /api/social-accounts and
 * are presented on Connections. These two are credentials the customer types in;
 * those are accounts the customer authorises. Mixing them would put "paste your
 * API key" next to "sign in with Facebook".
 *
 * The OpenAI routes reuse the HCTI limiters deliberately: both protect the same
 * thing (a credential-write and an outbound provider verification), and a second
 * pair of limiter names for identical behaviour would be one more thing to keep
 * in step.
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import { hctiSaveLimiter, hctiTestLimiter } from '../middleware/rateLimits.js';
import {
  saveHctiValidator,
  deleteHctiValidator,
  saveOpenAiValidator,
  deleteOpenAiValidator,
} from '../validators/integrationValidators.js';

export function createIntegrationRoutes({ integrationController, requireAuth }) {
  const router = Router();

  router.get('/hcti', requireAuth, integrationController.getHctiStatus);

  router.put(
    '/hcti',
    requireAuth,
    hctiSaveLimiter,
    csrfProtection,
    validate(saveHctiValidator),
    integrationController.saveHctiCredentials,
  );

  router.post(
    '/hcti/test',
    requireAuth,
    hctiTestLimiter,
    csrfProtection,
    integrationController.testHctiCredentials,
  );

  router.delete(
    '/hcti',
    requireAuth,
    csrfProtection,
    validate(deleteHctiValidator),
    integrationController.deleteHctiCredentials,
  );

  // A connection label is a name, not a credential — CSRF-protected, no limiter.
  router.put('/hcti/label', requireAuth, csrfProtection, integrationController.setHctiLabel);

  // --- OpenAI ---------------------------------------------------------------

  router.get('/openai', requireAuth, integrationController.getOpenAiStatus);

  router.put(
    '/openai',
    requireAuth,
    hctiSaveLimiter,
    csrfProtection,
    validate(saveOpenAiValidator),
    integrationController.saveOpenAiCredentials,
  );

  router.post(
    '/openai/test',
    requireAuth,
    hctiTestLimiter,
    csrfProtection,
    integrationController.testOpenAiCredentials,
  );

  router.delete(
    '/openai',
    requireAuth,
    csrfProtection,
    validate(deleteOpenAiValidator),
    integrationController.deleteOpenAiCredentials,
  );

  router.put('/openai/label', requireAuth, csrfProtection, integrationController.setOpenAiLabel);

  return router;
}

export default createIntegrationRoutes;
