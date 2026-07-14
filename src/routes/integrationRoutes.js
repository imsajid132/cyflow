/**
 * HCTI integration routes (factory).
 *
 *   GET    /api/integrations/hcti        auth
 *   PUT    /api/integrations/hcti        auth, rate-limited, CSRF
 *   POST   /api/integrations/hcti/test   auth, strict rate limit, CSRF
 *   DELETE /api/integrations/hcti        auth, CSRF (confirm: "DELETE")
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import { hctiSaveLimiter, hctiTestLimiter } from '../middleware/rateLimits.js';
import { saveHctiValidator, deleteHctiValidator } from '../validators/integrationValidators.js';

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

  return router;
}

export default createIntegrationRoutes;
