/**
 * Public media routes (factory).
 *
 *   GET /media/:publicToken   public, IP rate-limited
 *
 * Serves ready assets by opaque token via a safe, SSRF-hardened proxy.
 */

import { Router } from 'express';
import { mediaProxyLimiter } from '../middleware/rateLimits.js';

export function createMediaRoutes({ mediaController }) {
  const router = Router();
  router.get('/:publicToken', mediaProxyLimiter, mediaController.serveMedia);
  return router;
}

export default createMediaRoutes;
