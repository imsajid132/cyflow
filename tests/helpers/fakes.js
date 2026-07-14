/**
 * In-memory test doubles implementing the SAME interfaces as the production
 * repositories/services. Production code is never modified — the container/app
 * accepts these as `overrides` for hermetic tests (no DB, no network).
 */

import { sanitizeUser } from '../../src/repositories/userRepository.js';
import { normalizeEmail } from '../../src/utils/validation.js';

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
