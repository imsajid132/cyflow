/**
 * Base provider contract.
 *
 * Every provider (meta/instagram/threads) implements:
 *   - isConfigured()
 *   - getAuthorizationUrl({ state })
 *   - exchangeAuthorizationCode({ code })  → { accounts?, token context }
 *   - discoverAccounts(tokenResult)        → [accountDescriptor]
 *   - verifyAccount({ account, accessToken })
 *   - refreshAccountToken({ account, accessToken, refreshToken })
 *   - normalizeProviderError(error)
 *
 * Publishing is NOT part of this phase.
 *
 * An accountDescriptor is a plain object:
 *   { provider, accountType, providerUserId, providerAccountId, displayName,
 *     username, accessToken, refreshToken, tokenExpiresAt, refreshTokenExpiresAt,
 *     scopes, providerMetadata }
 * where accessToken/refreshToken are PLAINTEXT — the oauthService encrypts them
 * before any repository call.
 */

import { OAuthError, OAUTH_ERROR_CODES } from '../utils/oauthErrors.js';

export class BaseProvider {
  /**
   * @param {{ key:string, providerConfig:object, http:{ request:Function } }} deps
   */
  constructor({ key, providerConfig, http }) {
    this.key = key;
    this.providerConfig = providerConfig || {};
    this.http = http;
  }

  isConfigured() {
    return !!this.providerConfig.available;
  }

  ensureConfigured() {
    if (!this.isConfigured()) {
      throw new OAuthError(
        OAUTH_ERROR_CODES.PROVIDER_CONFIGURATION_ERROR,
        'This provider is not configured on the server',
      );
    }
  }

  /** Build an authorization URL from a fixed base + query params. */
  buildAuthorizationUrl(base, params) {
    const url = new URL(base);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  /** Default error normalization — never leak provider internals. */
  normalizeProviderError(error) {
    if (error instanceof OAuthError) return error;
    return new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
  }

  // Subclasses must implement these.
  // eslint-disable-next-line class-methods-use-this
  getAuthorizationUrl() {
    throw new OAuthError(OAUTH_ERROR_CODES.PROVIDER_CONFIGURATION_ERROR, 'Not implemented');
  }
}

export default BaseProvider;
