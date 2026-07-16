/**
 * Build a plannerService wired to the same fakes the review server uses.
 *
 * The seed needs to generate a plan through the REAL service so the browser
 * retry exercises real data — a hand-inserted row would not have a fingerprint,
 * per-platform copy or a rhythm snapshot, and the retry would then be tested
 * against a fixture that could not occur in production.
 */

import { createPlannerService } from '../src/services/plannerService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';

export function buildPlannerService(overrides) {
  return createPlannerService({
    preferences: overrides.plannerPreferenceRepository,
    runs: overrides.plannerRunRepository,
    businessProfiles: overrides.businessProfileRepository,
    socialAccounts: overrides.socialAccountRepository,
    posts: overrides.postRepository,
    mediaRepository: overrides.mediaAssetRepository,
    apiUsage: overrides.apiUsageRepository,
    openaiContentService: overrides.openaiContentService,
    socialImageService: overrides.socialImageService,
    mediaAssetService: overrides.mediaAssetService
      ?? createMediaAssetService({ mediaRepository: overrides.mediaAssetRepository }),
    uniqueness: contentUniquenessService,
    logging: { record: async () => {} },
    withTransaction: overrides.withTransaction,
  });
}

export default { buildPlannerService };
