/**
 * Threads provider (provider key: "threads").
 *
 * Flow: authorization (threads.net) → code exchange (short-lived) →
 * th_exchange_token long-lived exchange (honoring provider expires_in) →
 * profile identity. Token refresh uses grant_type=th_refresh_token. Token
 * lifetimes are taken from provider expires_in — never hardcoded.
 *
 * Least-privilege scopes: threads_basic, threads_content_publish.
 */

import { BaseProvider } from './baseProvider.js';
import { OAuthError, OAUTH_ERROR_CODES } from '../utils/oauthErrors.js';
import { classifyHttpStatus } from '../utils/providerHttp.js';
import { PROVIDERS, ACCOUNT_TYPES, OAUTH_SCOPES } from '../config/constants.js';

export class ThreadsProvider extends BaseProvider {
  constructor(deps) {
    super({ ...deps, key: PROVIDERS.THREADS });
  }

  get version() {
    return this.providerConfig.graphVersion;
  }

  getAuthorizationUrl({ state }) {
    this.ensureConfigured();
    return this.buildAuthorizationUrl('https://threads.net/oauth/authorize', {
      client_id: this.providerConfig.appId,
      redirect_uri: this.providerConfig.redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES.threads.join(','),
      state,
    });
  }

  async exchangeAuthorizationCode({ code }) {
    this.ensureConfigured();
    // 1) short-lived token via form-urlencoded POST.
    const shortRes = await this.http.request({
      url: 'https://graph.threads.net/oauth/access_token',
      method: 'POST',
      form: {
        client_id: this.providerConfig.appId,
        client_secret: this.providerConfig.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: this.providerConfig.redirectUri,
        code,
      },
    });
    if (!shortRes.ok || !shortRes.data || typeof shortRes.data.access_token !== 'string') {
      if (shortRes.status === 400) throw new OAuthError(OAUTH_ERROR_CODES.INVALID_AUTHORIZATION_CODE);
      throw new OAuthError(classifyHttpStatus(shortRes.status));
    }
    const shortToken = shortRes.data.access_token;
    const providerUserId = shortRes.data.user_id != null ? String(shortRes.data.user_id) : null;

    // 2) long-lived token exchange (th_exchange_token), honor expires_in.
    const longRes = await this.http.request({
      url: this.buildAuthorizationUrl('https://graph.threads.net/access_token', {
        grant_type: 'th_exchange_token',
        client_secret: this.providerConfig.appSecret,
        access_token: shortToken,
      }),
      method: 'GET',
    });
    if (!longRes.ok || !longRes.data || typeof longRes.data.access_token !== 'string') {
      throw new OAuthError(classifyHttpStatus(longRes.status));
    }

    return {
      accessToken: longRes.data.access_token,
      expiresIn: Number(longRes.data.expires_in) || null,
      providerUserId,
    };
  }

  async discoverAccounts(tokenResult) {
    this.ensureConfigured();
    const res = await this.http.request({
      url: this.buildAuthorizationUrl(`https://graph.threads.net/${this.version}/me`, {
        fields: 'id,username,name',
        access_token: tokenResult.accessToken,
      }),
      method: 'GET',
    });
    if (!res.ok) throw new OAuthError(classifyHttpStatus(res.status));
    const p = res.data;
    if (!p || !p.id) throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE);

    const providerAccountId = String(p.id);
    return [
      {
        provider: PROVIDERS.THREADS,
        accountType: ACCOUNT_TYPES.THREADS_PROFILE,
        providerUserId: tokenResult.providerUserId || providerAccountId,
        providerAccountId,
        displayName: p.name ?? null,
        username: p.username ?? null,
        accessToken: tokenResult.accessToken,
        refreshToken: null,
        tokenExpiresAt: null, // computed by the service from expiresIn
        refreshTokenExpiresAt: null,
        expiresIn: tokenResult.expiresIn ?? null,
        scopes: OAUTH_SCOPES.threads.slice(),
        providerMetadata: {},
      },
    ];
  }

  async verifyAccount({ account, accessToken }) {
    this.ensureConfigured();
    const res = await this.http.request({
      url: this.buildAuthorizationUrl(`https://graph.threads.net/${this.version}/me`, {
        fields: 'id,username,name',
        access_token: accessToken,
      }),
      method: 'GET',
    });
    if (!res.ok) throw new OAuthError(classifyHttpStatus(res.status));
    const p = res.data;
    if (!p || String(p.id) !== String(account.providerAccountId)) {
      throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
    }
    return { providerAccountId: String(p.id), displayName: p.name ?? account.displayName, username: p.username };
  }

  async refreshAccountToken({ accessToken }) {
    this.ensureConfigured();
    const res = await this.http.request({
      url: this.buildAuthorizationUrl('https://graph.threads.net/refresh_access_token', {
        grant_type: 'th_refresh_token',
        access_token: accessToken,
      }),
      method: 'GET',
    });
    if (!res.ok || !res.data || typeof res.data.access_token !== 'string') {
      throw new OAuthError(classifyHttpStatus(res.status));
    }
    return {
      accessToken: res.data.access_token,
      expiresIn: Number(res.data.expires_in) || null,
    };
  }
}

export function createThreadsProvider(deps) {
  return new ThreadsProvider(deps);
}

export default createThreadsProvider;
