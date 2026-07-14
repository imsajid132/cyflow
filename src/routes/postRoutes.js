/**
 * Post routes (factory).
 *
 *   GET    /api/posts/capabilities        auth
 *   GET    /api/posts                      auth
 *   POST   /api/posts                      auth, CSRF, moderate
 *   GET    /api/posts/:id                  auth
 *   PATCH  /api/posts/:id                  auth, CSRF, moderate
 *   POST   /api/posts/:id/generate-content auth, CSRF, strict
 *   POST   /api/posts/:id/generate-image   auth, CSRF, strict
 *   PUT    /api/posts/:id/targets          auth, CSRF, moderate
 *   POST   /api/posts/:id/schedule         auth, CSRF, moderate
 *   POST   /api/posts/:id/cancel           auth, CSRF, moderate
 *   DELETE /api/posts/:id                  auth, CSRF, moderate
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import {
  postWriteLimiter,
  contentGenerationLimiter,
  imageGenerationLimiter,
  scheduleLimiter,
} from '../middleware/rateLimits.js';
import {
  createPostValidator,
  updatePostValidator,
  idParamValidator,
  listPostsValidator,
  setTargetsValidator,
  scheduleValidator,
} from '../validators/postValidators.js';

export function createPostRoutes({ postController, requireAuth }) {
  const router = Router();

  // `/capabilities` must precede `/:id`.
  router.get('/capabilities', requireAuth, postController.getCapabilities);

  router.get('/', requireAuth, validate(listPostsValidator), postController.listPosts);
  router.post('/', requireAuth, postWriteLimiter, csrfProtection, validate(createPostValidator), postController.createDraft);

  router.get('/:id', requireAuth, validate(idParamValidator), postController.getPost);
  router.patch(
    '/:id',
    requireAuth,
    postWriteLimiter,
    csrfProtection,
    validate([...idParamValidator, ...updatePostValidator]),
    postController.updateDraft,
  );

  router.post(
    '/:id/generate-content',
    requireAuth,
    contentGenerationLimiter,
    csrfProtection,
    validate(idParamValidator),
    postController.generateContent,
  );
  router.post(
    '/:id/generate-image',
    requireAuth,
    imageGenerationLimiter,
    csrfProtection,
    validate(idParamValidator),
    postController.generateImage,
  );

  router.put(
    '/:id/targets',
    requireAuth,
    postWriteLimiter,
    csrfProtection,
    validate([...idParamValidator, ...setTargetsValidator]),
    postController.setTargets,
  );

  router.post(
    '/:id/schedule',
    requireAuth,
    scheduleLimiter,
    csrfProtection,
    validate([...idParamValidator, ...scheduleValidator]),
    postController.schedule,
  );
  router.post('/:id/cancel', requireAuth, scheduleLimiter, csrfProtection, validate(idParamValidator), postController.cancel);
  router.delete('/:id', requireAuth, scheduleLimiter, csrfProtection, validate(idParamValidator), postController.deleteDraft);

  return router;
}

export default createPostRoutes;
