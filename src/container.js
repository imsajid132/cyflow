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
import * as plannerPreferenceRepositoryModule from './repositories/plannerPreferenceRepository.js';
import * as plannerRunRepositoryModule from './repositories/plannerRunRepository.js';
import * as plannerRevisionRepositoryModule from './repositories/plannerRevisionRepository.js';
import { createBusinessProfileService } from './services/businessProfileService.js';
import { createPlannerService } from './services/plannerService.js';
import { config as defaultConfig } from './config/env.js';
import * as automationRepositoryModule from './repositories/automationRepository.js';
import * as backgroundJobRepositoryModule from './repositories/backgroundJobRepository.js';
import { createAutomationService } from './services/automationService.js';
import { createDurableJobService } from './services/durableJobService.js';
import { createAutomationController } from './controllers/automationController.js';
import * as publishRepositoryModule from './repositories/publishRepository.js';
import { createPublishingService } from './services/publishingService.js';
import { createAdapters } from './publishing/adapters.js';
import { createProviderHttp } from './utils/providerHttp.js';
import { createPublishController } from './controllers/publishController.js';
import { createAccountDataService } from './services/accountDataService.js';
import { createAccountController } from './controllers/accountController.js';
import { createMediaStorage } from './services/mediaStorage.js';
import { createExportStorage } from './services/exportStorage.js';
import * as accountDataRepositoryModule from './repositories/accountDataRepository.js';
import { openaiContentService as realOpenAI } from './services/openaiContentService.js';
import { socialImageService as realSocialImage } from './services/socialImageService.js';
import { contentUniquenessService as realUniquenessService } from './services/contentUniquenessService.js';
import { createPlannerController } from './controllers/plannerController.js';
import { websiteAnalysisService as realWebsiteAnalysisService } from './services/websiteAnalysisService.js';
import { createBusinessProfileController } from './controllers/businessProfileController.js';
import { createLoggingService } from './services/loggingService.js';
import { createAuthService } from './services/authService.js';
import { hctiService as realHctiService } from './services/hctiService.js';
import { openAiVerifier as realOpenAiVerifier } from './services/openAiVerifier.js';
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
import { createMediaLibraryController } from './controllers/mediaLibraryController.js';
import { createMediaLibraryService } from './services/mediaLibraryService.js';
import { createMediaUploadMiddleware } from './middleware/mediaUpload.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { withTransaction as realWithTransaction } from './db/transactions.js';

/**
 * @param {{
 *   userRepository?, integrationRepository?, logRepository?,
 *   loggingService?, hctiService?, openAiVerifier?, authService?, withTransaction?
 * }} [overrides]
 */
export function buildContainer(overrides = {}) {
  const users = overrides.userRepository ?? userRepository;
  const integrations = overrides.integrationRepository ?? integrationRepository;
  const logRepo = overrides.logRepository ?? logRepository;
  const withTransaction = overrides.withTransaction ?? realWithTransaction;

  const logging = overrides.loggingService ?? createLoggingService({ logRepository: logRepo });
  const hctiService = overrides.hctiService ?? realHctiService;
  const openAiVerifier = overrides.openAiVerifier ?? realOpenAiVerifier;

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
    openAiVerifier,
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
  // Phase 4.5: business onboarding + website brand extraction. Resolved before
  // postService, which reads the profile to brand generated images.
  const businessProfiles = overrides.businessProfileRepository ?? businessProfileRepositoryModule;
  // Resolved here (not lower down) so postService can report publishing readiness
  // (config.publishing.liveEnabled) through /api/posts/capabilities.
  const config = overrides.config ?? defaultConfig;
  // E: Publish Now enqueues durable D2 jobs. publishingService is built further
  // down (it has no dependency on postService), so postService is handed a
  // deferred reference that resolves at request time.
  let publishingServiceRef = null;
  const postService =
    overrides.postService ??
    createPostService({
      posts: postRepo,
      socialAccounts,
      mediaRepository: mediaRepo,
      apiUsage,
      integrationRepository: integrations,
      businessProfiles,
      openaiContentService: overrides.openaiContentService,
      socialImageService: overrides.socialImageService,
      mediaAssetService,
      logging,
      withTransaction,
      config,
      enqueuePublish: (userId, postId) =>
        (publishingServiceRef
          ? publishingServiceRef.enqueuePublishForPost(userId, postId)
          : Promise.resolve({ enqueued: 0 })),
    });

  const oauthController = createOAuthController({ oauthService });
  const socialAccountController = createSocialAccountController({ oauthService, socialAccounts });
  const threadsCallbackController = createThreadsCallbackController({ threadsCallbackService });
  const websiteAnalysisService = overrides.websiteAnalysisService ?? realWebsiteAnalysisService;
  const businessProfileService =
    overrides.businessProfileService ??
    createBusinessProfileService({
      profiles: businessProfiles,
      analyzer: websiteAnalysisService,
      logging,
    });

  // Phase 4.7: auto content planner.
  const plannerPreferences = overrides.plannerPreferenceRepository ?? plannerPreferenceRepositoryModule;
  const plannerRuns = overrides.plannerRunRepository ?? plannerRunRepositoryModule;
  const plannerRevisions = overrides.plannerRevisionRepository ?? plannerRevisionRepositoryModule;
  const uniquenessService = overrides.contentUniquenessService ?? realUniquenessService;
  const plannerService =
    overrides.plannerService ??
    createPlannerService({
      preferences: plannerPreferences,
      runs: plannerRuns,
      revisions: plannerRevisions,
      businessProfiles,
      socialAccounts,
      /*
       * Lets the weekly board name the account a post targets. Resolved inline
       * rather than through the `automationRepository` const below, which is
       * declared AFTER this call — referencing it here is a temporal dead zone
       * error that takes down every route, not just the board.
       */
      automations: overrides.automationRepository ?? automationRepositoryModule,
      posts: postRepo,
      mediaRepository: mediaRepo,
      apiUsage,
      openaiContentService: overrides.openaiContentService,
      socialImageService: overrides.socialImageService,
      mediaAssetService,
      uniqueness: uniquenessService,
      logging,
      withTransaction,
    });

  const postController = createPostController({ postService });
  // C3 media library: upload/list/reuse/references, over a local storage adapter.
  const mediaLibraryService = overrides.mediaLibraryService
    ?? createMediaLibraryService({ mediaRepository: mediaRepo, logging });
  const mediaController = createMediaController({ mediaAssetService, mediaLibraryService });
  const mediaLibraryController = createMediaLibraryController({ mediaLibraryService });
  const parseSingleImage = overrides.parseSingleImage ?? createMediaUploadMiddleware();
  const businessProfileController = createBusinessProfileController({ businessProfileService });
  const plannerController = createPlannerController({ plannerService });

  // D1: content automations + the durable background job runtime. The automation
  // service reuses the planner for slot generation; the durable job service runs
  // the automation handlers. Neither publishes to a provider (that is D2).
  const automationRepository = overrides.automationRepository ?? automationRepositoryModule;
  const backgroundJobRepository = overrides.backgroundJobRepository ?? backgroundJobRepositoryModule;
  const openaiContentServiceResolved = overrides.openaiContentService ?? realOpenAI;
  const socialImageServiceResolved = overrides.socialImageService ?? realSocialImage;
  // An optional injectable clock. Defaults to real time everywhere; the review
  // harness passes a per-tick clock so reconciliation lands on a later worker
  // pass (as it would in production) rather than inside the same drain.
  const now = overrides.now;
  const automationService = overrides.automationService ?? createAutomationService({
    automations: automationRepository,
    jobs: backgroundJobRepository,
    runsRepo: plannerRuns,
    socialAccounts,
    planner: plannerService,
    openai: openaiContentServiceResolved,
    images: socialImageServiceResolved,
    logging,
    config,
    now,
  });
  // D2: provider publishing. Real adapters (fake-injectable for tests) + a
  // publishing service whose durable job handlers run on the SAME worker as the
  // automation handlers. Nothing calls a provider unless config.publishing.liveEnabled.
  const publishAdapters = overrides.publishAdapters
    ?? createAdapters({ http: createProviderHttp(), config });
  const publishingService = overrides.publishingService ?? createPublishingService({
    publishRepo: overrides.publishRepository ?? publishRepositoryModule,
    socialAccounts,
    mediaRepository: mediaRepo,
    jobs: backgroundJobRepository,
    adapters: publishAdapters,
    logging,
    config,
    now,
  });
  // Now publishingService exists: resolve the deferred reference postService uses
  // for Publish Now.
  publishingServiceRef = publishingService;

  // G: user data export + account deletion. Durable jobs on the same runtime.
  const accountDataRepo = overrides.accountDataRepository ?? accountDataRepositoryModule;
  // A config-backed media store for byte removal during deletion. Guarded so a
  // missing storage root (e.g. some test setups) degrades to a safe no-op.
  let mediaByteStore = overrides.mediaStore;
  if (!mediaByteStore) {
    try { mediaByteStore = createMediaStorage({ root: config.media?.storagePath }); }
    catch { mediaByteStore = { async removeStoredImage() { return false; } }; }
  }
  const accountDataService = overrides.accountDataService ?? createAccountDataService({
    users, accountData: accountDataRepo, integrations, socialAccounts,
    businessProfiles, plannerPreferences, plannerRuns, posts: postRepo,
    media: mediaRepo, apiUsage, jobs: backgroundJobRepository,
    verifyPassword: authService.verifyPassword, logging, withTransaction, now,
    mediaStore: mediaByteStore,
    // Config-backed, mirroring mediaStore above. Without this the export store
    // always fell back to `<cwd>/.data/exports` and no deployment could put
    // export archives on persistent storage. An explicit override still wins,
    // so tests keep injecting their own.
    exportStore: overrides.exportStore ?? createExportStorage(config.exports?.storagePath),
  });

  const durableJobService = overrides.durableJobService ?? createDurableJobService({
    jobs: backgroundJobRepository,
    // Automation + publishing + account handlers share one durable job runtime.
    handlers: { ...automationService.handlers, ...publishingService.handlers, ...accountDataService.handlers },
    logging,
    now,
    options: {
      leaseMs: (config.worker?.leaseSeconds ?? 120) * 1000,
      heartbeatMs: (config.worker?.heartbeatSeconds ?? 30) * 1000,
      baseRetrySeconds: config.worker?.baseRetrySeconds ?? 30,
      maxRetrySeconds: config.worker?.maxRetrySeconds ?? 3600,
    },
  });
  const automationController = createAutomationController({ automationService });
  const publishController = createPublishController({ publishingService });
  const accountController = createAccountController({ accountDataService });

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
    plannerPreferenceRepository: plannerPreferences,
    plannerRunRepository: plannerRuns,
    contentUniquenessService: uniquenessService,
    plannerService,
    automationRepository,
    backgroundJobRepository,
    automationService,
    durableJobService,
    automationController,
    publishingService,
    publishController,
    accountDataService,
    accountController,
    authController,
    integrationController,
    oauthController,
    socialAccountController,
    threadsCallbackController,
    postController,
    mediaController,
    mediaLibraryService,
    mediaLibraryController,
    parseSingleImage,
    businessProfileController,
    plannerController,
    requireAuth,
    guestOnly,
    attachUser,
  };
}

export default buildContainer;
