/**
 * OAuth orchestration service.
 *
 * Ties together the provider registry, one-time state storage, the social
 * account repository, encryption, and logging. Raw state is generated with ≥32
 * random bytes, only its SHA-256 hash is stored, state is consumed atomically
 * exactly once, and provider/expiry/user/redirect-URI are all verified. Tokens
 * are encrypted before any repository call; plaintext token references are
 * dropped after use. Raw state, authorization codes, and tokens are never
 * logged.
 */

import { config as defaultConfig } from '../config/env.js';
import {
  PROVIDERS,
  EVENT_TYPES,
  OAUTH_STATE_BYTES,
  SOCIAL_ACCOUNT_STATUS,
} from '../config/constants.js';
import { OAuthError, OAUTH_ERROR_CODES } from '../utils/oauthErrors.js';
import { NotFoundError } from '../utils/errors.js';
import { addMinutesUtc, addSecondsUtc, toMysqlUtc, nowIso } from '../utils/time.js';

import { providerRegistry as defaultRegistry } from '../providers/providerRegistry.js';
import * as defaultOAuthStates from '../repositories/oauthStateRepository.js';
import * as defaultSocialAccounts from '../repositories/socialAccountRepository.js';
import { loggingService as defaultLogging } from './loggingService.js';
import { withTransaction as defaultWithTransaction } from '../db/transactions.js';
import {
  encryptSecret as defaultEncrypt,
  decryptSecret as defaultDecrypt,
  hashOAuthState as defaultHashState,
  generateSecureToken as defaultGenerateToken,
} from './encryptionService.js';

function reasonToClassification(reason) {
  if (reason === 'expired') return OAUTH_ERROR_CODES.EXPIRED_STATE;
  return OAUTH_ERROR_CODES.INVALID_STATE;
}

export function createOAuthService({
  registry = defaultRegistry,
  oauthStates = defaultOAuthStates,
  socialAccounts = defaultSocialAccounts,
  logging = defaultLogging,
  withTransaction = defaultWithTransaction,
  config = defaultConfig,
  encryptSecret = defaultEncrypt,
  decryptSecret = defaultDecrypt,
  hashOAuthState = defaultHashState,
  generateSecureToken = defaultGenerateToken,
} = {}) {
  function getProviderAvailability() {
    return registry.availability();
  }

  function assertProvider(provider) {
    if (!registry.isValidProvider(provider)) {
      throw new OAuthError(OAUTH_ERROR_CODES.PROVIDER_CONFIGURATION_ERROR, 'Unknown provider');
    }
    return registry.get(provider);
  }

  // --- start ---------------------------------------------------------------
  async function startOAuth({ userId, provider }, { req } = {}) {
    const p = assertProvider(provider);
    if (!p.isConfigured()) {
      throw new OAuthError(OAUTH_ERROR_CODES.PROVIDER_CONFIGURATION_ERROR);
    }

    // Supersede any prior states for this user/provider.
    await oauthStates.deleteOAuthStatesForUserAndProvider(userId, provider);

    const rawState = generateSecureToken(OAUTH_STATE_BYTES); // ≥32 random bytes
    const stateHash = hashOAuthState(rawState);
    const redirectUri = p.providerConfig.redirectUri;
    const expiresAt = addMinutesUtc(config.oauth.stateTtlMinutes);

    await oauthStates.createOAuthState({
      userId,
      provider,
      stateHash,
      encryptedCodeVerifier: null, // no PKCE for these flows
      redirectUri,
      expiresAt,
    });

    const authorizationUrl = p.getAuthorizationUrl({ state: rawState });

    await logging.record(EVENT_TYPES.OAUTH_STARTED, {
      req,
      userId,
      message: 'OAuth started',
      context: { provider }, // never the raw state
    });

    return { authorizationUrl };
  }

  // --- complete ------------------------------------------------------------
  async function completeOAuth({ userId, provider, state, code, providerError }, { req } = {}) {
    const p = assertProvider(provider);

    // User denied / provider returned an error param.
    if (providerError) {
      if (state) {
        try {
          await oauthStates.consumeOAuthState({
            stateHash: hashOAuthState(state),
            provider,
            expectedUserId: userId,
          });
        } catch {
          /* best-effort invalidation */
        }
      }
      await logging.record(EVENT_TYPES.OAUTH_AUTHORIZATION_DENIED, {
        req,
        userId,
        level: 'warn',
        message: 'OAuth authorization denied',
        context: { provider },
      });
      return { ok: false, provider, classification: OAUTH_ERROR_CODES.PERMISSION_DENIED };
    }

    if (!state) {
      await logging.record(EVENT_TYPES.OAUTH_STATE_REJECTED, {
        req, userId, level: 'warn', message: 'Missing OAuth state', context: { provider },
      });
      return { ok: false, provider, classification: OAUTH_ERROR_CODES.INVALID_STATE };
    }

    // Consume state atomically (provider/expiry/user/consumed all checked).
    const consumed = await oauthStates.consumeOAuthState({
      stateHash: hashOAuthState(state),
      provider,
      expectedUserId: userId,
    });
    if (!consumed.ok) {
      await logging.record(EVENT_TYPES.OAUTH_STATE_REJECTED, {
        req, userId, level: 'warn', message: 'OAuth state rejected', context: { provider, reason: consumed.reason },
      });
      return { ok: false, provider, classification: reasonToClassification(consumed.reason) };
    }

    // Exact redirect URI must match the configured provider URI.
    if (consumed.state.redirectUri !== p.providerConfig.redirectUri) {
      await logging.record(EVENT_TYPES.OAUTH_STATE_REJECTED, {
        req, userId, level: 'warn', message: 'OAuth redirect URI mismatch', context: { provider },
      });
      return { ok: false, provider, classification: OAUTH_ERROR_CODES.INVALID_STATE };
    }

    if (!code) {
      return { ok: false, provider, classification: OAUTH_ERROR_CODES.INVALID_AUTHORIZATION_CODE };
    }

    try {
      const tokenResult = await p.exchangeAuthorizationCode({ code });
      const accounts = await p.discoverAccounts(tokenResult);

      const connected = [];
      for (const account of accounts) {
        const encryptedAccessToken = encryptSecret(account.accessToken);
        const encryptedRefreshToken = account.refreshToken
          ? encryptSecret(account.refreshToken)
          : null;
        const tokenExpiresAt =
          account.tokenExpiresAt ??
          (account.expiresIn ? addSecondsUtc(account.expiresIn) : null);

        // eslint-disable-next-line no-await-in-loop
        const saved = await withTransaction(async (conn) =>
          socialAccounts.upsertSocialAccount(
            {
              userId,
              provider: account.provider,
              accountType: account.accountType,
              providerUserId: account.providerUserId,
              providerAccountId: account.providerAccountId,
              displayName: account.displayName,
              username: account.username,
              encryptedAccessToken,
              encryptedRefreshToken,
              tokenExpiresAt,
              refreshTokenExpiresAt: account.refreshTokenExpiresAt ?? null,
              scopes: account.scopes,
              providerMetadata: account.providerMetadata,
              status: SOCIAL_ACCOUNT_STATUS.ACTIVE,
              lastVerifiedAt: toMysqlUtc(),
            },
            conn,
          ),
        );
        connected.push(saved);
        // eslint-disable-next-line no-await-in-loop
        await logging.record(EVENT_TYPES.SOCIAL_ACCOUNT_CONNECTED, {
          req,
          userId,
          message: 'Social account connected',
          context: {
            provider: account.provider,
            accountType: account.accountType,
            providerAccountId: account.providerAccountId,
            displayName: account.displayName,
          },
        });
      }

      await logging.record(EVENT_TYPES.OAUTH_COMPLETED, {
        req, userId, message: 'OAuth completed', context: { provider, connected: connected.length },
      });

      return { ok: true, provider, connectedCount: connected.length, accounts: connected };
    } catch (err) {
      const oe = p.normalizeProviderError ? p.normalizeProviderError(err) : err;
      const classification =
        oe instanceof OAuthError ? oe.classification : OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE;
      await logging.record(EVENT_TYPES.OAUTH_FAILED, {
        req, userId, level: 'error', message: 'OAuth failed', context: { provider, classification },
      });
      return { ok: false, provider, classification };
    }
  }

  // --- verify --------------------------------------------------------------
  function needsRefresh(row) {
    if (row.provider === PROVIDERS.META) return false; // no conventional refresh
    if (!row.token_expires_at) return false;
    let expMs;
    try {
      expMs = new Date(String(row.token_expires_at).replace(' ', 'T') + 'Z').getTime();
    } catch {
      return false;
    }
    const leewayMs = config.oauth.tokenRefreshLeewayMinutes * 60_000;
    return expMs - Date.now() <= leewayMs;
  }

  async function verifyConnectedAccount({ userId, accountId }, { req } = {}) {
    const row = await socialAccounts.findAccountWithEncryptedTokens(accountId, userId);
    if (!row) throw new NotFoundError('Connected account not found');
    const p = assertProvider(row.provider);

    let accessToken = row.access_token_encrypted ? decryptSecret(row.access_token_encrypted) : null;
    try {
      // Optionally refresh first (Instagram/Threads) when near expiry.
      if (accessToken && needsRefresh(row)) {
        const refreshed = await p.refreshAccountToken({
          account: { providerAccountId: row.provider_account_id },
          accessToken,
          refreshToken: row.refresh_token_encrypted ? decryptSecret(row.refresh_token_encrypted) : null,
        });
        if (refreshed && refreshed.accessToken) {
          accessToken = refreshed.accessToken;
          const tokenExpiresAt = refreshed.expiresIn ? addSecondsUtc(refreshed.expiresIn) : row.token_expires_at;
          await socialAccounts.updateEncryptedTokens(accountId, userId, {
            encryptedAccessToken: encryptSecret(accessToken),
            encryptedRefreshToken: row.refresh_token_encrypted,
            tokenExpiresAt,
            refreshTokenExpiresAt: row.refresh_token_expires_at,
          });
          await logging.record(EVENT_TYPES.SOCIAL_ACCOUNT_TOKEN_REFRESHED, {
            req, userId, message: 'Token refreshed', context: { provider: row.provider, providerAccountId: row.provider_account_id },
          });
        }
      }

      const verification = await p.verifyAccount({
        account: { providerAccountId: row.provider_account_id, displayName: row.display_name },
        accessToken,
      });
      const updated = await socialAccounts.updateVerificationStatus(accountId, userId, {
        displayName: verification.displayName,
        lastVerifiedAt: toMysqlUtc(),
        status: SOCIAL_ACCOUNT_STATUS.ACTIVE,
      });
      await logging.record(EVENT_TYPES.SOCIAL_ACCOUNT_VERIFIED, {
        req, userId, message: 'Account verified', context: { provider: row.provider, providerAccountId: row.provider_account_id },
      });
      return { verified: true, account: updated };
    } catch (err) {
      const oe = err instanceof OAuthError ? err : new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
      // Map classification → stored status.
      if (oe.classification === OAUTH_ERROR_CODES.REVOKED_TOKEN) {
        await socialAccounts.markAccountRevoked(accountId, userId, { eraseTokens: true });
      } else if (
        oe.classification === OAUTH_ERROR_CODES.INVALID_TOKEN ||
        oe.classification === OAUTH_ERROR_CODES.EXPIRED_TOKEN
      ) {
        await socialAccounts.markAccountExpired(accountId, userId);
      } else {
        await socialAccounts.markAccountError(accountId, userId);
      }
      await logging.record(EVENT_TYPES.SOCIAL_ACCOUNT_VERIFICATION_FAILED, {
        req, userId, level: 'warn', message: 'Account verification failed',
        context: { provider: row.provider, providerAccountId: row.provider_account_id, classification: oe.classification },
      });
      const account = await socialAccounts.findAccountByIdForUser(accountId, userId);
      return { verified: false, account, classification: oe.classification };
    } finally {
      accessToken = undefined;
    }
  }

  // --- disconnect ----------------------------------------------------------
  async function disconnectConnectedAccount({ userId, accountId }, { req } = {}) {
    const account = await socialAccounts.findAccountByIdForUser(accountId, userId);
    if (!account) throw new NotFoundError('Connected account not found');

    // Preserve audit history if any published-post targets reference this account.
    const hasHistory = await socialAccounts.hasPublishedHistory(accountId);
    if (hasHistory) {
      await socialAccounts.markAccountRevoked(accountId, userId, { eraseTokens: true });
    } else {
      await socialAccounts.deleteAccountForUser(accountId, userId);
    }

    await logging.record(EVENT_TYPES.SOCIAL_ACCOUNT_DISCONNECTED, {
      req, userId, message: 'Social account disconnected',
      context: { provider: account.provider, providerAccountId: account.providerAccountId, preserved: hasHistory },
    });

    return { ok: true, preserved: hasHistory };
  }

  return {
    getProviderAvailability,
    startOAuth,
    completeOAuth,
    verifyConnectedAccount,
    disconnectConnectedAccount,
  };
}

export const oauthService = createOAuthService();
export default oauthService;
