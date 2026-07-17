/**
 * Prove a customer's OpenAI API key works — and nothing more.
 *
 * Uses `models.list()`: the smallest call that actually authenticates. It
 * spends no output tokens, generates no content, and touches none of the
 * customer's writing. "Test connection" that quietly produced a social post
 * would be spending their money to answer a question they did not ask.
 *
 * What this NEVER does:
 *   - report a balance, a credit total, a limit or a billing state. The models
 *     endpoint does not return any of that, and inventing it would be a lie
 *     about someone's money;
 *   - echo the provider's response body, which can carry organisation details;
 *   - log or return the key.
 */

import { openAiClientResolver as defaultResolver } from './openaiClientResolver.js';

/** What the user is told. Short, honest, and free of provider internals. */
const MESSAGES = {
  ok: 'Your OpenAI API key works.',
  auth: 'That key was rejected by OpenAI. Check it and try again.',
  rate_limited: 'OpenAI is rate limiting this key right now. Try again shortly.',
  quota: 'This key has no available quota. Check your OpenAI API billing.',
  timeout: 'OpenAI did not respond in time. Try again shortly.',
  unavailable: 'OpenAI is temporarily unavailable. Try again shortly.',
  unknown: 'The key could not be verified. Try again shortly.',
};

/** Map a provider/transport error to our own safe classification. */
export function classifyVerifyError(err) {
  const status = typeof err?.status === 'number' ? err.status : null;
  const code = typeof err?.code === 'string' ? err.code : '';
  const name = String(err?.name || '');

  if (name.includes('Timeout') || name === 'AbortError' || code === 'ETIMEDOUT') return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return code === 'insufficient_quota' ? 'quota' : 'rate_limited';
  if (typeof status === 'number' && status >= 500) return 'unavailable';
  if (name.includes('Connection')) return 'unavailable';
  return 'unknown';
}

export function createOpenAiVerifier({ resolver = defaultResolver, logger = console } = {}) {
  /**
   * @param {{ userId }} input
   * @returns {Promise<{ success, classification, message }>} never throws for a
   *          provider failure — a rejected key is an answer, not an exception.
   */
  async function verify({ userId }) {
    let client;
    try {
      ({ client } = await resolver.resolveForUser(userId));
    } catch (err) {
      // No key, or an envelope that will not open. The resolver's message is
      // already user-facing and already free of internals.
      return { success: false, classification: 'not_configured', message: err.message };
    }

    try {
      await client.models.list();
      return { success: true, classification: null, message: MESSAGES.ok };
    } catch (err) {
      const classification = classifyVerifyError(err);
      // Log the classification only. Never the key, never the provider body.
      logger.warn('[openai] key verification failed', { classification });
      return { success: false, classification, message: MESSAGES[classification] ?? MESSAGES.unknown };
    }
  }

  return { verify };
}

export const openAiVerifier = createOpenAiVerifier();
export default openAiVerifier;
