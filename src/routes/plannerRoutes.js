/**
 * Planner routes (factory).
 *
 *   GET    /api/planner/preferences              auth
 *   PUT    /api/planner/preferences              auth, CSRF
 *   GET    /api/planner/plans                    auth
 *   POST   /api/planner/plans                    auth, CSRF, strict generate limit
 *   GET    /api/planner/plans/:id                auth
 *   DELETE /api/planner/plans/:id                auth, CSRF
 *   POST   /api/planner/plans/:id/bulk-status    auth, CSRF
 *   POST   /api/planner/plans/:id/remove-rejected auth, CSRF
 *   POST   /api/planner/plans/:id/queue          auth, CSRF
 *   PATCH  /api/planner/items/:itemId            auth, CSRF
 *   POST   /api/planner/items/:itemId/regenerate auth, CSRF, generate limit
 *   POST   /api/planner/items/:itemId/status     auth, CSRF
 *   POST   /api/planner/items/:itemId/duplicate  auth, CSRF
 *   DELETE /api/planner/items/:itemId            auth, CSRF
 *
 * Every state-changing route requires CSRF. Nothing here publishes to any
 * provider: queueing stores posts for a future publishing phase.
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import {
  plannerGenerateLimiter,
  plannerWriteLimiter,
  imageGenerationLimiter,
} from '../middleware/rateLimits.js';
import {
  preferencesValidator,
  generatePlanValidator,
  runIdParamValidator,
  deletePlanValidator,
  itemIdParamValidator,
  updateItemValidator,
  regenerateItemValidator,
  itemStatusValidator,
  bulkStatusValidator,
  queueValidator,
  listPlansValidator,
  timezoneQueryValidator,
} from '../validators/plannerValidators.js';

export function createPlannerRoutes({ plannerController, requireAuth }) {
  const router = Router();

  // The full IANA catalogue. A plain read, so no CSRF.
  router.get('/timezones', requireAuth, validate(timezoneQueryValidator), plannerController.listTimezones);

  // --- preferences ---------------------------------------------------------
  router.get('/preferences', requireAuth, plannerController.getPreferences);
  router.put(
    '/preferences',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(preferencesValidator),
    plannerController.savePreferences,
  );

  // --- plans ---------------------------------------------------------------
  router.get('/plans', requireAuth, validate(listPlansValidator), plannerController.listPlans);
  /*
   * The summary is a read, but it takes the whole draft configuration, so it is
   * a POST. It generates nothing and costs nothing, so it uses the ordinary
   * write limiter rather than the strict generation one.
   */
  router.post(
    '/plans/summary',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(generatePlanValidator),
    plannerController.summarizePlan,
  );
  router.post(
    '/plans',
    requireAuth,
    plannerGenerateLimiter,
    csrfProtection,
    validate(generatePlanValidator),
    plannerController.generatePlan,
  );
  router.get('/plans/:id', requireAuth, validate(runIdParamValidator), plannerController.getPlan);
  router.get(
    '/plans/:id/deletion-impact',
    requireAuth,
    validate(runIdParamValidator),
    plannerController.describeDeletion,
  );
  router.delete(
    '/plans/:id',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(deletePlanValidator),
    plannerController.deletePlan,
  );

  // --- bulk actions --------------------------------------------------------
  router.post(
    '/plans/:id/bulk-status',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(bulkStatusValidator),
    plannerController.bulkSetStatus,
  );
  router.post(
    '/plans/:id/remove-rejected',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(runIdParamValidator),
    plannerController.removeRejected,
  );
  router.post(
    '/plans/:id/queue',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(queueValidator),
    plannerController.queueApproved,
  );

  // --- items ---------------------------------------------------------------
  router.patch(
    '/items/:itemId',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(updateItemValidator),
    plannerController.updateItem,
  );
  router.post(
    '/items/:itemId/regenerate',
    requireAuth,
    imageGenerationLimiter,
    csrfProtection,
    validate(regenerateItemValidator),
    plannerController.regenerateItem,
  );
  router.post(
    '/items/:itemId/status',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(itemStatusValidator),
    plannerController.setItemStatus,
  );
  router.post(
    '/items/:itemId/duplicate',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(itemIdParamValidator),
    plannerController.duplicateAsDraft,
  );
  router.delete(
    '/items/:itemId',
    requireAuth,
    plannerWriteLimiter,
    csrfProtection,
    validate(itemIdParamValidator),
    plannerController.deleteItem,
  );

  return router;
}

export default createPlannerRoutes;
