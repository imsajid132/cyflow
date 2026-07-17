/**
 * Publishing routes (factory) — per-target D2 actions.
 *
 *   POST /api/publish/targets/:targetId/retry    auth, CSRF
 *   POST /api/publish/targets/:targetId/cancel   auth, CSRF
 *   GET  /api/publish/targets/:targetId/attempts auth
 *
 * These act on scheduled_post_targets the user owns. No route publishes directly;
 * they schedule/cancel durable publish jobs (gated by the live-publishing flag).
 */

import { Router } from 'express';
import { param } from 'express-validator';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import { plannerWriteLimiter } from '../middleware/rateLimits.js';

const targetIdValidator = [param('targetId').matches(/^\d{1,20}$/).withMessage('Invalid target id')];

export function createPublishRoutes({ publishController, requireAuth }) {
  const router = Router();
  router.post('/targets/:targetId/retry', requireAuth, plannerWriteLimiter, csrfProtection, validate(targetIdValidator), publishController.retry);
  router.post('/targets/:targetId/cancel', requireAuth, plannerWriteLimiter, csrfProtection, validate(targetIdValidator), publishController.cancel);
  router.get('/targets/:targetId/attempts', requireAuth, validate(targetIdValidator), publishController.attempts);
  return router;
}

export default createPublishRoutes;
