/**
 * Account routes (factory) — data export + account deletion (G).
 *
 *   GET  /api/account/export           auth            — status of the latest export
 *   POST /api/account/export           auth, CSRF, RL  — request a new export (durable job)
 *   GET  /api/account/export/download  auth            — download the ready archive (session-gated)
 *   GET  /api/account/delete           auth            — status of an in-progress deletion
 *   POST /api/account/delete           auth, CSRF, RL  — request deletion (password + typed confirm)
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import { accountActionLimiter } from '../middleware/rateLimits.js';
import { accountDeletionValidator } from '../validators/accountValidators.js';

export function createAccountRoutes({ accountController, requireAuth }) {
  const router = Router();

  router.get('/export', requireAuth, accountController.getExport);
  router.post('/export', requireAuth, accountActionLimiter, csrfProtection, accountController.requestExport);
  router.get('/export/download', requireAuth, accountController.downloadExport);

  router.get('/delete', requireAuth, accountController.getDeletion);
  router.post('/delete', requireAuth, accountActionLimiter, csrfProtection, validate(accountDeletionValidator), accountController.requestDeletion);

  return router;
}

export default createAccountRoutes;
