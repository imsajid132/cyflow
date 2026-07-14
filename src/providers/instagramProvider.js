/**
 * Instagram provider (provider key: "instagram") — Instagram Business Login.
 *
 * Uses INSTAGRAM_* credentials only (never META_*). Flow: authorization →
 * form-urlencoded code exchange (short-lived) → long-lived token exchange
 * (honoring provider expires_in) → professional-account identity. Personal /
 * ineligible accounts are rejected as account_not_eligible.
 *
 * Least-privilege scopes: instagram_business_basic,
 * instagram_business_content_publish.
 */

import { BaseProvider } from './baseProvider.js';
import { OAuthError, OAUTH_ERROR_CODES } from '../utils/oauthErrors.js';
import { classifyHttpStatus } from '../utils/providerHttp.js';
import { PROVIDERS, ACCOUNT_TYPES, OAUTH_SCOPES } from '../config/constants.js';

const ELIGIBLE_ACCOUNT_TYPES = new Set(['BUSINESS', 'MEDIA_CREATOR', 'CREATOR']);

export class InstagramProvider extends BaseProvider {
  constructor(deps) {
    super({ ...deps, key: PROVIDERS.INSTAGRAM });
  }

  get version() {
    return this.providerConfig.graphVersion;
  }

  getAuthorizationUrl({ state }) {
    this.ensureConfigured();
    return this.buildAuthorizationUrl('https://www.instagram.com/oauth/authorize', {
      client_id: this.providerConfig.appId,
      redirect_uri: this.providerConfig.redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES.instagram.join(','),
      state,
    });
  }

  async exchangeAuthorizationCode({ code }) {
    this.ensureConfigured();
    // 1) short-lived token via form-urlencoded POST.
    const shortRes = await this.http.request({
      url: 'https://api.instagram.com/oauth/access_token',
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

    // 2) long-lived token exchange (honor expires_in).
    const longRes = await this.http.request({
      url: this.buildAuthorizationUrl('https://graph.instagram.com/access_token', {
        grant_type: 'ig_exchange_token',
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
    const identityRes = await this.http.request({
      url: this.buildAuthorizationUrl(`https://graph.instagram.com/${this.version}/me`, {
        fields: 'user_id,username,account_type,name',
        access_token: tokenResult.accessToken,
      }),
      method: 'GET',
    });
    if (!identityRes.ok) throw new OAuthError(classifyHttpStatus(identityRes.status));
    const id = identityRes.data;
    if (!id || (!id.user_id && !id.id)) {
      throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
    }
    const accountType = String(id.account_type || '').toUpperCase();
    if (!ELIGIBLE_ACCOUNT_TYPES.has(accountType)) {
      throw new OAuthError(OAUTH_ERROR_CODES.ACCOUNT_NOT_ELIGIBLE);
    }

    const providerAccountId = String(id.user_id || id.id);
    return [
      {
        provider: PROVIDERS.INSTAGRAM,
        accountType: ACCOUNT_TYPES.INSTAGRAM_PROFESSIONAL,
        providerUserId: tokenResult.providerUserId || providerAccountId,
        providerAccountId,
        displayName: id.name ?? null,
        username: id.username ?? null,
        accessToken: tokenResult.accessToken,
        refreshToken: null, // IG long-lived tokens are refreshed, not rotated via refresh_token
        tokenExpiresAt: null, // computed by the service from expiresIn
        refreshTokenExpiresAt: null,
        expiresIn: tokenResult.expiresIn ?? null,
        scopes: OAUTH_SCOPES.instagram.slice(),
        providerMetadata: { accountType },
      },
    ];
  }

  async verifyAccount({ account, accessToken }) {
    this.ensureConfigured();
    const res = await this.http.request({
      url: this.buildAuthorizationUrl(`https://graph.instagram.com/${this.version}/me`, {
        fields: 'user_id,username,account_type',
        access_token: accessToken,
      }),
      method: 'GET',
    });
    if (!res.ok) throw new OAuthError(classifyHttpStatus(res.status));
    const id = res.data;
    const gotId = id && String(id.user_id || id.id);
    if (!gotId || gotId !== String(account.providerAccountId)) {
      throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
    }
    return { providerAccountId: gotId, displayName: id.name ?? account.displayName, username: id.username };
  }

  async refreshAccountToken({ accessToken }) {
    this.ensureConfigured();
    const res = await this.http.request({
      url: this.buildAuthorizationUrl('https://graph.instagram.com/refresh_access_token', {
        grant_type: 'ig_refresh_token',
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

export function createInstagramProvider(deps) {
  return new InstagramProvider(deps);
}

export default createInstagramProvider;
