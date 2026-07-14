/**
 * Threads app-uninstall and data-deletion callback orchestration.
 *
 * These handle server-to-server webhooks from Meta/Threads. Each request is
 * authenticated by verifying its `signed_request` against THREADS_APP_SECRET —
 * there is no session/CSRF. Matching Threads connections are removed (tokens
 * erased; deleted, or revoked when audit history must be preserved). No tokens,
 * signed requests, secrets, or personal data are ever logged.
 */

import { config as defaultConfig } from '../config/env.js';
import { EVENT_TYPES, PROVIDERS } from '../config/constants.js';
import { ValidationError } from '../utils/errors.js';
import { parseSignedRequest as defaultParseSignedRequest } from '../utils/signedRequest.js';
import { generateSecureToken as defaultGenerateSecureToken } from './encryptionService.js';

import * as defaultSocialAccounts from '../repositories/socialAccountRepository.js';
import * as defaultDataDeletion from '../repositories/dataDeletionRepository.js';
import { loggingService as defaultLogging } from './loggingService.js';

export function createThreadsCallbackService({
  socialAccounts = defaultSocialAccounts,
  dataDeletion = defaultDataDeletion,
  logging = defaultLogging,
  appSecret = defaultConfig.providers.threads.appSecret,
  publicBaseUrl = defaultConfig.publicBaseUrl,
  parseSignedRequest = defaultParseSignedRequest,
  generateSecureToken = defaultGenerateSecureToken,
} = {}) {
  /** Verify the signed_request and extract the opaque provider user id. */
  function verify(signedRequest) {
    const payload = parseSignedRequest(signedRequest, appSecret);
    const providerUserId = payload && payload.user_id != null ? String(payload.user_id) : '';
    if (!providerUserId) {
      throw new ValidationError('signed_request is missing user_id');
    }
    return providerUserId;
  }

  /** Remove every Threads connection for a provider user id (all owners). */
  async function removeAccounts(providerUserId) {
    const accounts = await socialAccounts.findThreadsAccountsByProviderUserId(providerUserId);
    let removed = 0;
    for (const acc of accounts) {
      // eslint-disable-next-line no-await-in-loop
      const hasHistory = await socialAccounts.hasPublishedHistory(acc.id);
      if (hasHistory) {
        // eslint-disable-next-line no-await-in-loop
        await socialAccounts.markAccountRevoked(acc.id, acc.userId, { eraseTokens: true });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await socialAccounts.deleteAccountForUser(acc.id, acc.userId);
      }
      removed += 1;
    }
    return removed;
  }

  async function handleUninstall(signedRequest, { req } = {}) {
    const providerUserId = verify(signedRequest);
    const removed = await removeAccounts(providerUserId);
    await logging.record(EVENT_TYPES.THREADS_UNINSTALLED, {
      req,
      message: 'Threads app uninstalled',
      // Never log the provider user id, tokens, or the signed request.
      context: { provider: PROVIDERS.THREADS, accountsRemoved: removed },
    });
    return { removed };
  }

  async function handleDataDeletion(signedRequest, { req } = {}) {
    const providerUserId = verify(signedRequest);
    const removed = await removeAccounts(providerUserId);

    const confirmationCode = generateSecureToken(24); // base64url, ~32 chars
    await dataDeletion.createDeletionRequest({
      confirmationCode,
      provider: PROVIDERS.THREADS,
      providerUserId,
      status: 'completed',
      accountsRemoved: removed,
    });

    await logging.record(EVENT_TYPES.THREADS_DATA_DELETION_REQUESTED, {
      req,
      message: 'Threads data deletion processed',
      context: { provider: PROVIDERS.THREADS, accountsRemoved: removed, confirmationCode },
    });

    const base = String(publicBaseUrl).replace(/\/+$/, '');
    const url = `${base}/api/oauth/threads/data-deletion/status/${confirmationCode}`;
    return { url, confirmationCode, removed };
  }

  async function getDeletionStatus(confirmationCode) {
    const record = await dataDeletion.findByConfirmationCode(confirmationCode);
    if (!record) return null;
    // Safe subset — never any personal data or provider user id.
    return { confirmationCode: record.confirmationCode, status: record.status };
  }

  return { handleUninstall, handleDataDeletion, getDeletionStatus };
}

export const threadsCallbackService = createThreadsCallbackService();
export default threadsCallbackService;
