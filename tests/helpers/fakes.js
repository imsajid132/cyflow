/**
 * In-memory test doubles implementing the SAME interfaces as the production
 * repositories/services. Production code is never modified — the container/app
 * accepts these as `overrides` for hermetic tests (no DB, no network).
 */

import { sanitizeUser } from '../../src/repositories/userRepository.js';
import { sanitizeAccount } from '../../src/repositories/socialAccountRepository.js';
import { sanitizePost } from '../../src/repositories/postRepository.js';
import { evaluateStateRow } from '../../src/repositories/oauthStateRepository.js';
import { PLANNER_ITEM_STATUS } from '../../src/config/constants.js';
import { normalizeEmail } from '../../src/utils/validation.js';
import { OAuthError, OAUTH_ERROR_CODES } from '../../src/utils/oauthErrors.js';
import { createMediaAssetService } from '../../src/services/mediaAssetService.js';
import { applyStyleGuard } from '../../src/services/contentStyleGuard.js';

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

    // --- OpenAI ---
    //
    // Distinct field names on the same row, mirroring the real table: one
    // integration row per user carrying both credentials, so removing one
    // provably leaves the other alone.
    async getOpenAiCredentialRecord(userId) {
      const r = map.get(String(userId));
      if (!r) return null;
      return {
        encryptedApiKey: r.openaiEncryptedApiKey ?? null,
        encryptionVersion: r.openaiEncryptionVersion ?? 1,
        model: r.openaiModel ?? null,
        verifiedAt: r.openaiVerifiedAt ?? null,
        configured: r.openaiEncryptedApiKey != null,
      };
    },
    async hasConfiguredOpenAiCredentials(userId) {
      return map.get(String(userId))?.openaiEncryptedApiKey != null;
    },
    async upsertEncryptedOpenAiCredentials({ userId, encryptedApiKey, model = null, encryptionVersion = 1 }) {
      const r = map.get(String(userId)) ?? {};
      map.set(String(userId), {
        ...r,
        openaiEncryptedApiKey: encryptedApiKey,
        openaiEncryptionVersion: encryptionVersion,
        openaiModel: model,
        // Saving or replacing ALWAYS resets verification, exactly as the real
        // repository's ON DUPLICATE KEY UPDATE does. A new key is unproven.
        openaiVerifiedAt: null,
      });
    },
    async markOpenAiVerified(userId, verifiedAt) {
      const r = map.get(String(userId));
      if (r) r.openaiVerifiedAt = verifiedAt;
    },
    async clearOpenAiVerification(userId) {
      const r = map.get(String(userId));
      if (r) r.openaiVerifiedAt = null;
    },
    async updateOpenAiModel(userId, model) {
      const r = map.get(String(userId));
      if (r) r.openaiModel = model;
    },
    async deleteOpenAiCredentials(userId) {
      const r = map.get(String(userId));
      if (r) {
        r.openaiEncryptedApiKey = null;
        r.openaiModel = null;
        r.openaiEncryptionVersion = 1;
        r.openaiVerifiedAt = null;
      }
    },
  };
}

/**
 * Fake `openAiVerifier`.
 *
 * Answers whether a key "works" without a network call. Records the userId it
 * was asked about, so a test can prove the verification was scoped to the right
 * customer rather than to whoever happened to be cached.
 */
export function createFakeOpenAiVerifier(opts = {}) {
  const calls = [];
  return {
    _calls: calls,
    async verify({ userId }) {
      calls.push({ userId });
      if (opts.success === false) {
        return {
          success: false,
          classification: opts.classification ?? 'auth',
          message: opts.message ?? 'That key was rejected by OpenAI. Check it and try again.',
        };
      }
      return { success: true, classification: null, message: 'Your OpenAI API key works.' };
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

/** Fake `businessProfileRepository` — one profile per user, in-memory. */
export function createFakeBusinessProfileRepository() {
  const rows = new Map(); // userId -> profile (sanitized shape + diagnostics)
  let nextId = 1;

  function base(userId) {
    return {
      id: String(nextId++),
      userId: String(userId),
      businessName: null,
      websiteUrl: null,
      businessCategory: null,
      businessDescription: null,
      phone: null,
      email: null,
      address: null,
      city: null,
      region: null,
      postalCode: null,
      country: null,
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      headingFont: null,
      bodyFont: null,
      logoUrl: null,
      logoMediaAssetId: null,
      faviconUrl: null,
      defaultLanguage: null,
      defaultTone: null,
      defaultCallToAction: null,
      services: [],
      locations: [],
      socialLinks: [],
      sourceType: 'manual',
      onboardingStatus: 'not_started',
      onboardingCompletedAt: null,
      manualFields: [],
      extractedMetadata: {},
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    };
  }

  const api = {
    _rows: rows,
    async findByUserId(userId, options = {}) {
      const row = rows.get(String(userId));
      if (!row) return null;
      const copy = { ...row };
      if (!options.includeDiagnostics) {
        delete copy.extractedMetadata;
        delete copy.manualFields;
      }
      return copy;
    },
    async findRawByUserId(userId) {
      return rows.get(String(userId)) ?? null;
    },
    async createOrUpdateProfile(userId, data) {
      const key = String(userId);
      const next = { ...(rows.get(key) || base(userId)) };
      for (const [k, v] of Object.entries(data)) next[k] = v;
      rows.set(key, next);
      return api.findByUserId(userId);
    },
    async updateBrandDetails(userId, data) {
      return api.createOrUpdateProfile(userId, data);
    },
    async updateContactDetails(userId, data) {
      return api.createOrUpdateProfile(userId, data);
    },
    async updateServices(userId, services) {
      return api.createOrUpdateProfile(userId, { services });
    },
    async updateOnboardingStatus(userId, status) {
      return api.createOrUpdateProfile(userId, { onboardingStatus: status });
    },
    async markOnboardingComplete(userId, completedAt) {
      return api.createOrUpdateProfile(userId, {
        onboardingStatus: 'completed',
        onboardingCompletedAt: completedAt,
      });
    },
    async deleteBusinessProfile(userId) {
      return rows.delete(String(userId));
    },
  };
  return api;
}

/** Fake website analysis service (never touches the network). */
export function createFakeWebsiteAnalysisService(opts = {}) {
  const calls = [];
  return {
    _calls: calls,
    async analyzeWebsite(input) {
      calls.push(input);
      if (opts.error) throw opts.error;
      return (
        opts.result || {
          sourceUrl: 'https://example.com/',
          warnings: [],
          pagesAnalyzed: [{ kind: 'home', url: 'https://example.com/' }],
          suggestions: {
            businessName: 'Acme Ltd',
            businessCategory: '',
            businessDescription: 'We do things.',
            phone: '+1 555 0100',
            email: 'hi@example.com',
            address: '1 Main St',
            city: 'Springfield',
            region: '',
            postalCode: '',
            country: '',
            websiteUrl: 'https://example.com',
            primaryColor: '#1a73e8',
            secondaryColor: '#e8710a',
            accentColor: '',
            colorCandidates: ['#1a73e8', '#e8710a'],
            headingFont: 'Inter',
            bodyFont: 'Inter',
            logoUrl: 'https://example.com/logo.png',
            logoValidated: true,
            faviconUrl: 'https://example.com/favicon.ico',
            services: ['Roof Repair', 'Gutter Cleaning'],
            locations: ['Springfield'],
            socialLinks: [{ platform: 'facebook.com', url: 'https://facebook.com/acme' }],
            defaultTone: '',
          },
        }
      );
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
    businessProfileRepository: extra.businessProfileRepository ?? createFakeBusinessProfileRepository(),
    websiteAnalysisService: extra.websiteAnalysisService ?? createFakeWebsiteAnalysisService(),
    plannerPreferenceRepository: extra.plannerPreferenceRepository ?? createFakePlannerPreferenceRepository(),
    plannerRunRepository: extra.plannerRunRepository ?? createFakePlannerRunRepository(),
    plannerRevisionRepository: extra.plannerRevisionRepository ?? createFakePlannerRevisionRepository(),
  };
}

/**
 * Fake `plannerRevisionRepository` — in-memory, same idempotency rule as the
 * real one: an identical immediate repeat for an item+platform writes nothing.
 */
export function createFakePlannerRevisionRepository() {
  const rows = [];
  let nextId = 1;
  const hashOf = (postCopy, hashtags) => JSON.stringify({
    copy: typeof postCopy === 'string' ? postCopy : '',
    tags: Array.isArray(hashtags) ? hashtags : [],
  });
  return {
    _rows: rows,
    async recordRevision(input) {
      const {
        userId, plannerRunItemId, scheduledPostId = null, platform,
        revisionType, postCopy = null, hashtags = [], validationStatus = null,
      } = input;
      const contentHash = hashOf(postCopy, hashtags);
      const latest = [...rows]
        .filter((r) => String(r.planner_run_item_id) === String(plannerRunItemId)
          && String(r.user_id) === String(userId) && r.platform === platform)
        .sort((a, b) => b.id - a.id)[0];
      // Same content AND same type: a repeat of the same operation. Suppress.
      if (latest && latest.content_hash === contentHash && latest.revision_type === revisionType) {
        return { created: false, revision: null };
      }
      const row = {
        id: nextId, user_id: String(userId), planner_run_item_id: String(plannerRunItemId),
        scheduled_post_id: scheduledPostId == null ? null : String(scheduledPostId),
        platform, revision_type: revisionType, post_copy: postCopy,
        hashtags: Array.isArray(hashtags) ? hashtags : [], validation_status: validationStatus,
        content_hash: contentHash, created_at: `2026-01-01 00:00:0${nextId % 10}`,
      };
      nextId += 1;
      rows.push(row);
      return {
        created: true,
        revision: {
          id: String(row.id), plannerRunItemId: row.planner_run_item_id, scheduledPostId: row.scheduled_post_id,
          platform, revisionType, postCopy, hashtags: row.hashtags, validationStatus, createdAt: row.created_at,
        },
      };
    },
    async listRevisionsForItem(plannerRunItemId, userId, { limit = 50 } = {}) {
      return rows
        .filter((r) => String(r.planner_run_item_id) === String(plannerRunItemId) && String(r.user_id) === String(userId))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
        .map((r) => ({
          id: String(r.id), plannerRunItemId: r.planner_run_item_id, scheduledPostId: r.scheduled_post_id,
          platform: r.platform, revisionType: r.revision_type, postCopy: r.post_copy,
          hashtags: r.hashtags, validationStatus: r.validation_status, createdAt: r.created_at,
        }));
    },
  };
}

// --- Phase 4.7: auto content planner ----------------------------------------

/** Fake `plannerPreferenceRepository` — one row per user, in-memory. */
export function createFakePlannerPreferenceRepository() {
  const rows = new Map(); // userId -> preferences
  let nextId = 1;

  const api = {
    _rows: rows,
    async findByUserId(userId) {
      const row = rows.get(String(userId));
      return row ? { ...row } : null;
    },
    async upsertPreferences(userId, data) {
      const key = String(userId);
      const base = rows.get(key) || {
        id: String(nextId++),
        userId: key,
        cadence: 'every_day',
        weekdays: [],
        times: [],
        platforms: [],
        goals: [],
        contentMix: {},
        contentRhythmPreset: 'balanced',
        contentRhythm: null,
        tone: 'professional',
        ctaMode: 'some',
        approvalMode: 'require_approval',
        defaultPlanLength: 7,
        timezone: null,
        autopilotEnabled: false,
        nextPlanGenerationAt: null,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      };
      const next = { ...base };
      for (const [k, v] of Object.entries(data)) next[k] = v;
      rows.set(key, next);
      return { ...next };
    },
    async listDueAutopilot(nowUtc) {
      return [...rows.values()]
        .filter((r) => r.autopilotEnabled && r.nextPlanGenerationAt && r.nextPlanGenerationAt <= nowUtc)
        .map((r) => ({ ...r }));
    },
    async deletePreferences(userId) {
      return { deleted: rows.delete(String(userId)) };
    },
  };
  return api;
}

/** Fake `plannerRunRepository` — runs + items, in-memory, user-scoped. */
export function createFakePlannerRunRepository() {
  const runs = new Map(); // id -> run
  const items = new Map(); // id -> item
  let nextRunId = 1;
  let nextItemId = 1;

  const api = {
    _runs: runs,
    _items: items,

    async createRun(input) {
      const id = String(nextRunId++);
      const run = {
        id,
        userId: String(input.userId),
        businessProfileId: input.businessProfileId ?? null,
        name: input.name ?? null,
        status: input.status ?? 'generating',
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        timezone: input.timezone ?? null,
        planLength: input.planLength ?? 7,
        postsPerDay: input.postsPerDay ?? 1,
        settings: input.settings ?? {},
        resolvedRhythm: input.resolvedRhythm ?? null,
        qualityStatus: input.qualityStatus ?? null,
        qualityFailures: input.qualityFailures ?? null,
        generationNotes: input.generationNotes ?? null,
        archivedAt: null,
        createdAt: '2026-07-13 06:00:00',
        updatedAt: '2026-07-13 06:00:00',
      };
      runs.set(id, run);
      return { ...run };
    },
    async findRunByIdForUser(runId, userId) {
      const run = runs.get(String(runId));
      // Ownership is enforced here exactly as the SQL WHERE clause does.
      if (!run || run.userId !== String(userId)) return null;
      return { ...run };
    },
    async listRunsForUser(userId, { limit = 20, offset = 0 } = {}) {
      return [...runs.values()]
        .filter((r) => r.userId === String(userId))
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(offset, offset + limit)
        .map((r) => ({ ...r }));
    },
    async updateRun(runId, userId, fields) {
      const run = runs.get(String(runId));
      if (!run || run.userId !== String(userId)) return null;
      Object.assign(run, fields);
      return { ...run };
    },
    async deleteRun(runId, userId) {
      const run = runs.get(String(runId));
      if (!run || run.userId !== String(userId)) return { deleted: false };
      runs.delete(String(runId));
      // Items cascade, mirroring the FK.
      for (const [id, item] of items) if (item.plannerRunId === String(runId)) items.delete(id);
      return { deleted: true };
    },

    async createItem(input) {
      const id = String(nextItemId++);
      const item = {
        id,
        plannerRunId: String(input.plannerRunId),
        userId: String(input.userId),
        postId: input.postId ?? null,
        position: input.position ?? 0,
        scheduledFor: input.scheduledFor ?? null,
        originalTimezone: input.originalTimezone ?? null,
        contentType: input.contentType ?? 'educational',
        contentPillar: input.contentPillar ?? null,
        contentFormat: input.contentFormat ?? null,
        audienceProblem: input.audienceProblem ?? null,
        topicAngle: input.topicAngle ?? null,
        ctaStrategy: input.ctaStrategy ?? null,
        visualFamily: input.visualFamily ?? null,
        qualityStatus: input.qualityStatus ?? null,
        qualityFailures: input.qualityFailures ?? null,
        goal: input.goal ?? null,
        platformTargets: input.platformTargets ?? [],
        templateKey: input.templateKey ?? null,
        aspectRatio: input.aspectRatio ?? null,
        backgroundStyle: input.backgroundStyle ?? null,
        headline: input.headline ?? null,
        subheadline: input.subheadline ?? null,
        summary: input.summary ?? null,
        caption: input.caption ?? null,
        hashtags: input.hashtags ?? [],
        // Mirrors platform_captions_json: NULL means "no per-platform variants",
        // which the reader resolves by falling back to `caption`.
        platformCaptions: input.platformCaptions ?? null,
        altText: input.altText ?? null,
        brief: input.brief ?? null,
        mediaAssetId: input.mediaAssetId ?? null,
        approvalStatus: input.approvalStatus ?? 'needs_review',
        duplicationScore: Number(input.duplicationScore ?? 0),
        duplicationNotes: input.duplicationNotes ?? null,
        regenerationCount: Number(input.regenerationCount ?? 0),
        fingerprint: input.fingerprint ?? null,
        editedFields: input.editedFields ?? [],
        createdAt: '2026-07-13 06:00:00',
        updatedAt: '2026-07-13 06:00:00',
      };
      items.set(id, item);
      return { ...item };
    },
    async findItemByIdForUser(itemId, userId) {
      const item = items.get(String(itemId));
      if (!item || item.userId !== String(userId)) return null;
      return { ...item };
    },
    async listItemsForRun(runId, userId) {
      return [...items.values()]
        .filter((i) => i.plannerRunId === String(runId) && i.userId === String(userId))
        .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id))
        .map((i) => ({ ...i }));
    },
    async updateItem(itemId, userId, fields) {
      const item = items.get(String(itemId));
      if (!item || item.userId !== String(userId)) return null;
      Object.assign(item, fields);
      return { ...item };
    },
    async deleteItem(itemId, userId) {
      const item = items.get(String(itemId));
      if (!item || item.userId !== String(userId)) return { deleted: false };
      items.delete(String(itemId));
      return { deleted: true };
    },
    async listRecentFingerprintsForUser(userId, { limit = 60, sinceUtc = null, excludeRunId = null, excludeItemId = null } = {}) {
      return [...items.values()]
        .filter((i) => i.userId === String(userId) && i.fingerprint)
        .filter((i) => (excludeRunId ? i.plannerRunId !== String(excludeRunId) : true))
        // Mirrors the real repository's `AND id <> ?`: a regeneration is never
        // compared against the row it is replacing.
        .filter((i) => (excludeItemId ? String(i.id) !== String(excludeItemId) : true))
        // The real repository applies `AND created_at >= ?`. The fake ignored
        // sinceUtc entirely, so its duplication lookback was unbounded in time
        // and a test could never catch a broken cutoff.
        .filter((i) => (sinceUtc ? String(i.createdAt ?? '') >= String(sinceUtc) : true))
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, limit)
        .map((i) => ({ id: i.id, plannerRunId: i.plannerRunId, ...i.fingerprint }));
    },
    async countItemsByStatus(runId, userId) {
      /*
       * Zero-fill from the SAME constant the real repository uses, rather than
       * a hand-written key list. The literal here fell behind when
       * `generation_failed` was added, so the fake returned `undefined` where
       * MySQL returns 0 — a test could pass against one and fail against the
       * other, which is the whole point of a fake being faithful.
       */
      const counts = {};
      for (const status of Object.values(PLANNER_ITEM_STATUS)) counts[status] = 0;
      for (const item of items.values()) {
        if (item.plannerRunId !== String(runId) || item.userId !== String(userId)) continue;
        counts[item.approvalStatus] = (counts[item.approvalStatus] || 0) + 1;
      }
      return counts;
    },
  };
  return api;
}

/*
 * Genuinely different posts, the way a competent writer would produce them:
 * different vocabulary, different openings, different angles. A templated fake
 * ("post number 1 about X", "post number 2 about X") would be flagged by
 * contentUniquenessService for the entirely correct reason that such captions
 * ARE near-duplicates — which would make these tests assert the wrong thing.
 */
const FAKE_POSTS = [
  {
    headline: 'Winter is coming for your gutters',
    caption: 'Leaves pile up faster than most people expect. A ten minute clear-out now saves a soaked ceiling in January.',
    hashtags: ['#gutters', '#autumn'],
  },
  {
    headline: 'Eleven years on the tools',
    caption: 'Dan has been fitting lead flashing since he was nineteen. Ask him about chimneys and you will not get away quickly.',
    hashtags: ['#team', '#craft'],
  },
  {
    headline: 'What a slipped tile really costs',
    caption: 'One loose tile lets water track along the batten. By the time it shows inside, the timber has been wet for months.',
    hashtags: ['#maintenance'],
  },
  {
    headline: 'Booking is open for spring',
    caption: 'Our diary for March has just opened up. Early slots tend to go to whoever calls first, so do not sit on it.',
    hashtags: ['#booking'],
  },
  {
    headline: 'Three signs you need a survey',
    caption: 'Damp patches near a chimney breast, grit in the guttering, daylight in the loft. Any one of those is worth a look.',
    hashtags: ['#survey', '#advice'],
  },
  {
    headline: 'Flat roofs are not all equal',
    caption: 'Felt, fibreglass and single ply all behave differently once the frost arrives. The right choice depends on the deck.',
    hashtags: ['#flatroof'],
  },
  {
    headline: 'We work across Greater London',
    caption: 'From Barnet down to Croydon, most of our jobs come from a neighbour pointing over a fence. That suits us fine.',
    hashtags: ['#london', '#local'],
  },
  {
    headline: 'Scaffolding, and why it matters',
    caption: 'A ladder is fine for a look. It is not fine for a day of work. Proper access is how the job gets done safely.',
    hashtags: ['#safety'],
  },
  {
    headline: 'The quote is the easy part',
    caption: 'Anyone can put a number on paper. Ask what happens if the timber underneath turns out to be rotten.',
    hashtags: ['#quotes'],
  },
  {
    headline: 'Moss is a symptom, not a cause',
    caption: 'Scrubbing it off makes the roof look better for a season. Working out why it thrives there lasts a lot longer.',
    hashtags: ['#moss'],
  },
  {
    headline: 'Storm damage: what to do first',
    caption: 'Photograph everything from ground level, ring your insurer, and stay off the roof until someone has looked properly.',
    hashtags: ['#storm'],
  },
  {
    headline: 'Small jobs are still jobs',
    caption: 'A single ridge tile is not too small to call about. Most of our big repairs started as somebody ignoring one.',
    hashtags: ['#repairs'],
  },
];

/**
 * Fake planner-post generator. Produces genuinely DISTINCT content per call by
 * default; pass `{ duplicate: true }` to force identical output and exercise
 * the duplication engine.
 */
export function createFakePlannerOpenAI(opts = {}) {
  const calls = [];
  let n = 0;
  // Scripted mode advances only on a PRIMARY call, so platform-variant calls do
  // not consume the script.
  let scriptIndex = 0;
  // How many times each platform has been asked for copy. Drives `platformScript`
  // and lets a test assert that a passing platform was never rewritten.
  const perPlatform = new Map();

  /*
   * Run the REAL style guard, exactly as the real service does.
   *
   * Opt-in, because the canned FAKE_POSTS above are ~20 words and every
   * platform band starts at 45: switching this on globally would fail every
   * existing planner test for reasons that have nothing to do with what they
   * test.
   *
   * Where it IS on, the fake stops being a yes-man. `_style` is attached by
   * parsePlannerOutput in the real service, so a fake that omits it hands the
   * planner `rejections: []` and every post passes — which is why a 44-word
   * Threads post could not be reproduced in a test before this existed.
   */
  const finish = (result, platform) => {
    if (!opts.validate) return result;
    const guarded = applyStyleGuard(result, { platform });
    return {
      ...guarded.content,
      _style: { repaired: guarded.repaired, rejections: guarded.rejections },
    };
  };

  /*
   * Record usage the way the real service does: one row per PROVIDER CALL, on
   * the way out of a call that actually happened.
   *
   * Opt-in via `apiUsage`, and it matters for one question specifically — does a
   * blocked duplicate click cost the user anything? That can only be answered
   * where the spend is booked, and in production the planner never books it;
   * openaiContentService.recordUsage does, per call. A fake that skipped this
   * would make "no calls, no charge" true by construction instead of by test.
   */
  const bookUsage = async (ctx) => {
    if (!opts.apiUsage) return;
    await opts.apiUsage.recordUsage({
      userId: ctx?.userId ?? null,
      scheduledPostId: null,
      service: 'openai',
      operation: 'openai_generate_content',
      inputUnits: 1,
      outputUnits: 1,
      metadata: { model: 'fake', success: true, classification: null },
    });
  };

  return {
    _calls: calls,
    _perPlatform: perPlatform,
    /** How many times this platform's copy was written. */
    callsFor: (platform) => perPlatform.get(platform) ?? 0,
    /*
     * Availability is PER USER now, and this fake has to model that or it hides
     * the thing under test.
     *
     * Discovered by the browser smoke test: with `isAvailable: () => true` the
     * fake answered "yes" for a user with no OpenAI key, and plan generation
     * returned 201. The real service refuses — but the fake replaces the real
     * service, so the harness was reporting a pass over a path it had disabled.
     *
     * `isAvailableForUser` lets a caller wire this to the real credential check.
     * Left unset it keeps the old process-wide answer, which is what every
     * existing planner test wants.
     */
    isAvailable: async (userId = null) => {
      if (opts.available === false) return false;
      if (opts.isAvailableForUser) return opts.isAvailableForUser(userId);
      return true;
    },
    async generateSocialContent() {
      return {
        facebook: { caption: 'Caption for facebook', hashtags: ['#cyflow'] },
        instagram: { caption: 'Caption for instagram', hashtags: ['#cyflow'] },
        threads: { caption: 'Caption for threads', hashtags: ['#cyflow'] },
        visual: { headline: 'Great Headline', subheadline: 'Sub', imageAltText: 'Alt text' },
        _meta: { model: 'fake', responseId: 'resp_1', usage: { inputUnits: 1, outputUnits: 1 } },
      };
    },
    async generatePlannerPost(input, ctx = {}) {
      calls.push(input);
      if (opts.error) throw opts.error;
      const i = n;
      n += 1;
      const attemptForPlatform = perPlatform.get(input.platform) ?? 0;
      perPlatform.set(input.platform, attemptForPlatform + 1);
      await bookUsage(ctx);

      /*
       * Per-platform script: `{ threads: [firstAttempt, repaired], ... }`.
       *
       * Each platform advances independently and repeats its last entry, which
       * is what models a repair: attempt 1 comes back 44 words, attempt 2 comes
       * back at a usable length. Keyed by platform rather than by call order
       * because the planner interleaves platforms, and a test that depends on
       * global call order is asserting the scheduler, not the repair.
       */
      if (opts.platformScript?.[input.platform]) {
        const script = opts.platformScript[input.platform];
        const raw = script[Math.min(attemptForPlatform, script.length - 1)];
        // A bare string is the caption: what these scripts are almost always
        // about is the copy, and `{ caption: '...' }` on every entry is noise.
        // (Spreading a bare string would scatter it across integer keys and
        // silently produce a post with no caption at all.)
        const entry = typeof raw === 'string' ? { caption: raw } : raw;
        return finish({
          headline: 'A specific useful headline',
          subheadline: 'Supporting line',
          imageAltText: 'Alt',
          summary: 'Summary',
          hashtags: ['#seo'],
          ...entry,
          _meta: {
            model: 'fake',
            responseId: `resp_${input.platform}_${attemptForPlatform}`,
            usage: { inputUnits: 1, outputUnits: 1 },
          },
        }, input.platform);
      }

      /*
       * Scripted mode: return these exact posts, in order, then repeat the last.
       *
       * Needed to reproduce a retry faithfully — the generation and the retry
       * must be specific, known posts so the assertion is about the planner's
       * duplicate logic rather than about whatever the rotation happened to
       * produce.
       *
       * A call carrying `siblingCopy` is a PLATFORM VARIANT request, not the
       * next post in the script. It gets that entry's `variants[platform]`, so
       * the fake behaves like a real writer: same subject, genuinely different
       * post per platform. Without this the fake would hand every platform the
       * same text and the planner would correctly (but unhelpfully) flag it as
       * one post pasted twice.
       */
      if (Array.isArray(opts.scripted) && opts.scripted.length) {
        const isVariant = Boolean(input.siblingCopy);
        // A variant belongs to the post that was just generated, not the next.
        const index = isVariant ? Math.max(0, scriptIndex - 1) : scriptIndex;
        if (!isVariant) scriptIndex += 1;
        const entry = opts.scripted[Math.min(index, opts.scripted.length - 1)];
        const post = isVariant ? (entry.variants?.[input.platform] ?? entry) : entry;
        const { variants, ...body } = post;
        return finish({
          subheadline: 'Supporting line',
          imageAltText: 'Alt',
          summary: 'Summary',
          ...body,
          _meta: { model: 'fake', responseId: `resp_s${index}`, usage: { inputUnits: 1, outputUnits: 1 } },
        }, input.platform);
      }

      if (opts.duplicate) {
        return {
          caption: 'Identical caption every single time for duplication testing purposes.',
          hashtags: ['#same'],
          headline: 'Identical headline',
          subheadline: 'Same sub',
          imageAltText: 'Alt',
          summary: 'Summary',
          _meta: { model: 'fake', responseId: 'resp_dup', usage: { inputUnits: 1, outputUnits: 1 } },
        };
      }

      const post = FAKE_POSTS[i % FAKE_POSTS.length];
      const out = {
        caption: post.caption,
        hashtags: post.hashtags,
        headline: post.headline,
        subheadline: `Supporting line ${i}`,
        imageAltText: `Alt ${i}`,
        summary: `Summary ${i}`,
        _meta: { model: 'fake', responseId: `resp_${i}`, usage: { inputUnits: 1, outputUnits: 1 } },
      };
      if (input.contentType === 'tips') out.bullets = [`Tip A${i}`, `Tip B${i}`];
      if (input.contentType === 'proof') out.stat = { value: `${i + 1}0%`, label: `metric ${i}` };
      if (input.contentType === 'comparison') {
        out.comparison = {
          leftTitle: `Option A${i}`, leftItems: [`a${i}`],
          rightTitle: `Option B${i}`, rightItems: [`b${i}`],
        };
      }
      return out;
    },
  };
}

export default {
  createFakeOpenAiVerifier,
  createFakeUserRepository,
  createFakeIntegrationRepository,
  createFakeLogRepository,
  createFakeHctiService,
  fakeWithTransaction,
  createFakeOverrides,
};
