/**
 * Resolve an OpenAI client for ONE user, from THAT user's own credential.
 *
 * THE DEFECT THIS EXISTS TO END. openaiContentService built a single client
 * from `config.openai.apiKey` — one global application key — and cached it in
 * module state:
 *
 *     let cachedClient = client;
 *     function getClient() {
 *       if (cachedClient) return cachedClient;
 *       cachedClient = new OpenAI({ apiKey: config.openai.apiKey, ... });
 *       return cachedClient;
 *     }
 *
 * Every customer's generation ran on that one credential, billed to one
 * account, through one process-wide cached object. There was no per-user key to
 * fall back FROM — the global key was not a fallback, it was the only path.
 *
 * So this module is the whole of the rule "never silently use a global
 * application key": every OpenAI call for a customer resolves here, from that
 * customer's encrypted row, and a user with no key gets a clear error BEFORE
 * any provider call or usage record exists.
 *
 * WHAT IS NEVER DONE HERE:
 *   - a decrypted key is never cached, per-user or otherwise. Clients are keyed
 *     by user for the life of ONE call and nothing survives it. A cache keyed by
 *     user is one refactor away from a cache keyed by nothing, and that is
 *     exactly the bug above;
 *   - a decrypted key is never returned to a caller, logged, or put in an error;
 *   - one user's key is never used for another user's work.
 */

import OpenAI from 'openai';

import { config as defaultConfig } from '../config/env.js';
import * as defaultIntegrations from '../repositories/integrationRepository.js';
import { decryptSecret } from './encryptionService.js';
import { ConflictError } from '../utils/errors.js';
import { OPENAI_MODELS } from '../config/constants.js';

/**
 * What a user is told when they have no key.
 *
 * Names the action and where to fix it, and nothing about the implementation:
 * a customer does not need to know whether the column was NULL or the envelope
 * failed to open.
 */
export const OPENAI_NOT_CONFIGURED_MESSAGE =
  'Add and verify your OpenAI API key in Integrations before using AI generation.';

/** A stored model is only honoured if it is still one we support. */
export function resolveModel(requested, fallback) {
  if (typeof requested === 'string' && OPENAI_MODELS.includes(requested)) return requested;
  return fallback;
}

export function createOpenAiClientResolver({
  integrations = defaultIntegrations,
  config = defaultConfig,
  buildClient = null,
} = {}) {
  /**
   * Is the LEGACY global key allowed to stand in for a customer credential?
   *
   * Two independent conditions, both required, because either one alone has
   * been a production incident somewhere:
   *
   *   the operator set ALLOW_LEGACY_GLOBAL_OPENAI_KEY explicitly, AND
   *   the process is not production.
   *
   * The environment check is not redundant with the flag. A .env copied from a
   * developer machine to a server is the single most ordinary way a
   * development-only switch ends up live, and this is the line that makes that
   * mistake harmless.
   */
  function legacyGlobalKeyAllowed() {
    return config.openai.allowLegacyGlobalKey === true && config.env !== 'production';
  }

  /**
   * The client for this user's own key.
   *
   * @param {string|number} userId
   * @returns {Promise<{ client, model, source }>} `source` is 'customer' or
   *          'legacy-global', for logging and tests. The key is NOT returned.
   * @throws {ConflictError} when the user has no usable credential
   */
  async function resolveForUser(userId, { model: requestedModel = null } = {}) {
    const record = await integrations.getOpenAiCredentialRecord(userId).catch(() => null);

    if (record?.configured) {
      let apiKey;
      try {
        apiKey = decryptSecret(record.encryptedApiKey);
      } catch {
        /*
         * The envelope will not open: wrong key, tampered row, or a version
         * this build cannot read. Never fall through to the global key — that
         * would silently bill a different account for this customer's work and
         * hide a real problem behind a working feature.
         */
        throw new ConflictError(
          'Your OpenAI API key could not be read. Please replace it in Integrations.',
        );
      }

      const client = buildClient
        ? buildClient({ apiKey, userId })
        : new OpenAI({
          apiKey,
          timeout: config.openai.requestTimeoutMs,
          maxRetries: 2, // SDK retries ONLY transient 429/5xx/timeout, not 4xx
        });
      // The plaintext goes out of scope with this function. It is never
      // returned, stored, or attached to the client's public surface.
      apiKey = null;

      return {
        client,
        model: resolveModel(requestedModel ?? record.model, config.openai.textModel),
        source: 'customer',
      };
    }

    if (legacyGlobalKeyAllowed() && config.openai.available) {
      return {
        client: buildClient
          ? buildClient({ apiKey: config.openai.apiKey, userId })
          : new OpenAI({
            apiKey: config.openai.apiKey,
            timeout: config.openai.requestTimeoutMs,
            maxRetries: 2,
          }),
        model: resolveModel(requestedModel, config.openai.textModel),
        source: 'legacy-global',
      };
    }

    throw new ConflictError(OPENAI_NOT_CONFIGURED_MESSAGE);
  }

  /**
   * Can this user generate at all?
   *
   * Cheap: reads the row, never decrypts. Used to disable an action before the
   * user clicks it, rather than letting them find out by failing.
   */
  async function isAvailableForUser(userId) {
    if (await integrations.hasConfiguredOpenAiCredentials(userId).catch(() => false)) return true;
    return legacyGlobalKeyAllowed() && config.openai.available;
  }

  return { resolveForUser, isAvailableForUser, legacyGlobalKeyAllowed };
}

export const openAiClientResolver = createOpenAiClientResolver();
export default openAiClientResolver;
