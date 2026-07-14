/**
 * HCTI integration controller (factory).
 *
 * Owns saving, status, testing, and deleting a user's encrypted HCTI
 * credentials. Plaintext credentials are encrypted with AES-256-GCM before
 * storage and only decrypted immediately before an outbound API call. The API
 * never echoes supplied values, ciphertext, IVs, or auth tags. All identity
 * comes from the session (`req.user.id`) — never from the body/params.
 */

import { EVENT_TYPES, ENCRYPTION_VERSION } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ConflictError } from '../utils/errors.js';
import { nowIso } from '../utils/time.js';

import * as defaultIntegrationRepository from '../repositories/integrationRepository.js';
import { hctiService as defaultHctiService } from '../services/hctiService.js';
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
    return {
      configured: true,
      verified: record.verifiedAt != null,
      verifiedAt: record.verifiedAt ?? null,
      maskedUserId,
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
      await logging.record(EVENT_TYPES.HCTI_CREDENTIALS_VERIFIED, {
        req,
        userId,
        message: 'HCTI credentials verified',
      });
      return sendSuccess(res, {
        success: true,
        verified: true,
        message: result.message,
      });
    }

    // Failure: keep configured but unverified. Never expose provider body.
    await integrations.clearHctiVerification(userId);
    await logging.record(EVENT_TYPES.HCTI_CREDENTIALS_VERIFICATION_FAILED, {
      req,
      userId,
      level: 'warn',
      message: 'HCTI credential verification failed',
      context: { classification: result.classification ?? 'service_error' },
    });
    return sendSuccess(res, {
      success: false,
      verified: false,
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

  return {
    getHctiStatus,
    saveHctiCredentials,
    testHctiCredentials,
    deleteHctiCredentials,
  };
}

export default createIntegrationController;
