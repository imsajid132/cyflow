/**
 * Business profile routes (factory).
 *
 *   GET    /api/business-profile                    auth
 *   GET    /api/business-profile/onboarding-state   auth
 *   PUT    /api/business-profile                    auth, CSRF, moderate
 *   POST   /api/business-profile/analyze-website    auth, CSRF, strict limit
 *   POST   /api/business-profile/apply-extracted    auth, CSRF, moderate
 *   POST   /api/business-profile/complete-onboarding auth, CSRF, moderate
 *   DELETE /api/business-profile                    auth, CSRF, moderate
 */

import { Router } from 'express';

import { csrfProtection } from '../middleware/csrf.js';
import { validate } from '../middleware/validateRequest.js';
import { websiteAnalysisLimiter, businessProfileLimiter } from '../middleware/rateLimits.js';
import {
  analyzeWebsiteValidator,
  updateProfileValidator,
} from '../validators/businessProfileValidators.js';

export function createBusinessProfileRoutes({ businessProfileController, requireAuth }) {
  const router = Router();

  // `/onboarding-state` must precede nothing dynamic here, but keep it first.
  router.get('/onboarding-state', requireAuth, businessProfileController.getOnboardingState);
  router.get('/', requireAuth, businessProfileController.getProfile);

  router.put(
    '/',
    requireAuth,
    businessProfileLimiter,
    csrfProtection,
    validate(updateProfileValidator),
    businessProfileController.updateProfile,
  );

  router.post(
    '/analyze-website',
    requireAuth,
    websiteAnalysisLimiter,
    csrfProtection,
    validate(analyzeWebsiteValidator),
    businessProfileController.analyzeWebsite,
  );

  router.post(
    '/apply-extracted',
    requireAuth,
    businessProfileLimiter,
    csrfProtection,
    validate(updateProfileValidator),
    businessProfileController.saveExtracted,
  );

  router.post(
    '/complete-onboarding',
    requireAuth,
    businessProfileLimiter,
    csrfProtection,
    businessProfileController.completeOnboarding,
  );

  router.delete(
    '/',
    requireAuth,
    businessProfileLimiter,
    csrfProtection,
    businessProfileController.deleteProfile,
  );

  return router;
}

export default createBusinessProfileRoutes;
