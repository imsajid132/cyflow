/**
 * Automation routes (factory).
 *
 *   POST   /api/automations                 auth, CSRF, write limit
 *   GET    /api/automations                 auth
 *   GET    /api/automations/:id             auth
 *   PATCH  /api/automations/:id             auth, CSRF
 *   POST   /api/automations/:id/activate    auth, CSRF
 *   POST   /api/automations/:id/pause       auth, CSRF
 *   POST   /api/automations/:id/resume      auth, CSRF
 *   POST   /api/automations/:id/stop        auth, CSRF (confirm: "STOP")
 *   POST   /api/automations/:id/refill      auth, CSRF
 *   GET    /api/automations/:id/upcoming    auth
 *   GET    /api/automations/:id/history     auth
 *   GET    /api/automations/:id/failures    auth
 *
 * Every state-changing route requires CSRF. Nothing here publishes to a provider;
 * an automation prepares and queues content for a future publishing phase.
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import { plannerWriteLimiter } from '../middleware/rateLimits.js';
import {
  idParamValidator, createAutomationValidator, updateAutomationValidator, stopAutomationValidator,
} from '../validators/automationValidators.js';

export function createAutomationRoutes({ automationController, requireAuth }) {
  const router = Router();

  router.post('/', requireAuth, plannerWriteLimiter, csrfProtection, validate(createAutomationValidator), automationController.create);
  router.get('/', requireAuth, automationController.list);
  router.get('/:id', requireAuth, validate(idParamValidator), automationController.get);
  router.patch('/:id', requireAuth, plannerWriteLimiter, csrfProtection, validate(updateAutomationValidator), automationController.update);

  router.post('/:id/activate', requireAuth, plannerWriteLimiter, csrfProtection, validate(idParamValidator), automationController.activate);
  router.post('/:id/pause', requireAuth, plannerWriteLimiter, csrfProtection, validate(idParamValidator), automationController.pause);
  router.post('/:id/resume', requireAuth, plannerWriteLimiter, csrfProtection, validate(idParamValidator), automationController.resume);
  router.post('/:id/stop', requireAuth, plannerWriteLimiter, csrfProtection, validate(stopAutomationValidator), automationController.stop);
  router.post('/:id/refill', requireAuth, plannerWriteLimiter, csrfProtection, validate(idParamValidator), automationController.refillNow);

  router.get('/:id/upcoming', requireAuth, validate(idParamValidator), automationController.upcoming);
  router.get('/:id/history', requireAuth, validate(idParamValidator), automationController.history);
  router.get('/:id/failures', requireAuth, validate(idParamValidator), automationController.failures);

  return router;
}

export default createAutomationRoutes;
