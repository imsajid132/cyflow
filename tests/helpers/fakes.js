/**
 * In-memory test doubles implementing the SAME interfaces as the production
 * repositories/services. Production code is never modified — the container/app
 * accepts these as `overrides` for hermetic tests (no DB, no network).
 */

import { sanitizeUser } from '../../src/repositories/userRepository.js';
import { sanitizeAccount } from '../../src/repositories/socialAccountRepository.js';
import { evaluateStateRow } from '../../src/repositories/oauthStateRepository.js';
import { normalizeEmail } from '../../src/utils/validation.js';
import { OAuthError, OAUTH_ERROR_CODES } from '../../src/utils/oauthErrors.js';

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

/** Fake transaction runner: invokes the callback with a marker connection. */
export async function fakeWithTransaction(callback) {
  return callback({ _fakeConnection: true });
}

/** Build a full override bundle for createApp/buildContainer. */
export function createFakeOverrides(extra = {}) {
  return {
    userRepository: createFakeUserRepository(),
    integrationRepository: createFakeIntegrationRepository(),
    logRepository: createFakeLogRepository(),
    hctiService: createFakeHctiService(),
    oauthStateRepository: createFakeOAuthStateRepository(),
    socialAccountRepository: createFakeSocialAccountRepository(),
    providerRegistry: createFakeProviderRegistry(),
    dataDeletionRepository: createFakeDataDeletionRepository(),
    withTransaction: fakeWithTransaction,
    ...extra,
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
