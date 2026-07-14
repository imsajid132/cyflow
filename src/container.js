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
import { createLoggingService } from './services/loggingService.js';
import { createAuthService } from './services/authService.js';
import { hctiService as realHctiService } from './services/hctiService.js';
import { createAuthController } from './controllers/authController.js';
import { createIntegrationController } from './controllers/integrationController.js';
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

  const authController = createAuthController({ authService, users, logging });
  const integrationController = createIntegrationController({
    integrations,
    hctiService,
    logging,
    withTransaction,
  });

  const { requireAuth, guestOnly, attachUser } = createAuthMiddleware({ users });

  return {
    users,
    integrations,
    logRepository: logRepo,
    logging,
    hctiService,
    authService,
    authController,
    integrationController,
    requireAuth,
    guestOnly,
    attachUser,
  };
}

export default buildContainer;
