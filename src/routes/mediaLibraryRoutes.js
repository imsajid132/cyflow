/**
 * Authenticated media library routes (factory).
 *
 *   POST   /api/media               upload one image      auth, CSRF, rate limit
 *   GET    /api/media               list own media        auth
 *   GET    /api/media/:id           safe metadata         auth
 *   PATCH  /api/media/:id           update alt text       auth, CSRF
 *   DELETE /api/media/:id           delete (if unused)    auth, CSRF
 *   POST   /api/media/:id/attach    attach to an entity   auth, CSRF
 *   POST   /api/media/:id/detach    detach from an entity auth, CSRF
 *
 * Public token content is served by the separate /media/:token route, which
 * already existed for HCTI and now also serves local uploads.
 */

import { Router } from 'express';
import { csrfProtection } from '../middleware/csrf.js';
import { mediaUploadLimiter } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validateRequest.js';
import {
  mediaIdParamValidator, mediaAltValidator, mediaReferenceValidator,
} from '../validators/mediaValidators.js';

export function createMediaLibraryRoutes({ mediaLibraryController, requireAuth, parseSingleImage }) {
  const router = Router();

  router.post(
    '/',
    requireAuth,
    mediaUploadLimiter,
    csrfProtection,
    parseSingleImage, // multer: parse the multipart body into req.file
    mediaLibraryController.upload,
  );
  router.get('/', requireAuth, mediaLibraryController.list);
  router.get('/:id', requireAuth, validate(mediaIdParamValidator), mediaLibraryController.get);
  router.patch(
    '/:id',
    requireAuth,
    csrfProtection,
    validate(mediaAltValidator),
    mediaLibraryController.updateAlt,
  );
  router.delete(
    '/:id',
    requireAuth,
    csrfProtection,
    validate(mediaIdParamValidator),
    mediaLibraryController.remove,
  );
  router.post(
    '/:id/attach',
    requireAuth,
    csrfProtection,
    validate(mediaReferenceValidator),
    mediaLibraryController.attach,
  );
  router.post(
    '/:id/detach',
    requireAuth,
    csrfProtection,
    validate(mediaReferenceValidator),
    mediaLibraryController.detach,
  );

  return router;
}

export default createMediaLibraryRoutes;
