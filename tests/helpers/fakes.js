/**
 * In-memory test doubles implementing the SAME interfaces as the production
 * repositories/services. Production code is never modified — the container/app
 * accepts these as `overrides` for hermetic tests (no DB, no network).
 */

import { sanitizeUser } from '../../src/repositories/userRepository.js';
import { sanitizeAccount } from '../../src/repositories/socialAccountRepository.js';
import { sanitizePost } from '../../src/repositories/postRepository.js';
import { evaluateStateRow } from '../../src/repositories/oauthStateRepository.js';
import { normalizeEmail } from '../../src/utils/validation.js';
import { OAuthError, OAUTH_ERROR_CODES } from '../../src/utils/oauthErrors.js';
import { createMediaAssetService } from '../../src/services/mediaAssetService.js';

/** Fake `userRepository`. */
export function createFakeUserRepository(seed = []) {
  const rows = [...seed];
  let nextId = rows.reduce((m, r) => Math.max(m, Number(r.id)), 0) + 1;

  function nowIso() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  return {
    _rows: rows,
    sanitizeUser,
    async findUserById(id) {
      return rows.find((r) => String(r.id) === String(id)) ?? null;
    },
    async findUserByEmail(email) {
      const e = normalizeEmail(email);
      return rows.find((r) => r.email === e) ?? null;
    },
    async emailExists(email) {
      const e = normalizeEmail(email);
      return rows.some((r) => r.email === e);
    },
    async createUser(input) {
      const row = {
        id: String(nextId++),
        name: input.name,
        email: normalizeEmail(input.email),
        password_hash: input.passwordHash,
        timezone: input.timezone,
        role: input.role ?? 'user',
        status: input.status ?? 'active',
        created_at: nowIso(),
        updated_at: nowIso(),
        last_login_at: null,
      };
      rows.push(row);
      return sanitizeUser(row);
    },
    async updateLastLogin(userId) {
      const row = rows.find((r) => String(r.id) === String(userId));
      if (row) row.last_login_at = nowIso();
    },
    async updateProfile(userId, { name, timezone }) {
      const row = rows.find((r) => String(r.id) === String(userId));
      if (!row) return null;
      row.name = name;
      row.timezone = timezone;
      row.updated_at = nowIso();
      return sanitizeUser(row);
    },
    async updatePassword(userId, passwordHash) {
      const row = rows.find((r) => String(r.id) === String(userId));
      if (row) row.password_hash = passwordHash;
    },
    async getSanitizedUserById(userId) {
      const row = rows.find((r) => String(r.id) === String(userId));
      return sanitizeUser(row);
    },
  };
}

/** Fake `integrationRepository`. */
export function createFakeIntegrationRepository() {
  const map = new Map(); // userId -> { encryptedUserId, encryptedApiKey, encryptionVersion, verifiedAt }

  return {
    _map: map,
    async ensureIntegrationRow(userId) {
      if (!map.has(String(userId))) {
        map.set(String(userId), {
          encryptedUserId: null,
          encryptedApiKey: null,
          encryptionVersion: 1,
          verifiedAt: null,
        });
      }
    },
    async findIntegrationByUserId(userId) {
      return map.get(String(userId)) ?? null;
    },
    async getHctiCredentialRecord(userId) {
      const r = map.get(String(userId));
      if (!r) return null;
      return {
        userId: String(userId),
        encryptedUserId: r.encryptedUserId,
        encryptedApiKey: r.encryptedApiKey,
        encryptionVersion: r.encryptionVersion,
        verifiedAt: r.verifiedAt,
        configured: r.encryptedUserId != null && r.encryptedApiKey != null,
      };
    },
    async hasConfiguredHctiCredentials(userId) {
      const r = map.get(String(userId));
      return !!(r && r.encryptedUserId != null && r.encryptedApiKey != null);
    },
    async upsertEncryptedHctiCredentials({ userId, encryptedUserId, encryptedApiKey, encryptionVersion = 1 }) {
      map.set(String(userId), {
        encryptedUserId,
        encryptedApiKey,
        encryptionVersion,
        verifiedAt: null, // saving new credentials always resets verification
      });
    },
    async markHctiVerified(userId, verifiedAt) {
      const r = map.get(String(userId));
      if (r) r.verifiedAt = verifiedAt;
    },
    async clearHctiVerification(userId) {
      const r = map.get(String(userId));
      if (r) r.verifiedAt = null;
    },
    async deleteHctiCredentials(userId) {
      const r = map.get(String(userId));
      if (r) {
        r.encryptedUserId = null;
        r.encryptedApiKey = null;
        r.verifiedAt = null;
      }
    },
  };
}

/** Fake `logRepository` — captures inserted rows for assertions. */
export function createFakeLogRepository() {
  const entries = [];
  return {
    _entries: entries,
    async insertLog(entry) {
      entries.push(entry);
    },
  };
}

/**
 * Fake HCTI service. `result` controls testCredentials output; captures the
 * dynamic credentials it was called with so tests can assert they were passed.
 */
export function createFakeHctiService(result = { success: true, imageId: 'img_test', message: 'ok' }) {
  const calls = [];
  return {
    _calls: calls,
    async testCredentials(args) {
      calls.push(args);
      return typeof result === 'function' ? result(args) : result;
    },
    async generateImage(args) {
      calls.push(args);
      return { imageId: 'img_test', url: 'https://example.com/img_test.png' };
    },
  };
}

/** Fake `oauthStateRepository` — in-memory with real consume-once semantics. */
export function createFakeOAuthStateRepository() {
  const rows = [];
  let nextId = 1;
  return {
    _rows: rows,
    async createOAuthState(input) {
      rows.push({
        id: String(nextId++),
        user_id: String(input.userId),
        provider: input.provider,
        state_hash: input.stateHash,
        code_verifier_encrypted: input.encryptedCodeVerifier ?? null,
        redirect_uri: input.redirectUri,
        expires_at: input.expiresAt,
        consumed_at: null,
      });
    },
    async consumeOAuthState({ stateHash, provider, expectedUserId }) {
      const row = rows.find((r) => r.state_hash === stateHash && r.provider === provider);
      const verdict = evaluateStateRow(row, { provider, expectedUserId, nowMs: Date.now() });
      if (!verdict.ok) return { ok: false, reason: verdict.reason };
      row.consumed_at = '2026-01-01 00:00:00';
      return {
        ok: true,
        state: {
          id: row.id,
          userId: row.user_id,
          provider: row.provider,
          redirectUri: row.redirect_uri,
          encryptedCodeVerifier: row.code_verifier_encrypted,
        },
      };
    },
    async deleteExpiredOAuthStates() {
      return 0;
    },
    async deleteOAuthStatesForUserAndProvider(userId, provider) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i].user_id) === String(userId) && rows[i].provider === provider) {
          rows.splice(i, 1);
        }
      }
    },
  };
}

/** Fake `socialAccountRepository` — in-memory, mirrors row shapes. */
export function createFakeSocialAccountRepository({ publishedHistory = false } = {}) {
  const rows = [];
  let nextId = 1;
  const findRow = (accountId, userId) =>
    rows.find((r) => String(r.id) === String(accountId) && String(r.user_id) === String(userId));
  return {
    _rows: rows,
    async listAccountsForUser(userId) {
      return rows.filter((r) => String(r.user_id) === String(userId)).map(sanitizeAccount);
    },
    async findAccountByIdForUser(accountId, userId) {
      return sanitizeAccount(findRow(accountId, userId) || null);
    },
    async findAccountWithEncryptedTokens(accountId, userId) {
      return findRow(accountId, userId) || null;
    },
    async findByProviderAccount({ userId, provider, accountType, providerAccountId }) {
      return sanitizeAccount(
        rows.find(
          (r) =>
            String(r.user_id) === String(userId) &&
            r.provider === provider &&
            r.account_type === accountType &&
            r.provider_account_id === String(providerAccountId),
        ) || null,
      );
    },
    async upsertSocialAccount(input) {
      const k = `${input.userId}:${input.provider}:${input.providerAccountId}`;
      let row = rows.find(
        (r) => `${r.user_id}:${r.provider}:${r.provider_account_id}` === k,
      );
      if (!row) {
        row = { id: String(nextId++), user_id: String(input.userId), created_at: '2026-01-01 00:00:00' };
        rows.push(row);
      }
      Object.assign(row, {
        provider: input.provider,
        account_type: input.accountType,
        provider_user_id: input.providerUserId ?? null,
        provider_account_id: String(input.providerAccountId),
        display_name: input.displayName ?? null,
        username: input.username ?? null,
        access_token_encrypted: input.encryptedAccessToken ?? null,
        refresh_token_encrypted: input.encryptedRefreshToken ?? null,
        token_expires_at: input.tokenExpiresAt ?? null,
        refresh_token_expires_at: input.refreshTokenExpiresAt ?? null,
        scopes_json: input.scopes ?? null,
        provider_metadata_json: input.providerMetadata ?? null,
        status: input.status ?? 'active',
        last_verified_at: input.lastVerifiedAt ?? null,
        updated_at: '2026-01-01 00:00:00',
      });
      return sanitizeAccount(row);
    },
    async updateEncryptedTokens(accountId, userId, upd) {
      const r = findRow(accountId, userId);
      if (r) {
        r.access_token_encrypted = upd.encryptedAccessToken;
        r.refresh_token_encrypted = upd.encryptedRefreshToken ?? null;
        r.token_expires_at = upd.tokenExpiresAt ?? null;
        r.refresh_token_expires_at = upd.refreshTokenExpiresAt ?? null;
        r.status = 'active';
      }
    },
    async updateVerificationStatus(accountId, userId, upd) {
      const r = findRow(accountId, userId);
      if (r) {
        if (upd.displayName != null) r.display_name = upd.displayName;
        r.last_verified_at = upd.lastVerifiedAt ?? null;
        r.status = upd.status ?? 'active';
      }
      return sanitizeAccount(r || null);
    },
    async markAccountExpired(accountId, userId) {
      const r = findRow(accountId, userId);
      if (r) r.status = 'expired';
    },
    async markAccountError(accountId, userId) {
      const r = findRow(accountId, userId);
      if (r) r.status = 'error';
    },
    async markAccountRevoked(accountId, userId, { eraseTokens = true } = {}) {
      const r = findRow(accountId, userId);
      if (r) {
        r.status = 'revoked';
        if (eraseTokens) {
          r.access_token_encrypted = null;
          r.refresh_token_encrypted = null;
          r.token_expires_at = null;
          r.refresh_token_expires_at = null;
        }
      }
    },
    async deleteAccountForUser(accountId, userId) {
      const i = rows.findIndex(
        (r) => String(r.id) === String(accountId) && String(r.user_id) === String(userId),
      );
      if (i >= 0) {
        rows.splice(i, 1);
        return true;
      }
      return false;
    },
    async findThreadsAccountsByProviderUserId(providerUserId) {
      return rows
        .filter(
          (r) =>
            r.provider === 'threads' &&
            (String(r.provider_user_id) === String(providerUserId) ||
              String(r.provider_account_id) === String(providerUserId)),
        )
        .map(sanitizeAccount);
    },
    async hasPublishedHistory() {
      return publishedHistory;
    },
  };
}

/** Build a fake provider with configurable behaviors. */
export function createFakeProvider(key, options = {}) {
  const {
    available = true,
    redirectUri = `https://cyflow.cyfrow.net/api/oauth/${key}/callback`,
    accounts,
    exchange,
    discover,
    verify,
    refresh,
  } = options;

  const defaultAccounts =
    accounts ||
    (key === 'meta'
      ? [makeDescriptor(key, 'facebook_page', 'page_1'), makeDescriptor(key, 'facebook_page', 'page_2')]
      : key === 'instagram'
        ? [makeDescriptor(key, 'instagram_professional', 'ig_1')]
        : [makeDescriptor(key, 'threads_profile', 'th_1')]);

  return {
    providerConfig: { available, redirectUri, appId: `${key}-app-id`, graphVersion: 'v1' },
    isConfigured: () => available,
    getAuthorizationUrl: ({ state }) => `https://provider.example/${key}/authorize?state=${state}`,
    exchangeAuthorizationCode:
      exchange || (async () => ({ accessToken: `tok-${key}`, userAccessToken: `tok-${key}`, expiresIn: 3600 })),
    discoverAccounts: discover || (async () => defaultAccounts),
    verifyAccount:
      verify ||
      (async ({ account }) => ({ providerAccountId: account.providerAccountId, displayName: 'Verified Name' })),
    refreshAccountToken: refresh || (async () => ({ reconnectRequired: true })),
    normalizeProviderError: (e) => (e instanceof OAuthError ? e : new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE)),
  };
}

function makeDescriptor(provider, accountType, id) {
  return {
    provider,
    accountType,
    providerUserId: `${provider}-user`,
    providerAccountId: id,
    displayName: `${provider} ${id}`,
    username: `${provider}_${id}`,
    accessToken: `PLAINTEXT-token-${provider}-${id}`,
    refreshToken: null,
    tokenExpiresAt: null,
    expiresIn: 3600,
    scopes: [`${provider}_scope`],
    providerMetadata: { note: 'safe' },
  };
}

/** Fake provider registry over a map of fake providers. */
export function createFakeProviderRegistry(providers) {
  const map = providers || {
    meta: createFakeProvider('meta'),
    instagram: createFakeProvider('instagram'),
    threads: createFakeProvider('threads'),
  };
  return {
    _providers: map,
    isValidProvider: (k) => ['meta', 'instagram', 'threads'].includes(k) && Boolean(map[k]),
    get(k) {
      if (!map[k]) throw new OAuthError(OAUTH_ERROR_CODES.PROVIDER_CONFIGURATION_ERROR, 'Unknown provider');
      return map[k];
    },
    availability: () => ({
      meta: map.meta ? map.meta.isConfigured() : false,
      instagram: map.instagram ? map.instagram.isConfigured() : false,
      threads: map.threads ? map.threads.isConfigured() : false,
    }),
  };
}

/** Fake `dataDeletionRepository` — in-memory. */
export function createFakeDataDeletionRepository() {
  const rows = [];
  return {
    _rows: rows,
    async createDeletionRequest(input) {
      rows.push({
        confirmation_code: input.confirmationCode,
        provider: input.provider,
        provider_user_id: input.providerUserId ?? null,
        status: input.status ?? 'received',
        accounts_removed: input.accountsRemoved ?? 0,
        created_at: '2026-01-01 00:00:00',
      });
    },
    async findByConfirmationCode(code) {
      const r = rows.find((x) => x.confirmation_code === code);
      if (!r) return null;
      return { confirmationCode: r.confirmation_code, provider: r.provider, status: r.status, createdAt: r.created_at };
    },
  };
}

/** Fake `apiUsageRepository`. `forcedCount` overrides countUserOperationsSince. */
export function createFakeApiUsageRepository({ forcedCount = null } = {}) {
  const rows = [];
  return {
    _rows: rows,
    async recordUsage(input) {
      rows.push({ ...input, created_at: '2026-01-01 00:00:00' });
    },
    async countUserOperationsSince(userId, since, opts = {}) {
      if (forcedCount != null) return forcedCount;
      const ops = Array.isArray(opts.operations) ? opts.operations : null;
      return rows.filter(
        (r) => String(r.userId) === String(userId) && (!ops || ops.includes(r.operation)),
      ).length;
    },
    async summarizeUserUsage() {
      return [];
    },
  };
}

/** Default fake OpenAI content result for the requested platforms. */
function defaultContentResult(platforms) {
  const result = {
    visual: { headline: 'Great Headline', subheadline: 'A concise subheadline', imageAltText: 'Alt text' },
    _meta: { model: 'test-model', responseId: 'resp_test', usage: { inputUnits: 12, outputUnits: 34 } },
  };
  for (const p of platforms || []) {
    result[p] = { caption: `Caption for ${p}`, hashtags: ['#cyflow', '#social'] };
  }
  return result;
}

/** Fake OpenAI content service. */
export function createFakeOpenAIContentService(opts = {}) {
  const calls = [];
  const available = opts.available !== false;
  return {
    _calls: calls,
    isAvailable: () => available,
    async generateSocialContent(input, ctx) {
      calls.push({ input, ctx });
      if (opts.error) throw opts.error;
      return opts.result ? opts.result(input) : defaultContentResult(input.targetPlatforms);
    },
  };
}

/** Fake social image service. */
export function createFakeSocialImageService(opts = {}) {
  const calls = [];
  return {
    _calls: calls,
    async generateSocialImage(input, ctx) {
      calls.push({ input, ctx });
      if (opts.error) throw opts.error;
      return {
        imageId: 'hcti_img_1',
        sourceUrl: 'https://hcti.io/v1/image/hcti_img_1.png',
        width: 1080,
        height: 1080,
        template: input.template,
        aspectRatio: input.aspectRatio,
        backgroundStyle: input.backgroundStyle,
      };
    },
    dimensionsFor: () => ({ width: 1080, height: 1080 }),
  };
}

/** Fake `mediaAssetRepository`. */
export function createFakeMediaAssetRepository() {
  const rows = [];
  let nextId = 1;
  const find = (id, userId) =>
    rows.find((r) => String(r.id) === String(id) && String(r.user_id) === String(userId));
  function toApi(r) {
    if (!r) return null;
    return {
      id: String(r.id),
      userId: String(r.user_id),
      scheduledPostId: r.scheduled_post_id == null ? null : String(r.scheduled_post_id),
      publicToken: r.public_token,
      sourceProvider: r.source_provider,
      sourceUrl: r.source_url ?? null,
      sourceAssetId: r.source_asset_id ?? null,
      mimeType: r.mime_type ?? null,
      fileExtension: r.file_extension ?? null,
      status: r.status,
      expiresAt: r.expires_at ?? null,
      createdAt: r.created_at ?? null,
      updatedAt: r.updated_at ?? null,
    };
  }
  return {
    _rows: rows,
    async createMediaAsset(input) {
      const row = {
        id: String(nextId++),
        user_id: String(input.userId),
        scheduled_post_id: input.scheduledPostId ?? null,
        public_token: input.publicToken,
        source_provider: input.sourceProvider ?? 'hcti',
        source_url: input.sourceUrl ?? null,
        source_asset_id: input.sourceAssetId ?? null,
        mime_type: input.mimeType ?? null,
        file_extension: input.fileExtension ?? null,
        status: input.status ?? 'pending',
        expires_at: input.expiresAt ?? null,
        created_at: '2026-01-01 00:00:00',
      };
      rows.push(row);
      return toApi(row);
    },
    async findMediaAssetByIdForUser(id, userId) {
      return toApi(find(id, userId));
    },
    async findReadyMediaAssetByPublicToken(token) {
      const r = rows.find((x) => x.public_token === token && x.status === 'ready');
      if (!r) return null;
      if (r.expires_at && new Date(String(r.expires_at).replace(' ', 'T') + 'Z') <= new Date()) return null;
      return toApi(r);
    },
    async markMediaAssetReady(id, userId, upd) {
      const r = find(id, userId);
      if (r) {
        r.status = 'ready';
        if (upd.mimeType) r.mime_type = upd.mimeType;
        if (upd.sourceUrl) r.source_url = upd.sourceUrl;
      }
      return toApi(r);
    },
    async markMediaAssetFailed(id, userId) {
      const r = find(id, userId);
      if (r) r.status = 'failed';
    },
    async associateAssetWithPost(id, userId, postId) {
      const r = find(id, userId);
      if (r) r.scheduled_post_id = postId;
    },
    async deleteUnusedMediaAsset(id, userId) {
      const i = rows.findIndex((r) => String(r.id) === String(id) && String(r.user_id) === String(userId) && r.scheduled_post_id == null);
      if (i >= 0) { rows.splice(i, 1); return true; }
      return false;
    },
  };
}

/** Fake `postRepository`. `socialAccounts` resolves target account info. */
export function createFakePostRepository({ socialAccounts } = {}) {
  const posts = [];
  const targets = [];
  let nextPostId = 1;
  let nextTargetId = 1;
  const findRow = (id, userId) =>
    posts.find((p) => String(p.id) === String(id) && String(p.user_id) === String(userId));

  return {
    _posts: posts,
    _targets: targets,
    async createDraftPost(input) {
      const row = {
        id: String(nextPostId++),
        user_id: String(input.userId),
        title: input.title ?? null,
        prompt: input.prompt ?? null,
        status: 'draft',
        scheduled_at_utc: null,
        original_timezone: null,
        generation_params_json: input.generationParams ?? null,
        generated_platform_captions_json: null,
        generated_base_caption: null,
        generated_image_headline: null,
        generated_image_subheadline: null,
        generated_image_alt_text: null,
        template_name: input.templateName ?? null,
        aspect_ratio: input.aspectRatio ?? null,
        background_style: input.backgroundStyle ?? null,
        media_asset_id: null,
        openai_model: null,
        content_generated_at: null,
        image_generated_at: null,
        created_at: '2026-01-01 00:00:00',
        updated_at: '2026-01-01 00:00:00',
      };
      posts.push(row);
      return sanitizePost(row);
    },
    async findPostByIdForUser(postId, userId) {
      return sanitizePost(findRow(postId, userId) || null);
    },
    async listPostsForUser(userId, { limit = 25, offset = 0, status = null } = {}) {
      let list = posts.filter((p) => String(p.user_id) === String(userId));
      if (status) list = list.filter((p) => p.status === status);
      list = list.slice().reverse().slice(offset, offset + limit);
      return list.map(sanitizePost);
    },
    async updateDraftPost(postId, userId, fields) {
      const r = findRow(postId, userId);
      if (!r) return null;
      if (fields.title !== undefined) r.title = fields.title;
      if (fields.prompt !== undefined) r.prompt = fields.prompt;
      if (fields.templateName !== undefined) r.template_name = fields.templateName;
      if (fields.aspectRatio !== undefined) r.aspect_ratio = fields.aspectRatio;
      if (fields.backgroundStyle !== undefined) r.background_style = fields.backgroundStyle;
      if (fields.generationParams !== undefined) r.generation_params_json = fields.generationParams;
      return sanitizePost(r);
    },
    async updateGeneratedContent(postId, userId, content) {
      const r = findRow(postId, userId);
      if (!r) return null;
      r.generated_platform_captions_json = content.platformCaptions ?? null;
      r.generated_base_caption = content.baseCaption ?? null;
      r.generated_image_headline = content.headline ?? null;
      r.generated_image_subheadline = content.subheadline ?? null;
      r.generated_image_alt_text = content.altText ?? null;
      r.openai_model = content.openaiModel ?? null;
      r.content_generated_at = content.contentGeneratedAt ?? null;
      return sanitizePost(r);
    },
    async attachMediaAsset(postId, userId, info) {
      const r = findRow(postId, userId);
      if (!r) return null;
      r.media_asset_id = info.mediaAssetId;
      if (info.template) r.template_name = info.template;
      if (info.aspectRatio) r.aspect_ratio = info.aspectRatio;
      if (info.backgroundStyle) r.background_style = info.backgroundStyle;
      r.image_generated_at = info.imageGeneratedAt ?? null;
      return sanitizePost(r);
    },
    async replacePostTargets(postId, userId, list) {
      if (!findRow(postId, userId)) return [];
      for (let i = targets.length - 1; i >= 0; i--) {
        if (String(targets[i].scheduled_post_id) === String(postId) && targets[i].status !== 'published') {
          targets.splice(i, 1);
        }
      }
      for (const t of list) {
        targets.push({
          id: String(nextTargetId++),
          scheduled_post_id: String(postId),
          social_account_id: String(t.socialAccountId),
          caption_override: t.captionOverride ?? null,
          status: 'pending',
          attempt_count: 0,
        });
      }
      return this.listPostTargets(postId, userId);
    },
    async listPostTargets(postId, userId) {
      const post = findRow(postId, userId);
      if (!post) return [];
      const out = [];
      for (const t of targets.filter((x) => String(x.scheduled_post_id) === String(postId))) {
        // eslint-disable-next-line no-await-in-loop
        const acc = socialAccounts ? await socialAccounts.findAccountByIdForUser(t.social_account_id, userId) : null;
        out.push({
          id: t.id,
          socialAccountId: t.social_account_id,
          provider: acc ? acc.provider : null,
          accountType: acc ? acc.accountType : null,
          displayName: acc ? acc.displayName : null,
          username: acc ? acc.username : null,
          accountStatus: acc ? acc.status : 'revoked',
          captionOverride: t.caption_override,
          status: t.status,
          attemptCount: t.attempt_count,
        });
      }
      return out;
    },
    async schedulePost(postId, userId, { scheduledAtUtc, originalTimezone }) {
      const r = findRow(postId, userId);
      if (!r) return null;
      r.status = 'queued';
      r.scheduled_at_utc = scheduledAtUtc;
      r.original_timezone = originalTimezone;
      targets
        .filter((t) => String(t.scheduled_post_id) === String(postId) && t.status !== 'published')
        .forEach((t) => { t.status = 'pending'; });
      return sanitizePost(r);
    },
    async cancelScheduledPost(postId, userId) {
      const r = findRow(postId, userId);
      if (!r) return null;
      r.status = 'cancelled';
      targets
        .filter((t) => String(t.scheduled_post_id) === String(postId) && t.status !== 'published')
        .forEach((t) => { t.status = 'cancelled'; });
      return sanitizePost(r);
    },
    async hasPublishedTargets(postId, userId) {
      if (!findRow(postId, userId)) return false;
      return targets.some((t) => String(t.scheduled_post_id) === String(postId) && t.status === 'published');
    },
    async deleteDraftPost(postId, userId) {
      if (await this.hasPublishedTargets(postId, userId)) return { deleted: false, reason: 'has_history' };
      const i = posts.findIndex((p) => String(p.id) === String(postId) && String(p.user_id) === String(userId));
      if (i < 0) return { deleted: false };
      posts.splice(i, 1);
      for (let j = targets.length - 1; j >= 0; j--) {
        if (String(targets[j].scheduled_post_id) === String(postId)) targets.splice(j, 1);
      }
      return { deleted: true };
    },
  };
}

/** Fake transaction runner: invokes the callback with a marker connection. */
export async function fakeWithTransaction(callback) {
  return callback({ _fakeConnection: true });
}

/** Build a full override bundle for createApp/buildContainer. */
export function createFakeOverrides(extra = {}) {
  const socialAccountRepository = extra.socialAccountRepository ?? createFakeSocialAccountRepository();
  const mediaAssetRepository = extra.mediaAssetRepository ?? createFakeMediaAssetRepository();
  const postRepository =
    extra.postRepository ?? createFakePostRepository({ socialAccounts: socialAccountRepository });
  const apiUsageRepository = extra.apiUsageRepository ?? createFakeApiUsageRepository();
  const mediaAssetService =
    extra.mediaAssetService ?? createMediaAssetService({ mediaRepository: mediaAssetRepository });
  const openaiContentService = extra.openaiContentService ?? createFakeOpenAIContentService();
  const socialImageService = extra.socialImageService ?? createFakeSocialImageService();

  return {
    userRepository: createFakeUserRepository(),
    integrationRepository: createFakeIntegrationRepository(),
    logRepository: createFakeLogRepository(),
    hctiService: createFakeHctiService(),
    oauthStateRepository: createFakeOAuthStateRepository(),
    providerRegistry: createFakeProviderRegistry(),
    dataDeletionRepository: createFakeDataDeletionRepository(),
    withTransaction: fakeWithTransaction,
    ...extra,
    // These are wired together (postRepository resolves accounts via the same
    // socialAccountRepository), so set them AFTER the spread.
    socialAccountRepository,
    mediaAssetRepository,
    postRepository,
    apiUsageRepository,
    mediaAssetService,
    openaiContentService,
    socialImageService,
  };
}

export default {
  createFakeUserRepository,
  createFakeIntegrationRepository,
  createFakeLogRepository,
  createFakeHctiService,
  fakeWithTransaction,
  createFakeOverrides,
};
