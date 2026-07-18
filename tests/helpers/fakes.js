/**
 * In-memory test doubles implementing the SAME interfaces as the production
 * repositories/services. Production code is never modified — the container/app
 * accepts these as `overrides` for hermetic tests (no DB, no network).
 */

import { sanitizeUser } from '../../src/repositories/userRepository.js';
import { sanitizeAccount } from '../../src/repositories/socialAccountRepository.js';
import { sanitizePost } from '../../src/repositories/postRepository.js';
import { evaluateStateRow } from '../../src/repositories/oauthStateRepository.js';
import { PLANNER_ITEM_STATUS, ACCOUNT_TYPE_TO_PLATFORM } from '../../src/config/constants.js';
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
    async getSanitizedUserById(id) {
      const r = rows.find((x) => String(x.id) === String(id));
      return r ? sanitizeUser(r) : null;
    },
    async deleteUserById(id) {
      const i = rows.findIndex((x) => String(x.id) === String(id));
      if (i < 0) return 0;
      rows.splice(i, 1);
      return 1;
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
  // Reference edges, mirroring media_asset_references.
  const refs = [];
  function toApi(r) {
    if (!r) return null;
    return {
      id: String(r.id),
      userId: String(r.user_id),
      scheduledPostId: r.scheduled_post_id == null ? null : String(r.scheduled_post_id),
      publicToken: r.public_token,
      sourceProvider: r.source_provider,
      storageDriver: r.storage_driver ?? null,
      originalFilename: r.original_filename ?? null,
      fileSizeBytes: r.file_size_bytes ?? null,
      width: r.width ?? null,
      height: r.height ?? null,
      altText: r.alt_text ?? null,
      checksumSha256: r.checksum_sha256 ?? null,
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
    _refs: refs,
    MEDIA_REFERENCE_TYPES: ['planner_run_item', 'scheduled_post'],
    async listStorageKeysForUser(userId) {
      return rows
        .filter((r) => String(r.user_id) === String(userId) && r.storage_driver === 'local' && r.storage_key)
        .map((r) => ({ id: String(r.id), storageKey: r.storage_key, mimeType: r.mime_type ?? null }));
    },
    async createMediaAsset(input) {
      const row = {
        id: String(nextId++),
        user_id: String(input.userId),
        scheduled_post_id: input.scheduledPostId ?? null,
        public_token: input.publicToken,
        source_provider: input.sourceProvider ?? 'hcti',
        storage_driver: input.storageDriver ?? null,
        storage_key: input.storageKey ?? null,
        original_filename: input.originalFilename ?? null,
        file_size_bytes: input.fileSizeBytes ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        alt_text: input.altText ?? null,
        checksum_sha256: input.checksumSha256 ?? null,
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
    async listMediaAssetsForUser(userId) {
      return rows
        .filter((r) => String(r.user_id) === String(userId) && ['ready', 'pending'].includes(r.status))
        .slice().reverse().map(toApi);
    },
    async findStorageKeyForAsset(id, userId) {
      const r = find(id, userId);
      return r ? { storageDriver: r.storage_driver, storageKey: r.storage_key, mimeType: r.mime_type } : null;
    },
    async findStorageByPublicToken(token) {
      const r = rows.find((x) => x.public_token === token && x.status === 'ready');
      return r ? { storageDriver: r.storage_driver, storageKey: r.storage_key, mimeType: r.mime_type, sourceUrl: r.source_url } : null;
    },
    async findMediaAssetByChecksumForUser(checksum, userId) {
      const r = rows.find((x) => String(x.user_id) === String(userId) && x.checksum_sha256 === checksum && x.status === 'ready');
      return toApi(r ?? null);
    },
    async updateMediaAltText(id, userId, altText) {
      const r = find(id, userId);
      if (!r) return null;
      r.alt_text = altText;
      return toApi(r);
    },
    async deleteMediaAssetRow(id, userId) {
      const i = rows.findIndex((r) => String(r.id) === String(id) && String(r.user_id) === String(userId));
      if (i >= 0) { rows.splice(i, 1); return true; }
      return false;
    },
    async attachMediaReference({ userId, mediaAssetId, referenceType, referenceId }) {
      const dup = refs.find((x) => String(x.media_asset_id) === String(mediaAssetId)
        && x.reference_type === referenceType && String(x.reference_id) === String(referenceId));
      if (dup) return { created: false };
      refs.push({ id: String(refs.length + 1), user_id: String(userId), media_asset_id: String(mediaAssetId), reference_type: referenceType, reference_id: String(referenceId), created_at: '2026-01-01 00:00:00' });
      return { created: true };
    },
    async detachMediaReference({ userId, mediaAssetId, referenceType, referenceId }) {
      const i = refs.findIndex((x) => String(x.user_id) === String(userId) && String(x.media_asset_id) === String(mediaAssetId)
        && x.reference_type === referenceType && String(x.reference_id) === String(referenceId));
      if (i >= 0) { refs.splice(i, 1); return true; }
      return false;
    },
    async detachAllReferencesForEntity({ userId, referenceType, referenceId }) {
      for (let i = refs.length - 1; i >= 0; i -= 1) {
        if (String(refs[i].user_id) === String(userId) && refs[i].reference_type === referenceType && String(refs[i].reference_id) === String(referenceId)) refs.splice(i, 1);
      }
    },
    async countReferencesForAsset(id, userId) {
      return refs.filter((x) => String(x.media_asset_id) === String(id) && String(x.user_id) === String(userId)).length;
    },
    async listReferencesForAsset(id, userId) {
      return refs.filter((x) => String(x.media_asset_id) === String(id) && String(x.user_id) === String(userId))
        .map((r) => ({ referenceType: r.reference_type, referenceId: String(r.reference_id), createdAt: r.created_at }));
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
        post_origin: input.postOrigin ?? null,
        draft_version: 1,
        scheduled_at_utc: null,
        original_timezone: null,
        scheduled_local_date: null,
        scheduled_local_time: null,
        last_manual_edit_at: null,
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
          publish_status: 'scheduled',
          attempt_count: 0,
          remote_post_id: null,
          remote_post_url: null,
          attention_reason: null,
          last_error_message: null,
          published_at: null,
          next_attempt_at: null,
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
          publishStatus: t.publish_status ?? 'scheduled',
          attemptCount: t.attempt_count,
          remotePostId: t.remote_post_id ?? null,
          remotePostUrl: t.remote_post_url ?? null,
          attentionReason: t.attention_reason ?? null,
          lastErrorMessage: t.last_error_message ?? null,
          publishedAt: t.published_at ?? null,
          nextAttemptAt: t.next_attempt_at ?? null,
        });
      }
      return out;
    },
    // E: atomic versioned manual save (fields + params + hand-edited copy).
    async saveManualDraft(postId, userId, { fields = {}, generationParams, platformCaptions, expectedVersion = null } = {}) {
      const r = findRow(postId, userId);
      if (!r) return null;
      if (expectedVersion != null && Number(r.draft_version ?? 1) !== Number(expectedVersion)) {
        return { conflict: true };
      }
      if (fields.title !== undefined) r.title = fields.title;
      if (fields.prompt !== undefined) r.prompt = fields.prompt;
      if (fields.templateName !== undefined) r.template_name = fields.templateName;
      if (fields.aspectRatio !== undefined) r.aspect_ratio = fields.aspectRatio;
      if (fields.backgroundStyle !== undefined) r.background_style = fields.backgroundStyle;
      if (generationParams !== undefined) r.generation_params_json = generationParams ?? null;
      if (platformCaptions !== undefined) {
        r.generated_platform_captions_json = platformCaptions ?? null;
        r.last_manual_edit_at = '2026-01-01 00:00:00';
      }
      r.post_origin = r.post_origin ?? 'manual_draft';
      r.draft_version = Number(r.draft_version ?? 1) + 1;
      return { post: sanitizePost(r) };
    },
    async schedulePost(postId, userId, { scheduledAtUtc, originalTimezone, scheduledLocalDate = null, scheduledLocalTime = null }) {
      const r = findRow(postId, userId);
      if (!r) return null;
      r.status = 'queued';
      r.scheduled_at_utc = scheduledAtUtc;
      r.original_timezone = originalTimezone;
      r.scheduled_local_date = scheduledLocalDate;
      r.scheduled_local_time = scheduledLocalTime;
      if (!['planner_generated', 'automation_generated'].includes(r.post_origin)) r.post_origin = 'manual_scheduled';
      targets
        .filter((t) => String(t.scheduled_post_id) === String(postId) && t.status !== 'published')
        .forEach((t) => { t.status = 'pending'; });
      return sanitizePost(r);
    },
    // E: Publish Now — same as schedule at "now" but records manual_publish_now.
    async markPublishNow(postId, userId, { scheduledAtUtc, originalTimezone }) {
      const r = findRow(postId, userId);
      if (!r) return null;
      r.status = 'queued';
      r.scheduled_at_utc = scheduledAtUtc;
      r.original_timezone = originalTimezone;
      if (!['planner_generated', 'automation_generated'].includes(r.post_origin)) r.post_origin = 'manual_publish_now';
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
/** Fake `accountDataRepository` — in-memory exports + deletion requests (G). */
export function createFakeAccountDataRepository() {
  const exports = [];
  const deletions = [];
  let nextExport = 1; let nextDeletion = 1;
  const toMs = (v) => (v == null ? null : new Date(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`).getTime());
  const sanitizeExport = (r) => (r ? {
    id: String(r.id), userId: String(r.user_id), status: r.status,
    hasFile: Boolean(r.storage_key), fileSizeBytes: r.file_size_bytes ?? null,
    errorMessage: r.error_message ?? null, requestedAt: r.requested_at ?? null,
    completedAt: r.completed_at ?? null, expiresAt: r.expires_at ?? null, createdAt: r.created_at ?? null,
  } : null);
  const sanitizeDeletion = (r) => (r ? {
    id: String(r.id), userId: r.user_id == null ? null : String(r.user_id),
    status: r.status, confirmationCode: r.confirmation_code,
    requestedAt: r.requested_at ?? null, completedAt: r.completed_at ?? null,
  } : null);
  return {
    _exports: exports, _deletions: deletions,
    async createExportRequest(userId) {
      const r = { id: String(nextExport++), user_id: String(userId), status: 'requested', download_token_hash: null, storage_driver: null, storage_key: null, file_size_bytes: null, error_message: null, requested_at: '2026-01-01 00:00:00', completed_at: null, expires_at: null, created_at: new Date().toISOString() };
      exports.push(r); return sanitizeExport(r);
    },
    async findExportById(id, userId) {
      return sanitizeExport(exports.find((r) => String(r.id) === String(id) && String(r.user_id) === String(userId)) ?? null);
    },
    async findLatestExportForUser(userId) {
      const list = exports.filter((r) => String(r.user_id) === String(userId)).sort((a, b) => Number(b.id) - Number(a.id));
      return sanitizeExport(list[0] ?? null);
    },
    async countRecentExports(userId, sinceMysqlUtc) {
      const since = toMs(sinceMysqlUtc);
      return exports.filter((r) => String(r.user_id) === String(userId) && toMs(r.created_at) >= since).length;
    },
    async updateExport(id, userId, fields) {
      const r = exports.find((x) => String(x.id) === String(id) && String(x.user_id) === String(userId));
      if (!r) return null;
      const map = { status: 'status', downloadTokenHash: 'download_token_hash', storageDriver: 'storage_driver', storageKey: 'storage_key', fileSizeBytes: 'file_size_bytes', errorMessage: 'error_message', completedAt: 'completed_at', expiresAt: 'expires_at' };
      for (const [k, col] of Object.entries(map)) if (fields[k] !== undefined) r[col] = fields[k];
      return sanitizeExport(r);
    },
    async findExportStorage(id, userId) {
      const r = exports.find((x) => String(x.id) === String(id) && String(x.user_id) === String(userId) && x.status === 'ready' && x.storage_key);
      return r ? { storageDriver: r.storage_driver, storageKey: r.storage_key } : null;
    },
    async createDeletionRequest({ userId, confirmationCode, reason = null }) {
      const r = { id: String(nextDeletion++), user_id: String(userId), status: 'requested', confirmation_code: confirmationCode, reason, requested_at: '2026-01-01 00:00:00', completed_at: null };
      deletions.push(r); return sanitizeDeletion(r);
    },
    async findActiveDeletionForUser(userId) {
      const list = deletions.filter((r) => String(r.user_id) === String(userId) && ['requested', 'processing'].includes(r.status)).sort((a, b) => Number(b.id) - Number(a.id));
      return sanitizeDeletion(list[0] ?? null);
    },
    async updateDeletionRequest(id, fields) {
      const r = deletions.find((x) => String(x.id) === String(id));
      if (!r) return;
      if (fields.status !== undefined) r.status = fields.status;
      if (fields.completedAt !== undefined) r.completed_at = fields.completedAt;
    },
  };
}

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
    automationRepository: extra.automationRepository ?? createFakeAutomationRepository(),
    backgroundJobRepository: extra.backgroundJobRepository ?? createFakeBackgroundJobRepository(),
    // D2 publishing shares the post + account fakes so the app-level publish flow
    // works without a DB. Fake adapters never call a real provider.
    publishRepository: extra.publishRepository
      ?? createFakePublishRepository({ posts: postRepository, accounts: socialAccountRepository }),
    publishAdapters: extra.publishAdapters ?? createFakePublishAdapters().adapters,
    // G: account data export + deletion.
    accountDataRepository: extra.accountDataRepository ?? createFakeAccountDataRepository(),
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
        contentAutomationId: input.contentAutomationId ?? null,
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
        .filter((r) => r.userId === String(userId) && r.contentAutomationId == null)
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

/**
 * Fake `backgroundJobRepository` — in-memory, models the atomic claim: a locked,
 * unexpired job cannot be claimed by a second worker. Times are kept as epoch ms
 * so Date / MySQL-UTC-string / ISO inputs all compare correctly.
 */
export function createFakeBackgroundJobRepository() {
  const jobs = [];
  const leases = new Map();
  let nextId = 1;
  const toMs = (v) => {
    if (v == null) return null;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const s = String(v).includes('T') ? String(v) : `${String(v).replace(' ', 'T')}Z`;
    return new Date(s).getTime();
  };
  const view = (j) => (j ? {
    id: String(j.id), userId: j.user_id == null ? null : String(j.user_id),
    automationId: j.automation_id == null ? null : String(j.automation_id),
    jobType: j.job_type, status: j.status, idempotencyKey: j.idempotency_key,
    payload: j.payload ?? null, scheduledFor: j.scheduled_for ?? null, availableAt: j.available_at ?? null,
    attemptCount: j.attempt_count, maxAttempts: j.max_attempts, lockedBy: j.locked_by ?? null,
    lockedUntil: j.locked_until ?? null, heartbeatAt: j.heartbeat_at ?? null,
    lastErrorCategory: j.last_error_category ?? null, lastErrorMessage: j.last_error_message ?? null,
    completedAt: j.completed_at ?? null, createdAt: j.created_at ?? null, updatedAt: j.updated_at ?? null,
  } : null);
  const find = (id) => jobs.find((j) => String(j.id) === String(id));
  return {
    _jobs: jobs,
    sanitizeJob: view,
    async enqueueJob(input) {
      const existing = jobs.find((j) => j.idempotency_key === input.idempotencyKey);
      if (existing) return { job: view(existing), created: false };
      const row = {
        id: nextId++, user_id: input.userId ?? null, automation_id: input.automationId ?? null,
        job_type: input.jobType, status: 'pending', idempotency_key: input.idempotencyKey,
        payload: input.payload ?? null, scheduled_for: input.scheduledFor ?? null,
        available_at: input.availableAt ?? new Date(), _availMs: toMs(input.availableAt ?? new Date()),
        attempt_count: 0, max_attempts: Number.isInteger(input.maxAttempts) ? input.maxAttempts : 5,
        locked_by: null, locked_until: null, _lockMs: null, heartbeat_at: null,
        last_error_category: null, last_error_message: null, completed_at: null,
        created_at: new Date().toISOString(),
      };
      jobs.push(row);
      return { job: view(row), created: true };
    },
    async claimNextJob({ workerId, leaseMs = 60000, now = new Date(), jobTypes = null }) {
      const nowMs = toMs(now);
      const candidate = jobs
        .filter((j) => ['pending', 'retry_scheduled'].includes(j.status))
        .filter((j) => (j._availMs ?? 0) <= nowMs)
        .filter((j) => j._lockMs == null || j._lockMs <= nowMs)
        .filter((j) => !jobTypes || jobTypes.includes(j.job_type))
        .sort((a, b) => (a._availMs ?? 0) - (b._availMs ?? 0) || a.id - b.id)[0];
      if (!candidate) return null;
      candidate.status = 'running';
      candidate.locked_by = workerId;
      candidate._lockMs = nowMs + leaseMs;
      candidate.locked_until = new Date(candidate._lockMs).toISOString();
      candidate.heartbeat_at = new Date(nowMs).toISOString();
      candidate.attempt_count += 1;
      return view(candidate);
    },
    async heartbeatJob({ jobId, workerId, leaseMs = 60000, now = new Date() }) {
      const j = find(jobId);
      if (!j || j.locked_by !== workerId || j.status !== 'running') return false;
      j._lockMs = toMs(now) + leaseMs; j.locked_until = new Date(j._lockMs).toISOString(); j.heartbeat_at = new Date(toMs(now)).toISOString();
      return true;
    },
    async completeJob({ jobId, workerId, now = new Date() }) {
      const j = find(jobId);
      if (!j || j.locked_by !== workerId) return false;
      j.status = 'completed'; j.completed_at = new Date(toMs(now)).toISOString(); j.locked_by = null; j._lockMs = null; j.locked_until = null;
      return true;
    },
    async retryJob({ jobId, workerId, availableAt, errorCategory, errorMessage }) {
      const j = find(jobId);
      if (!j || j.locked_by !== workerId) return false;
      j.status = 'retry_scheduled'; j.available_at = availableAt; j._availMs = toMs(availableAt);
      j.locked_by = null; j._lockMs = null; j.locked_until = null;
      j.last_error_category = errorCategory ?? null; j.last_error_message = errorMessage ?? null;
      return true;
    },
    async failJob({ jobId, workerId, errorCategory, errorMessage, now = new Date() }) {
      const j = find(jobId);
      if (!j || j.locked_by !== workerId) return false;
      j.status = 'failed'; j.completed_at = new Date(toMs(now)).toISOString(); j.locked_by = null; j._lockMs = null; j.locked_until = null;
      j.last_error_category = errorCategory ?? null; j.last_error_message = errorMessage ?? null;
      return true;
    },
    async cancelJobsForAutomation({ automationId, userId }) {
      let n = 0;
      for (const j of jobs) {
        if (String(j.automation_id) === String(automationId) && String(j.user_id) === String(userId)
          && ['pending', 'retry_scheduled'].includes(j.status)) { j.status = 'cancelled'; j.locked_by = null; j._lockMs = null; n += 1; }
      }
      return n;
    },
    async cancelAllJobsForUser(userId) {
      let n = 0;
      for (const j of jobs) {
        if (String(j.user_id) === String(userId) && ['pending', 'retry_scheduled'].includes(j.status)) {
          j.status = 'cancelled'; j.locked_by = null; j._lockMs = null; n += 1;
        }
      }
      return n;
    },
    async recoverStaleJobs({ now = new Date(), limit = 50 }) {
      const nowMs = toMs(now);
      let reclaimed = 0; let failed = 0;
      for (const j of jobs) {
        if (j.status !== 'running' || j._lockMs == null || j._lockMs >= nowMs) continue;
        if (reclaimed + failed >= limit) break;
        if (j.attempt_count < j.max_attempts) {
          j.status = 'retry_scheduled'; j.available_at = new Date(nowMs).toISOString(); j._availMs = nowMs;
          j.locked_by = null; j._lockMs = null; j.locked_until = null;
          j.last_error_category = 'transient'; j.last_error_message = 'Recovered after a stale worker lease';
          reclaimed += 1;
        } else {
          j.status = 'failed'; j.completed_at = new Date(nowMs).toISOString(); j.locked_by = null; j._lockMs = null;
          j.last_error_category = 'transient'; j.last_error_message = 'Exhausted attempts after stale worker lease';
          failed += 1;
        }
      }
      return { reclaimed, failed };
    },
    async findJobByIdempotencyKey(key) { return view(jobs.find((j) => j.idempotency_key === key)); },
    async findJobById(id) { return view(find(id)); },
    async jobStats({ now = new Date() } = {}) {
      const counts = {};
      for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
      const nowMs = toMs(now);
      const stale = jobs.filter((j) => j.status === 'running' && j._lockMs != null && j._lockMs < nowMs).length;
      return { counts, pending: (counts.pending || 0) + (counts.retry_scheduled || 0), running: counts.running || 0, stale };
    },
    async acquireLease({ lockName, owner, ttlMs, now = new Date() }) {
      const held = leases.get(lockName);
      const nowMs = toMs(now);
      if (held && held.owner !== owner && held.expiresMs > nowMs) return false;
      leases.set(lockName, { owner, expiresMs: nowMs + ttlMs });
      return true;
    },
    async releaseLease({ lockName, owner }) {
      const held = leases.get(lockName);
      if (held && held.owner === owner) { leases.delete(lockName); return true; }
      return false;
    },
  };
}

/** Fake `automationRepository` — in-memory content_automations + slots. */
export function createFakeAutomationRepository() {
  const autos = new Map();
  const slots = [];
  let nextA = 1;
  let nextS = 1;
  const A = (a) => (a ? { ...a, selectedWeekdays: [...a.selectedWeekdays], postingTimes: [...a.postingTimes], selectedPlatforms: [...a.selectedPlatforms], selectedAccountIds: [...a.selectedAccountIds] } : null);
  const S = (s) => (s ? { ...s } : null);
  const findSlot = (id) => slots.find((s) => String(s.id) === String(id));
  return {
    _autos: autos, _slots: slots,
    async createAutomation(input) {
      const id = String(nextA++);
      const row = {
        id, userId: String(input.userId), businessProfileId: input.businessProfileId ?? null,
        plannerRunId: null, name: input.name ?? null, status: input.status ?? 'draft', mode: input.mode ?? 'review',
        timezone: input.timezone, selectedWeekdays: input.selectedWeekdays ?? [], postingTimes: input.postingTimes ?? [],
        postsPerDay: input.postsPerDay ?? 1, rhythmKey: input.rhythmKey ?? null,
        selectedPlatforms: input.selectedPlatforms ?? [], selectedAccountIds: (input.selectedAccountIds ?? []).map(String),
        startDate: input.startDate ?? null, endDate: input.endDate ?? null,
        generationHorizonDays: input.generationHorizonDays ?? 14, minimumReadyDays: input.minimumReadyDays ?? 7,
        lowBufferDays: input.lowBufferDays ?? 3, missedPostPolicy: input.missedPostPolicy ?? 'skip',
        failurePolicy: input.failurePolicy ?? 'pause', configSnapshot: input.configSnapshot ?? null,
        generatedThroughDate: null, attentionReason: null, lastRefillAt: null, nextRefillAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), stoppedAt: null,
      };
      autos.set(id, row);
      return A(row);
    },
    async findAutomationByIdForUser(id, userId) {
      const a = autos.get(String(id));
      return a && a.userId === String(userId) ? A(a) : null;
    },
    async listAutomationsForUser(userId) {
      return [...autos.values()].filter((a) => a.userId === String(userId)).reverse().map(A);
    },
    async updateAutomation(id, userId, fields) {
      const a = autos.get(String(id));
      if (!a || a.userId !== String(userId)) return null;
      for (const [k, v] of Object.entries(fields)) a[k] = v instanceof Date ? v.toISOString() : v;
      return A(a);
    },
    async listDueForRefill({ now = new Date(), limit = 50 } = {}) {
      return [...autos.values()].filter((a) => a.status === 'active' && (a.nextRefillAt == null || new Date(a.nextRefillAt) <= now)).slice(0, limit).map(A);
    },
    async createSlotIfAbsent(input) {
      const dup = slots.find((s) => String(s.automationId) === String(input.automationId) && s.localDate === input.localDate && s.localTime === input.localTime && Number(s.sequence) === Number(input.sequence ?? 0));
      if (dup) return { slot: S(dup), created: false };
      const row = {
        id: String(nextS++), userId: String(input.userId), automationId: String(input.automationId),
        plannerRunItemId: null, localDate: input.localDate, localTime: input.localTime, sequence: input.sequence ?? 0,
        scheduledForUtc: input.scheduledForUtc instanceof Date ? input.scheduledForUtc.toISOString() : String(input.scheduledForUtc),
        status: 'planned', idempotencyKey: input.idempotencyKey, lastErrorCategory: null, lastErrorMessage: null,
        updatedAt: new Date().toISOString(),
      };
      slots.push(row);
      return { slot: S(row), created: true };
    },
    async findSlotByIdForUser(id, userId) {
      const s = findSlot(id);
      return s && s.userId === String(userId) ? S(s) : null;
    },
    async listSlotsForAutomation(automationId, userId, { statuses = null, fromLocalDate = null } = {}) {
      return slots.filter((s) => String(s.automationId) === String(automationId) && s.userId === String(userId)
        && (!statuses || statuses.includes(s.status)) && (!fromLocalDate || s.localDate >= fromLocalDate))
        .sort((a, b) => String(a.scheduledForUtc).localeCompare(String(b.scheduledForUtc))).map(S);
    },
    async claimSlotForGeneration(slotId, userId) {
      const s = findSlot(slotId);
      if (!s || s.userId !== String(userId) || s.status !== 'planned') return false;
      s.status = 'generating'; return true;
    },
    async markSlotReady(slotId, userId, itemId) {
      const s = findSlot(slotId);
      if (s && s.userId === String(userId)) { s.status = 'ready'; s.plannerRunItemId = String(itemId); s.lastErrorCategory = null; s.lastErrorMessage = null; }
    },
    async markSlotStatus(slotId, userId, status, { category = null, message = null } = {}) {
      const s = findSlot(slotId);
      if (s && s.userId === String(userId)) { s.status = status; s.lastErrorCategory = category; s.lastErrorMessage = message; }
    },
    async resetSlotToPlanned(slotId, userId, { message = null } = {}) {
      const s = findSlot(slotId);
      if (s && s.userId === String(userId) && s.status === 'generating') { s.status = 'planned'; s.lastErrorCategory = 'transient'; s.lastErrorMessage = message; }
    },
    async cancelFutureSlots(automationId, userId, fromLocalDate) {
      let n = 0;
      for (const s of slots) if (String(s.automationId) === String(automationId) && s.userId === String(userId) && s.localDate >= fromLocalDate && ['planned', 'generating'].includes(s.status)) { s.status = 'cancelled'; n++; }
      return n;
    },
    async bufferStats(automationId, userId, { fromLocalDate }) {
      const mine = slots.filter((s) => String(s.automationId) === String(automationId) && s.userId === String(userId));
      const readyDates = new Set(mine.filter((s) => s.status === 'ready' && s.localDate >= fromLocalDate).map((s) => s.localDate));
      const byStatus = {};
      for (const s of mine) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
      const through = [...readyDates].sort().pop() || null;
      return { readyDays: readyDates.size, through, byStatus };
    },
  };
}

/**
 * Fake publishRepository (D2) — SHARES the fake postRepository's posts+targets so
 * the app-level publish flow (queueApproved -> scheduler -> publish jobs) works
 * end to end without a database. Holds its own in-memory publish_attempts.
 */
export function createFakePublishRepository({ posts, accounts } = {}) {
  const attempts = [];
  let nextId = 1;
  const findTarget = (id) => posts._targets.find((t) => String(t.id) === String(id));
  const findPost = (id) => posts._posts.find((p) => String(p.id) === String(id));
  const toMs = (v) => (v == null ? 0 : (v instanceof Date ? v.getTime() : new Date(String(v).replace(' ', 'T') + (String(v).includes('Z') ? '' : 'Z')).getTime()));

  async function shape(t) {
    if (!t) return null;
    const p = findPost(t.scheduled_post_id);
    if (!p) return null;
    const acc = accounts ? await accounts.findAccountByIdForUser(t.social_account_id, p.user_id) : null;
    const platform = acc ? ACCOUNT_TYPE_TO_PLATFORM[acc.accountType] || null : null;
    const captions = p.generated_platform_captions_json || {};
    const caption = t.caption_override || captions?.[platform]?.caption || p.generated_base_caption || '';
    return {
      targetId: String(t.id), scheduledPostId: String(t.scheduled_post_id), userId: String(p.user_id),
      socialAccountId: String(t.social_account_id), provider: acc?.provider ?? null, accountType: acc?.accountType ?? null,
      platform, providerAccountId: acc?.providerAccountId ?? null, accountStatus: acc?.status ?? 'revoked',
      status: t.status, publishStatus: t.publish_status ?? 'scheduled', attemptCount: t.attempt_count ?? 0,
      attentionReason: t.attention_reason ?? null, lastPublishAttemptId: t.last_publish_attempt_id ?? null,
      remotePostId: t.remote_post_id ?? null, postStatus: p.status, scheduledAtUtc: p.scheduled_at_utc ?? null,
      mediaAssetId: p.media_asset_id == null ? null : String(p.media_asset_id), caption,
    };
  }

  return {
    _attempts: attempts,
    async findTargetForPublish(id, userId) { const t = findTarget(id); const s = await shape(t); return s && s.userId === String(userId) ? s : null; },
    async listDuePublishTargets({ now = new Date() } = {}) {
      const out = [];
      for (const t of posts._targets) {
        const p = findPost(t.scheduled_post_id);
        if (!p || !['queued', 'processing', 'partial', 'retrying'].includes(p.status)) continue;
        if (!['scheduled', 'retry_scheduled'].includes(t.publish_status ?? 'scheduled')) continue;
        if (!p.scheduled_at_utc || toMs(p.scheduled_at_utc) > toMs(now)) continue;
        // eslint-disable-next-line no-await-in-loop
        out.push(await shape(t));
      }
      return out;
    },
    // E (Publish Now): a specific owned post's enqueue-able targets, any due time.
    async listPublishTargetsForPost(postId, userId) {
      const out = [];
      for (const t of posts._targets) {
        if (String(t.scheduled_post_id) !== String(postId)) continue;
        const p = findPost(t.scheduled_post_id);
        if (!p || String(p.user_id) !== String(userId)) continue;
        if (!['scheduled', 'retry_scheduled'].includes(t.publish_status ?? 'scheduled')) continue;
        // eslint-disable-next-line no-await-in-loop
        out.push(await shape(t));
      }
      return out;
    },
    async claimTargetForPublish() { return true; },
    async createAttemptIfAbsent(input) {
      const dup = attempts.find((a) => a.idempotency_key === input.idempotencyKey);
      if (dup) return { attempt: sanitizeAttemptRow(dup), created: false };
      const row = { id: String(nextId++), user_id: String(input.userId), scheduled_post_id: String(input.scheduledPostId), scheduled_post_target_id: String(input.targetId), social_account_id: input.socialAccountId ?? null, background_job_id: input.backgroundJobId ?? null, provider: input.provider, status: 'started', idempotency_key: input.idempotencyKey, provider_container_id: null, provider_post_id: null, attempt_number: input.attemptNumber ?? 1, created_at: new Date().toISOString() };
      attempts.push(row);
      return { attempt: sanitizeAttemptRow(row), created: true };
    },
    async updateAttempt(id, userId, fields) { const a = attempts.find((x) => x.id === String(id)); if (a) Object.assign(a, snakeAttempt(fields)); return a ? sanitizeAttemptRow(a) : null; },
    async findAttemptById(id, userId) { const a = attempts.find((x) => x.id === String(id) && x.user_id === String(userId)); return a ? sanitizeAttemptRow(a) : null; },
    async findAttemptByIdempotencyKey(k) { const a = attempts.find((x) => x.idempotency_key === k); return a ? sanitizeAttemptRow(a) : null; },
    async listAttemptsForTarget(targetId, userId) { return attempts.filter((a) => String(a.scheduled_post_target_id) === String(targetId) && a.user_id === String(userId)).map(sanitizeAttemptRow).reverse(); },
    async listAttemptsToReconcile() { return attempts.filter((a) => ['submitted', 'reconciling', 'unknown_result'].includes(a.status)).map(sanitizeAttemptRow); },
    async updateTargetPublishState(id, userId, fields) {
      const t = findTarget(id); const p = t ? findPost(t.scheduled_post_id) : null;
      if (!t || !p || p.user_id !== String(userId)) return;
      if (fields.publishStatus !== undefined) t.publish_status = fields.publishStatus;
      if (fields.status !== undefined) t.status = fields.status;
      if (fields.attentionReason !== undefined) t.attention_reason = fields.attentionReason;
      if (fields.remotePostId !== undefined) t.remote_post_id = fields.remotePostId;
      if (fields.remotePostUrl !== undefined) t.remote_post_url = fields.remotePostUrl;
      if (fields.lastErrorMessage !== undefined) t.last_error_message = fields.lastErrorMessage;
      if (fields.lastPublishAttemptId !== undefined) t.last_publish_attempt_id = fields.lastPublishAttemptId;
      if (fields.nextAttemptAt !== undefined) t.next_attempt_at = fields.nextAttemptAt instanceof Date ? fields.nextAttemptAt.toISOString() : fields.nextAttemptAt;
    },
    async retryTargetForPublish(id, userId) {
      const t = findTarget(id); const p = t ? findPost(t.scheduled_post_id) : null;
      if (!t || !p || p.user_id !== String(userId) || !['failed', 'attention_needed'].includes(t.publish_status)) return false;
      t.publish_status = 'retry_scheduled'; t.attention_reason = null; t.attempt_count += 1; return true;
    },
    async rollupPostStatus(postId, userId) {
      const p = findPost(postId); if (!p || p.user_id !== String(userId)) return null;
      const mine = posts._targets.filter((t) => String(t.scheduled_post_id) === String(postId));
      const pub = mine.filter((t) => t.publish_status === 'published').length;
      if (pub === mine.length) p.status = 'published';
      else if (pub > 0) p.status = 'partial';
      else if (mine.every((t) => ['failed', 'cancelled', 'skipped', 'attention_needed'].includes(t.publish_status))) p.status = 'failed';
      else p.status = 'processing';
      return p.status;
    },
  };
}
function sanitizeAttemptRow(a) {
  return { id: String(a.id), userId: String(a.user_id), scheduledPostId: String(a.scheduled_post_id), targetId: String(a.scheduled_post_target_id), provider: a.provider, status: a.status, idempotencyKey: a.idempotency_key, providerContainerId: a.provider_container_id ?? null, providerPostId: a.provider_post_id ?? null, providerStatus: a.provider_status ?? null, attemptNumber: a.attempt_number ?? 1, errorCategory: a.error_category ?? null, safeErrorMessage: a.safe_error_message ?? null, nextReconcileAt: a.next_reconcile_at ?? null, createdAt: a.created_at ?? null };
}
function snakeAttempt(f) {
  const m = { status: 'status', providerContainerId: 'provider_container_id', providerPostId: 'provider_post_id', providerRequestId: 'provider_request_id', providerStatus: 'provider_status', errorCategory: 'error_category', safeErrorMessage: 'safe_error_message', submittedAt: 'submitted_at', publishedAt: 'published_at', lastCheckedAt: 'last_checked_at', nextReconcileAt: 'next_reconcile_at', attemptNumber: 'attempt_number' };
  const out = {};
  for (const [k, col] of Object.entries(m)) if (f[k] !== undefined) out[col] = f[k] instanceof Date ? f[k].toISOString() : f[k];
  return out;
}

/** Fake publish adapters — deterministic, record calls, scriptable per platform. */
export function createFakePublishAdapters(script = {}) {
  const calls = { publish: [], reconcile: [] };
  const make = (platform) => ({
    platform,
    getCapabilities: () => ({ platform }),
    async preflight({ mediaUrl }) {
      if (platform === 'instagram' && !mediaUrl) return { ok: false, category: 'media_required' };
      return { ok: true };
    },
    async publish(ctx) {
      calls.publish.push({ platform, caption: ctx.caption });
      const r = script[platform]?.publish;
      const n = calls.publish.filter((c) => c.platform === platform).length;
      if (typeof r === 'function') return r(ctx, n);
      return r || { status: 'published', providerPostId: `${platform}_post_${n}` };
    },
    async reconcile() { calls.reconcile.push({ platform }); return script[platform]?.reconcile || { status: 'published', providerPostId: `${platform}_rec` }; },
  });
  return { calls, adapters: { facebook: make('facebook'), instagram: make('instagram'), threads: make('threads') } };
}
