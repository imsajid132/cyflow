/**
 * Business profile controller (factory).
 *
 * Ownership is always the session user. Responses never contain raw page HTML,
 * internal fetch details, private-network diagnostics, or secrets. There is no
 * arbitrary asset-fetch endpoint — website analysis is the only outbound action
 * and it is explicitly user-triggered.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { businessProfileService as defaultService } from '../services/businessProfileService.js';

export function createBusinessProfileController({ businessProfileService = defaultService } = {}) {
  const getProfile = asyncHandler(async (req, res) => {
    const profile = await businessProfileService.getBusinessProfile(req.user.id);
    return sendSuccess(res, { profile });
  });

  const getOnboardingState = asyncHandler(async (req, res) => {
    const state = await businessProfileService.getOnboardingState(req.user.id);
    return sendSuccess(res, state);
  });

  const updateProfile = asyncHandler(async (req, res) => {
    const profile = await businessProfileService.updateBusinessProfile(req.user.id, req.body, { req });
    return sendSuccess(res, { profile });
  });

  const analyzeWebsite = asyncHandler(async (req, res) => {
    const result = await businessProfileService.analyzeBusinessWebsite(
      req.user.id,
      req.body.websiteUrl,
      { req },
    );
    // Suggestions only — nothing is saved until the user reviews them.
    return sendSuccess(res, result);
  });

  const saveExtracted = asyncHandler(async (req, res) => {
    const { profile, preservedFields } = await businessProfileService.saveExtractedBusinessProfile(
      req.user.id,
      req.body,
      { req },
    );
    return sendSuccess(res, { profile, preservedFields });
  });

  const completeOnboarding = asyncHandler(async (req, res) => {
    const profile = await businessProfileService.completeOnboarding(req.user.id, { req });
    return sendSuccess(res, { profile });
  });

  const deleteProfile = asyncHandler(async (req, res) => {
    const result = await businessProfileService.deleteBusinessProfile(req.user.id, { req });
    return sendSuccess(res, result);
  });

  return {
    getProfile,
    getOnboardingState,
    updateProfile,
    analyzeWebsite,
    saveExtracted,
    completeOnboarding,
    deleteProfile,
  };
}

export default createBusinessProfileController;
