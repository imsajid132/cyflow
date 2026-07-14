/**
 * Social account controller (factory).
 *
 * Lists connected accounts (sanitized, token-free, no raw provider metadata),
 * verifies an account (with optional refresh first), and disconnects one
 * (local-only; preserves audit history when required). All identity comes from
 * the session; ownership is enforced in the service/repository.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { oauthService as defaultOAuthService } from '../services/oauthService.js';
import * as defaultSocialAccounts from '../repositories/socialAccountRepository.js';

/** Project a sanitized repo account to the public API shape (no metadata/scopes). */
function toApiShape(account) {
  if (!account) return null;
  return {
    id: account.id,
    provider: account.provider,
    accountType: account.accountType,
    providerAccountId: account.providerAccountId,
    displayName: account.displayName,
    username: account.username,
    status: account.status,
    tokenExpiresAt: account.tokenExpiresAt ?? null,
    lastVerifiedAt: account.lastVerifiedAt ?? null,
    createdAt: account.createdAt ?? null,
  };
}

export function createSocialAccountController({
  oauthService = defaultOAuthService,
  socialAccounts = defaultSocialAccounts,
} = {}) {
  const listAccounts = asyncHandler(async (req, res) => {
    const accounts = await socialAccounts.listAccountsForUser(req.user.id);
    return sendSuccess(res, { accounts: accounts.map(toApiShape) });
  });

  const verifyAccount = asyncHandler(async (req, res) => {
    const result = await oauthService.verifyConnectedAccount(
      { userId: req.user.id, accountId: req.params.id },
      { req },
    );
    return sendSuccess(res, {
      verified: result.verified,
      account: toApiShape(result.account),
    });
  });

  const disconnectAccount = asyncHandler(async (req, res) => {
    // Confirmation ("confirm": "DISCONNECT") is enforced by the validator.
    const result = await oauthService.disconnectConnectedAccount(
      { userId: req.user.id, accountId: req.params.id },
      { req },
    );
    return sendSuccess(res, { disconnected: true, preserved: result.preserved });
  });

  return { listAccounts, verifyAccount, disconnectAccount };
}

export default createSocialAccountController;
