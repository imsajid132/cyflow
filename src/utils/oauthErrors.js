/**
 * OAuth/provider error classification.
 *
 * `OAuthError` carries a stable, safe `classification` token (one of
 * OAUTH_ERROR_CODES) used for redirect `?code=` values, activity logging, and
 * client messaging. Error messages are always static/safe strings — they never
 * contain authorization codes, state, tokens, client secrets, Authorization
 * headers, or raw provider response bodies.
 */

import { AppError } from './errors.js';
import { ERROR_CODES } from '../config/constants.js';

export const OAUTH_ERROR_CODES = Object.freeze({
  INVALID_AUTHORIZATION_CODE: 'invalid_authorization_code',
  INVALID_STATE: 'invalid_state',
  EXPIRED_STATE: 'expired_state',
  PERMISSION_DENIED: 'permission_denied',
  INVALID_TOKEN: 'invalid_token',
  EXPIRED_TOKEN: 'expired_token',
  REVOKED_TOKEN: 'revoked_token',
  RATE_LIMITED: 'rate_limited',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  INVALID_PROVIDER_RESPONSE: 'invalid_provider_response',
  PROVIDER_CONFIGURATION_ERROR: 'provider_configuration_error',
  NO_PUBLISHABLE_ACCOUNT: 'no_publishable_account',
  ACCOUNT_NOT_ELIGIBLE: 'account_not_eligible',
});

const OAUTH_ERROR_CODE_SET = new Set(Object.values(OAUTH_ERROR_CODES));

/** Safe, user-facing messages keyed by classification. */
const SAFE_MESSAGES = Object.freeze({
  invalid_authorization_code: 'The authorization could not be completed. Please try connecting again.',
  invalid_state: 'The connection request could not be verified. Please try again.',
  expired_state: 'The connection request expired. Please try again.',
  permission_denied: 'The connection was cancelled or permission was not granted.',
  invalid_token: 'The account token is invalid. Please reconnect the account.',
  expired_token: 'The account token has expired. Please reconnect the account.',
  revoked_token: 'Access to the account was revoked. Please reconnect the account.',
  rate_limited: 'The provider is rate limiting requests. Please try again later.',
  provider_unavailable: 'The provider is temporarily unavailable. Please try again later.',
  invalid_provider_response: 'The provider returned an unexpected response. Please try again.',
  provider_configuration_error: 'This provider is not configured on the server.',
  no_publishable_account: 'No publishable account was found for this connection.',
  account_not_eligible: 'This account type is not eligible. A professional/business account is required.',
});

export class OAuthError extends AppError {
  /**
   * @param {string} classification one of OAUTH_ERROR_CODES
   * @param {string} [message] safe, static message (defaults from classification)
   * @param {{ statusCode?: number, cause?: unknown }} [options]
   */
  constructor(classification, message, options = {}) {
    const cls = OAUTH_ERROR_CODE_SET.has(classification)
      ? classification
      : OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE;
    super(message || SAFE_MESSAGES[cls], {
      statusCode: options.statusCode ?? 502,
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      cause: options.cause,
    });
    this.classification = cls;
  }
}

/** Return the safe message for a classification token. */
export function safeMessageFor(classification) {
  return SAFE_MESSAGES[classification] || SAFE_MESSAGES.invalid_provider_response;
}

/** Map a provider-denial `error` query value to a classification. */
export function classifyProviderDenial() {
  // Facebook/IG/Threads all report user cancellation via `error=access_denied`.
  return OAUTH_ERROR_CODES.PERMISSION_DENIED;
}

export default { OAUTH_ERROR_CODES, OAuthError, safeMessageFor, classifyProviderDenial };
