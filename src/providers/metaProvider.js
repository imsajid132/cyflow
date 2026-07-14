/**
 * Facebook Pages provider (provider key: "meta").
 *
 * Flow: authorization dialog → code exchange (short-lived user token) →
 * long-lived user token → Page discovery (filter to publishable Pages) → one
 * account descriptor per eligible Page carrying that Page's own access token.
 *
 * Least-privilege scopes: pages_show_list, pages_read_engagement,
 * pages_manage_posts. Page access tokens are never returned to the frontend
 * (the oauthService encrypts them before storage).
 */

import { BaseProvider } from './baseProvider.js';
import { OAuthError, OAUTH_ERROR_CODES } from '../utils/oauthErrors.js';
import { classifyHttpStatus } from '../utils/providerHttp.js';
import {
  PROVIDERS,
  ACCOUNT_TYPES,
  OAUTH_SCOPES,
  META_PUBLISHABLE_TASKS,
} from '../config/constants.js';
import { addSecondsUtc } from '../utils/time.js';

export class MetaProvider extends BaseProvider {
  constructor(deps) {
    super({ ...deps, key: PROVIDERS.META });
  }

  get version() {
    return this.providerConfig.graphVersion;
  }

  get graphBase() {
    return `https://graph.facebook.com/${this.version}`;
  }

  getAuthorizationUrl({ state }) {
    this.ensureConfigured();
    return this.buildAuthorizationUrl(`https://www.facebook.com/${this.version}/dialog/oauth`, {
      client_id: this.providerConfig.appId,
      redirect_uri: this.providerConfig.redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES.meta.join(','),
      state,
    });
  }

  async exchangeAuthorizationCode({ code }) {
    this.ensureConfigured();
    // 1) short-lived user token (server-to-server GET, secret in query).
    const shortUrl = this.buildAuthorizationUrl(`${this.graphBase}/oauth/access_token`, {
      client_id: this.providerConfig.appId,
      client_secret: this.providerConfig.appSecret,
      redirect_uri: this.providerConfig.redirectUri,
      code,
    });
    const shortRes = await this.http.request({ url: shortUrl, method: 'GET' });
    if (!shortRes.ok || !shortRes.data || typeof shortRes.data.access_token !== 'string') {
      if (shortRes.status === 400) {
        throw new OAuthError(OAUTH_ERROR_CODES.INVALID_AUTHORIZATION_CODE);
      }
      throw new OAuthError(classifyHttpStatus(shortRes.status));
    }

    // 2) long-lived user token (best-effort — fall back to short-lived).
    let userAccessToken = shortRes.data.access_token;
    let expiresIn = Number(shortRes.data.expires_in) || null;
    const longUrl = this.buildAuthorizationUrl(`${this.graphBase}/oauth/access_token`, {
      grant_type: 'fb_exchange_token',
      client_id: this.providerConfig.appId,
      client_secret: this.providerConfig.appSecret,
      fb_exchange_token: userAccessToken,
    });
    const longRes = await this.http.request({ url: longUrl, method: 'GET' });
    if (longRes.ok && longRes.data && typeof longRes.data.access_token === 'string') {
      userAccessToken = longRes.data.access_token;
      expiresIn = Number(longRes.data.expires_in) || expiresIn;
    }

    return { userAccessToken, expiresIn };
  }

  async discoverAccounts(tokenResult) {
    this.ensureConfigured();
    const userAccessToken = tokenResult.userAccessToken;

    // Authenticated user id (best-effort).
    let providerUserId = null;
    try {
      const meRes = await this.http.request({
        url: `${this.graphBase}/me?fields=id`,
        method: 'GET',
        headers: { Authorization: `Bearer ${userAccessToken}` },
      });
      if (meRes.ok && meRes.data && meRes.data.id) providerUserId = String(meRes.data.id);
    } catch {
      /* non-fatal */
    }

    // Pages the user manages.
    const pagesRes = await this.http.request({
      url: `${this.graphBase}/me/accounts?fields=id,name,tasks,access_token`,
      method: 'GET',
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (!pagesRes.ok) throw new OAuthError(classifyHttpStatus(pagesRes.status));
    if (!pagesRes.data || !Array.isArray(pagesRes.data.data)) {
      throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
    }

    const eligible = pagesRes.data.data.filter((page) => {
      const tasks = Array.isArray(page.tasks) ? page.tasks : [];
      return (
        page.id &&
        typeof page.access_token === 'string' &&
        tasks.some((t) => META_PUBLISHABLE_TASKS.includes(t))
      );
    });

    if (eligible.length === 0) {
      throw new OAuthError(OAUTH_ERROR_CODES.NO_PUBLISHABLE_ACCOUNT);
    }

    return eligible.map((page) => ({
      provider: PROVIDERS.META,
      accountType: ACCOUNT_TYPES.FACEBOOK_PAGE,
      providerUserId,
      providerAccountId: String(page.id),
      displayName: page.name ?? null,
      username: null,
      accessToken: page.access_token, // Page token — encrypted by the service
      refreshToken: null, // Facebook Page tokens have no refresh_token
      tokenExpiresAt: null, // long-lived Page tokens generally do not expire
      refreshTokenExpiresAt: null,
      scopes: OAUTH_SCOPES.meta.slice(),
      providerMetadata: {
        tasks: Array.isArray(page.tasks) ? page.tasks : [],
        // Non-secret hint only.
        userTokenExpiresIn: tokenResult.expiresIn ?? null,
      },
    }));
  }

  async verifyAccount({ account, accessToken }) {
    this.ensureConfigured();
    const res = await this.http.request({
      url: `${this.graphBase}/${account.providerAccountId}?fields=id,name`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const cls = classifyHttpStatus(res.status);
      throw new OAuthError(cls === OAUTH_ERROR_CODES.INVALID_TOKEN ? OAUTH_ERROR_CODES.INVALID_TOKEN : cls);
    }
    if (!res.data || String(res.data.id) !== String(account.providerAccountId)) {
      throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
    }
    return { providerAccountId: String(res.data.id), displayName: res.data.name ?? account.displayName };
  }

  // eslint-disable-next-line class-methods-use-this
  async refreshAccountToken() {
    // Facebook Page tokens are not renewed via a conventional refresh_token.
    return { reconnectRequired: true };
  }
}

export function createMetaProvider(deps) {
  return new MetaProvider(deps);
}

// Small helper the service uses to compute an absolute expiry from expires_in.
export function expiryFromSeconds(expiresIn) {
  const n = Number(expiresIn);
  return Number.isFinite(n) && n > 0 ? addSecondsUtc(n) : null;
}

export default createMetaProvider;
