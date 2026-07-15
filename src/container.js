/**
 * Dependency-injection container.
 *
 * Wires repositories → services → controllers → middleware. Tests pass
 * `overrides` (fake repositories, a fake HCTI service, a fake transaction
 * runner) to exercise real business logic without a database or network.
 * Production wiring uses the real modules.
 */

import * as userRepository from './repositories/userRepository.js';
import * as integrationRepository from './repositories/integrationRepository.js';
import * as logRepository from './repositories/logRepository.js';
import * as oauthStateRepositoryModule from './repositories/oauthStateRepository.js';
import * as socialAccountRepositoryModule from './repositories/socialAccountRepository.js';
import * as dataDeletionRepositoryModule from './repositories/dataDeletionRepository.js';
import * as postRepositoryModule from './repositories/postRepository.js';
import * as mediaAssetRepositoryModule from './repositories/mediaAssetRepository.js';
import * as apiUsageRepositoryModule from './repositories/apiUsageRepository.js';
import * as businessProfileRepositoryModule from './repositories/businessProfileRepository.js';
import { createBusinessProfileService } from './services/businessProfileService.js';
import { websiteAnalysisService as realWebsiteAnalysisService } from './services/websiteAnalysisService.js';
import { createBusinessProfileController } from './controllers/businessProfileController.js';
import { createLoggingService } from './services/loggingService.js';
import { createAuthService } from './services/authService.js';
import { hctiService as realHctiService } from './services/hctiService.js';
import { createOAuthService } from './services/oauthService.js';
import { createThreadsCallbackService } from './services/threadsCallbackService.js';
import { createPostService } from './services/postService.js';
import { mediaAssetService as realMediaAssetService } from './services/mediaAssetService.js';
import { providerRegistry as realProviderRegistry } from './providers/providerRegistry.js';
import { createAuthController } from './controllers/authController.js';
import { createIntegrationController } from './controllers/integrationController.js';
import { createOAuthController } from './controllers/oauthController.js';
import { createSocialAccountController } from './controllers/socialAccountController.js';
import { createThreadsCallbackController } from './controllers/threadsCallbackController.js';
import { createPostController } from './controllers/postController.js';
import { createMediaController } from './controllers/mediaController.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { withTransaction as realWithTransaction } from './db/transactions.js';

/**
 * @param {{
 *   userRepository?, integrationRepository?, logRepository?,
 *   loggingService?, hctiService?, authService?, withTransaction?
 * }} [overrides]
 */
export function buildContainer(overrides = {}) {
  const users = overrides.userRepository ?? userRepository;
  const integrations = overrides.integrationRepository ?? integrationRepository;
  const logRepo = overrides.logRepository ?? logRepository;
  const withTransaction = overrides.withTransaction ?? realWithTransaction;

  const logging = overrides.loggingService ?? createLoggingService({ logRepository: logRepo });
  const hctiService = overrides.hctiService ?? realHctiService;

  const authService =
    overrides.authService ?? createAuthService({ users, integrations, logging, withTransaction });

  // OAuth + social accounts (Phase 3).
  const oauthStates = overrides.oauthStateRepository ?? oauthStateRepositoryModule;
  const socialAccounts = overrides.socialAccountRepository ?? socialAccountRepositoryModule;
  const providerRegistry = overrides.providerRegistry ?? realProviderRegistry;
  const oauthService =
    overrides.oauthService ??
    createOAuthService({
      registry: providerRegistry,
      oauthStates,
      socialAccounts,
      logging,
      withTransaction,
    });

  const authController = createAuthController({ authService, users, logging });
  const integrationController = createIntegrationController({
    integrations,
    hctiService,
    logging,
    withTransaction,
  });
  // Threads uninstall / data-deletion webhooks.
  const dataDeletion = overrides.dataDeletionRepository ?? dataDeletionRepositoryModule;
  const threadsCallbackService =
    overrides.threadsCallbackService ??
    createThreadsCallbackService({ socialAccounts, dataDeletion, logging });

  // Phase 4: content generation, media, posts, scheduling.
  const postRepo = overrides.postRepository ?? postRepositoryModule;
  const mediaRepo = overrides.mediaAssetRepository ?? mediaAssetRepositoryModule;
  const apiUsage = overrides.apiUsageRepository ?? apiUsageRepositoryModule;
  const mediaAssetService = overrides.mediaAssetService ?? realMediaAssetService;
  const postService =
    overrides.postService ??
    createPostService({
      posts: postRepo,
      socialAccounts,
      mediaRepository: mediaRepo,
      apiUsage,
      integrationRepository: integrations,
      openaiContentService: overrides.openaiContentService,
      socialImageService: overrides.socialImageService,
      mediaAssetService,
      logging,
      withTransaction,
    });

  const oauthController = createOAuthController({ oauthService });
  const socialAccountController = createSocialAccountController({ oauthService, socialAccounts });
  const threadsCallbackController = createThreadsCallbackController({ threadsCallbackService });
  // Phase 4.5: business onboarding + website brand extraction.
  const businessProfiles = overrides.businessProfileRepository ?? businessProfileRepositoryModule;
  const websiteAnalysisService = overrides.websiteAnalysisService ?? realWebsiteAnalysisService;
  const businessProfileService =
    overrides.businessProfileService ??
    createBusinessProfileService({
      profiles: businessProfiles,
      analyzer: websiteAnalysisService,
      logging,
    });

  const postController = createPostController({ postService });
  const mediaController = createMediaController({ mediaAssetService });
  const businessProfileController = createBusinessProfileController({ businessProfileService });

  const { requireAuth, guestOnly, attachUser } = createAuthMiddleware({ users });

  return {
    users,
    integrations,
    logRepository: logRepo,
    oauthStates,
    socialAccounts,
    providerRegistry,
    logging,
    hctiService,
    authService,
    oauthService,
    dataDeletion,
    threadsCallbackService,
    postRepository: postRepo,
    mediaAssetRepository: mediaRepo,
    apiUsageRepository: apiUsage,
    mediaAssetService,
    postService,
    businessProfileRepository: businessProfiles,
    websiteAnalysisService,
    businessProfileService,
    authController,
    integrationController,
    oauthController,
    socialAccountController,
    threadsCallbackController,
    postController,
    mediaController,
    businessProfileController,
    requireAuth,
    guestOnly,
    attachUser,
  };
}

export default buildContainer;
