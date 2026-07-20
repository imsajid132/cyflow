/**
 * Integration controller (factory) — HCTI and OpenAI.
 *
 * Owns saving, status, testing and deleting a user's own encrypted provider
 * credentials. Both follow one pattern deliberately: a second scheme in one
 * table would be two things to get right. Plaintext credentials are encrypted with AES-256-GCM before
 * storage and only decrypted immediately before an outbound API call. The API
 * never echoes supplied values, ciphertext, IVs, or auth tags. All identity
 * comes from the session (`req.user.id`) — never from the body/params.
 */

import { EVENT_TYPES, ENCRYPTION_VERSION, PROVIDER_NAMES } from '../config/constants.js';
import { normalizeProviderError } from '../utils/providerErrors.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ConflictError } from '../utils/errors.js';
import { nowIso } from '../utils/time.js';

import * as defaultIntegrationRepository from '../repositories/integrationRepository.js';
import { hctiService as defaultHctiService } from '../services/hctiService.js';
import { openAiVerifier as defaultOpenAiVerifier } from '../services/openAiVerifier.js';
import { loggingService as defaultLoggingService } from '../services/loggingService.js';
import {
  encryptSecret as defaultEncryptSecret,
  decryptSecret as defaultDecryptSecret,
  maskSecret as defaultMaskSecret,
} from '../services/encryptionService.js';
import { withTransaction as defaultWithTransaction } from '../db/transactions.js';

export function createIntegrationController({
  integrations = defaultIntegrationRepository,
  hctiService = defaultHctiService,
  openAiVerifier = defaultOpenAiVerifier,
  logging = defaultLoggingService,
  withTransaction = defaultWithTransaction,
  encryptSecret = defaultEncryptSecret,
  decryptSecret = defaultDecryptSecret,
  maskSecret = defaultMaskSecret,
} = {}) {
  /** Build the safe status object; decrypts only the User ID for masking. */
  async function buildStatus(userId) {
    const record = await integrations.getHctiCredentialRecord(userId);
    if (!record || !record.configured) {
      return { configured: false, verified: false, verifiedAt: null, maskedUserId: null };
    }
    let maskedUserId = null;
    try {
      maskedUserId = maskSecret(decryptSecret(record.encryptedUserId));
    } catch {
      // Corrupt/unreadable ciphertext — do not expose anything.
      maskedUserId = null;
    }
    const health = record.health ?? {};
    return {
      configured: true,
      verified: record.verifiedAt != null,
      verifiedAt: record.verifiedAt ?? null,
      maskedUserId,
      // Safe health panel (credential-free).
      connectionLabel: health.connectionLabel ?? null,
      lastSuccessAt: health.lastSuccessAt ?? null,
      lastFailureAt: health.lastFailureAt ?? null,
      lastErrorCategory: health.lastErrorCategory ?? null,
      lastCheckedAt: health.lastCheckedAt ?? null,
    };
  }

  const getHctiStatus = asyncHandler(async (req, res) => {
    return sendSuccess(res, await buildStatus(req.user.id));
  });

  const saveHctiCredentials = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    // Read into locals we can drop references to after use.
    let hctiUserId = req.body.hctiUserId;
    let hctiApiKey = req.body.hctiApiKey;

    const encryptedUserId = encryptSecret(String(hctiUserId).trim());
    const encryptedApiKey = encryptSecret(String(hctiApiKey));

    await withTransaction(async (conn) => {
      await integrations.upsertEncryptedHctiCredentials(
        {
          userId,
          encryptedUserId,
          encryptedApiKey,
          encryptionVersion: ENCRYPTION_VERSION,
        },
        conn,
      );
    });

    // Drop plaintext references as soon as they are no longer needed.
    const maskedUserId = maskSecret(String(hctiUserId).trim());
    hctiUserId = undefined;
    hctiApiKey = undefined;

    await logging.record(EVENT_TYPES.HCTI_CREDENTIALS_SAVED, {
      req,
      userId,
      message: 'HCTI credentials saved',
    });

    // Never echo supplied values — configured status only.
    return sendSuccess(res, {
      configured: true,
      verified: false,
      verifiedAt: null,
      maskedUserId,
    });
  });

  const testHctiCredentials = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const record = await integrations.getHctiCredentialRecord(userId);
    if (!record || !record.configured) {
      throw new ConflictError('No HCTI credentials are configured');
    }

    // Decrypt only immediately before the outbound call.
    let hctiUserId = decryptSecret(record.encryptedUserId);
    let hctiApiKey = decryptSecret(record.encryptedApiKey);

    let result;
    try {
      result = await hctiService.testCredentials({ hctiUserId, hctiApiKey });
    } finally {
      hctiUserId = undefined;
      hctiApiKey = undefined;
    }

    if (result.success) {
      const verifiedAt = nowIso();
      await integrations.markHctiVerified(userId, verifiedAt);
      await integrations.recordHctiHealth(userId, { success: true, category: null, at: verifiedAt }).catch(() => {});
      await logging.record(EVENT_TYPES.PROVIDER_HEALTH_CHECKED, {
        req,
        userId,
        message: 'HCTI credentials verified',
        context: { provider: 'hcti', success: true },
      });
      return sendSuccess(res, {
        success: true,
        verified: true,
        verifiedAt,
        message: result.message,
      });
    }

    // Failure: keep configured but unverified. Never expose provider body.
    const at = nowIso();
    await integrations.clearHctiVerification(userId);
    await integrations.recordHctiHealth(userId, { success: false, category: result.category ?? 'unknown_provider_error', at }).catch(() => {});
    await logging.record(EVENT_TYPES.PROVIDER_HEALTH_CHECKED, {
      req,
      userId,
      level: 'warn',
      message: 'HCTI credential verification failed',
      context: { provider: 'hcti', success: false, category: result.category ?? result.classification ?? 'unknown_provider_error' },
    });
    return sendSuccess(res, {
      success: false,
      verified: false,
      category: result.category ?? null,
      retryable: result.retryable ?? null,
      message: result.message,
    });
  });

  const deleteHctiCredentials = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    // Confirmation ("confirm": "DELETE") is enforced by the validator.
    await integrations.deleteHctiCredentials(userId);
    await logging.record(EVENT_TYPES.HCTI_CREDENTIALS_DELETED, {
      req,
      userId,
      message: 'HCTI credentials deleted',
    });
    return sendSuccess(res, { configured: false, verified: false, verifiedAt: null });
  });

  // --- OpenAI ----------------------------------------------------------------
  //
  // The same shape as the HCTI handlers above, for the same reasons: identity
  // from the session only, plaintext dropped the moment it is stored, and the
  // response carries status — never the value, the ciphertext, the IV or the tag.

  /** The safe status. Decrypts ONLY to build the mask, exactly as HCTI does. */
  async function buildOpenAiStatus(userId) {
    const record = await integrations.getOpenAiCredentialRecord(userId);
    if (!record || !record.configured) {
      return {
        configured: false, verified: false, verifiedAt: null, maskedKey: null, model: null,
      };
    }
    let maskedKey = null;
    try {
      maskedKey = maskSecret(decryptSecret(record.encryptedApiKey));
    } catch {
      // Unreadable ciphertext — expose nothing. The user is told to replace it
      // when they try to generate; a status page is not the place to alarm them
      // with a decryption failure.
      maskedKey = null;
    }
    const health = record.health ?? {};
    return {
      configured: true,
      verified: record.verifiedAt != null,
      verifiedAt: record.verifiedAt ?? null,
      maskedKey,
      model: record.model ?? null,
      connectionLabel: health.connectionLabel ?? null,
      lastSuccessAt: health.lastSuccessAt ?? null,
      lastFailureAt: health.lastFailureAt ?? null,
      lastErrorCategory: health.lastErrorCategory ?? null,
      lastCheckedAt: health.lastCheckedAt ?? null,
    };
  }

  const getOpenAiStatus = asyncHandler(async (req, res) =>
    sendSuccess(res, await buildOpenAiStatus(req.user.id)));

  const saveOpenAiCredentials = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    // A local we can drop the reference to once it is encrypted.
    let apiKey = String(req.body.apiKey).trim();
    const model = req.body.model ?? null;

    const encryptedApiKey = encryptSecret(apiKey);
    const maskedKey = maskSecret(apiKey);
    apiKey = undefined;

    await withTransaction(async (conn) => {
      await integrations.upsertEncryptedOpenAiCredentials(
        { userId, encryptedApiKey, model, encryptionVersion: ENCRYPTION_VERSION },
        conn,
      );
    });

    await logging.record(EVENT_TYPES.OPENAI_CREDENTIALS_SAVED, {
      req, userId, message: 'OpenAI API key saved',
    });

    /*
     * verified:false, always. Saving proves the key was typed, not that it
     * works — and the repository resets openai_verified_at on every write, so a
     * replaced key cannot inherit the old key's verification.
     */
    return sendSuccess(res, {
      configured: true, verified: false, verifiedAt: null, maskedKey, model,
    });
  });

  const testOpenAiCredentials = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const record = await integrations.getOpenAiCredentialRecord(userId);
    if (!record || !record.configured) {
      throw new ConflictError('No OpenAI API key is configured');
    }

    /*
     * The smallest safe call: list models. It proves the key authenticates
     * without generating a post, without spending output tokens, and without
     * touching the customer's content.
     */
    const result = await openAiVerifier.verify({ userId });

    if (result.success) {
      const verifiedAt = nowIso();
      await integrations.markOpenAiVerified(userId, verifiedAt);
      await integrations.recordOpenAiHealth(userId, { success: true, category: null, at: verifiedAt }).catch(() => {});
      await logging.record(EVENT_TYPES.PROVIDER_HEALTH_CHECKED, {
        req, userId, message: 'OpenAI API key verified', context: { provider: 'openai', success: true },
      });
      return sendSuccess(res, { success: true, verified: true, verifiedAt, message: result.message });
    }

    // Failure keeps the key configured but unverified. Normalize the verifier's
    // own token into the shared safe category vocabulary for the health panel.
    const category = normalizeProviderError(
      { classification: result.classification }, { provider: PROVIDER_NAMES.OPENAI },
    ).category;
    const at = nowIso();
    await integrations.clearOpenAiVerification(userId);
    await integrations.recordOpenAiHealth(userId, { success: false, category, at }).catch(() => {});
    await logging.record(EVENT_TYPES.PROVIDER_HEALTH_CHECKED, {
      req,
      userId,
      level: 'warn',
      message: 'OpenAI API key verification failed',
      context: { provider: 'openai', success: false, category },
    });
    return sendSuccess(res, { success: false, verified: false, verifiedAt: null, category, message: result.message });
  });

  const deleteOpenAiCredentials = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    // Confirmation ("confirm": "DELETE") is enforced by the validator.
    await integrations.deleteOpenAiCredentials(userId);
    await logging.record(EVENT_TYPES.OPENAI_CREDENTIALS_DELETED, {
      req, userId, message: 'OpenAI API key deleted',
    });
    return sendSuccess(res, {
      configured: false, verified: false, verifiedAt: null, maskedKey: null, model: null,
    });
  });

  /**
   * Set an operator-chosen connection label (a name like "Main HCTI"), so a
   * team can tell WHICH account is connected without revealing the credential.
   * The label is trimmed, length-capped, and never a credential.
   */
  const setHctiLabel = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 120) : null;
    await integrations.setHctiLabel(userId, label || null);
    return sendSuccess(res, await buildStatus(userId));
  });

  const setOpenAiLabel = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 120) : null;
    await integrations.setOpenAiLabel(userId, label || null);
    return sendSuccess(res, await buildOpenAiStatus(userId));
  });

  return {
    getOpenAiStatus,
    saveOpenAiCredentials,
    testOpenAiCredentials,
    deleteOpenAiCredentials,
    setOpenAiLabel,
    getHctiStatus,
    saveHctiCredentials,
    testHctiCredentials,
    deleteHctiCredentials,
    setHctiLabel,
  };
}

export default createIntegrationController;
