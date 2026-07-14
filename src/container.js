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
import { createLoggingService } from './services/loggingService.js';
import { createAuthService } from './services/authService.js';
import { hctiService as realHctiService } from './services/hctiService.js';
import { createOAuthService } from './services/oauthService.js';
import { providerRegistry as realProviderRegistry } from './providers/providerRegistry.js';
import { createAuthController } from './controllers/authController.js';
import { createIntegrationController } from './controllers/integrationController.js';
import { createOAuthController } from './controllers/oauthController.js';
import { createSocialAccountController } from './controllers/socialAccountController.js';
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
  const oauthController = createOAuthController({ oauthService });
  const socialAccountController = createSocialAccountController({ oauthService, socialAccounts });

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
    authController,
    integrationController,
    oauthController,
    socialAccountController,
    requireAuth,
    guestOnly,
    attachUser,
  };
}

export default buildContainer;
