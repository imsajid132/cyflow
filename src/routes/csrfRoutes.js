/**
 * CSRF token route.
 *
 * GET /api/csrf-token — ensures a session CSRF token exists and returns it in
 * the standard success envelope. Clients send this token back in the
 * `X-CSRF-Token` header on state-changing requests.
 */

import { Router } from 'express';
import { ensureCsrfToken } from '../middleware/csrf.js';
import { sendSuccess } from '../utils/apiResponse.js';

const router = Router();

router.get('/csrf-token', (req, res) => {
  const csrfToken = ensureCsrfToken(req);
  // Do not cache tokens at any intermediary.
  res.setHeader('Cache-Control', 'no-store');
  sendSuccess(res, { csrfToken });
});

export default router;
