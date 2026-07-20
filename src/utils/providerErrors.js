/**
 * Normalized provider + background-job error model.
 *
 * ONE way to describe a failure from OpenAI, HCTI, Facebook, Instagram, Threads,
 * the media store, the scheduler or a worker, so the operator always sees a
 * safe, clear, actionable message instead of a swallowed null or a raw provider
 * body. A `ProviderError` carries only safe fields:
 *
 *   provider, operation, category, errorCode, httpStatus, retryable,
 *   operatorMessage, userMessage, requestId, occurredAt, attemptNumber,
 *   maximumAttempts
 *
 * It NEVER carries an API key, an access/refresh token, an Authorization header,
 * a raw provider response, a prompt, or generated post copy. `cause` is kept for
 * internal logging only and is never serialized by `toSafeJSON`.
 *
 * The category vocabulary is the canonical `PROVIDER_ERROR_CATEGORY`; retryable
 * is derived from `RETRYABLE_PROVIDER_CATEGORIES`. `normalizeProviderError`
 * folds every existing error shape (the app's own AppError subclasses, the
 * per-provider `.classification` strings, Node network/abort errors) into this
 * one type.
 */

import { AppError } from './errors.js';
import {
  ERROR_CODES,
  PROVIDER_ERROR_CATEGORY as CAT,
  RETRYABLE_PROVIDER_CATEGORIES,
  PROVIDER_NAMES,
} from '../config/constants.js';

const RETRYABLE = new Set(RETRYABLE_PROVIDER_CATEGORIES);

/** Is a category worth another automatic attempt? */
export function isRetryableCategory(category) {
  return RETRYABLE.has(category);
}

/**
 * The HTTP status → category map, shared by every provider. 402 is
 * `payment_required` by default; a provider whose 402 specifically means "out of
 * render credits" (HCTI) refines it to `credits_exhausted` in its own mapper.
 */
export function classifyHttpStatus(status) {
  const s = Number(status);
  if (s === 401) return CAT.AUTHENTICATION_FAILED;
  if (s === 402) return CAT.PAYMENT_REQUIRED;
  if (s === 403) return CAT.PERMISSION_DENIED;
  if (s === 408) return CAT.NETWORK_TIMEOUT;
  if (s === 429) return CAT.RATE_LIMITED;
  if (s === 400 || s === 404 || s === 409 || s === 422) return CAT.REQUEST_INVALID;
  if (s >= 500) return CAT.PROVIDER_UNAVAILABLE;
  return CAT.UNKNOWN_PROVIDER_ERROR;
}

/** The client-facing HTTP status for a category (used when thrown through the API). */
function clientStatusFor(category) {
  switch (category) {
    case CAT.CREDENTIALS_MISSING: return 409;
    case CAT.AUTHENTICATION_FAILED: return 502;
    case CAT.PERMISSION_DENIED: return 502;
    case CAT.PAYMENT_REQUIRED: return 502;
    case CAT.CREDITS_EXHAUSTED: return 502;
    case CAT.QUOTA_EXCEEDED: return 502;
    case CAT.RATE_LIMITED: return 502;
    case CAT.REQUEST_INVALID: return 502;
    case CAT.RESPONSE_INVALID: return 502;
    case CAT.PROVIDER_UNAVAILABLE: return 502;
    case CAT.NETWORK_TIMEOUT: return 504;
    case CAT.NETWORK_FAILURE: return 502;
    case CAT.RENDER_FAILED: return 502;
    case CAT.MEDIA_PERSISTENCE_FAILED: return 500;
    case CAT.INTERNAL_FAILURE: return 500;
    default: return 502;
  }
}

/** A friendly provider label for user messages. */
function providerLabel(provider) {
  switch (provider) {
    case PROVIDER_NAMES.OPENAI: return 'OpenAI';
    case PROVIDER_NAMES.HCTI: return 'The image provider (HCTI)';
    case PROVIDER_NAMES.FACEBOOK: return 'Facebook';
    case PROVIDER_NAMES.INSTAGRAM: return 'Instagram';
    case PROVIDER_NAMES.THREADS: return 'Threads';
    case PROVIDER_NAMES.MEDIA: return 'The media library';
    case PROVIDER_NAMES.DATABASE: return 'The database';
    default: return 'A background service';
  }
}

/**
 * A short label for a card badge, e.g. "Credits exhausted". Kept generic so it
 * fits under "Image failed / HCTI · &lt;label&gt;".
 */
export function shortCategoryLabel(category) {
  const map = {
    [CAT.CREDENTIALS_MISSING]: 'Not configured',
    [CAT.AUTHENTICATION_FAILED]: 'Authentication failed',
    [CAT.PERMISSION_DENIED]: 'Permission denied',
    [CAT.PAYMENT_REQUIRED]: 'Payment required',
    [CAT.CREDITS_EXHAUSTED]: 'Credits exhausted',
    [CAT.QUOTA_EXCEEDED]: 'Quota exceeded',
    [CAT.RATE_LIMITED]: 'Rate limited',
    [CAT.REQUEST_INVALID]: 'Invalid request',
    [CAT.PROVIDER_UNAVAILABLE]: 'Provider unavailable',
    [CAT.NETWORK_TIMEOUT]: 'Timed out',
    [CAT.NETWORK_FAILURE]: 'Network error',
    [CAT.RESPONSE_INVALID]: 'Invalid response',
    [CAT.RENDER_FAILED]: 'Render failed',
    [CAT.MEDIA_PERSISTENCE_FAILED]: 'Media storage error',
    [CAT.INTERNAL_FAILURE]: 'Internal error',
    [CAT.UNKNOWN_PROVIDER_ERROR]: 'Unexpected error',
  };
  return map[category] || 'Error';
}

/**
 * The safe, actionable, user-facing sentence. Provider-specific where a specific
 * next step helps (HCTI credits, OpenAI key); otherwise a clear generic line.
 * Never mentions a key value, a token, or a raw provider body.
 */
export function userMessageFor(provider, category) {
  const isHcti = provider === PROVIDER_NAMES.HCTI;
  const isOpenAi = provider === PROVIDER_NAMES.OPENAI;
  const label = providerLabel(provider);
  switch (category) {
    case CAT.CREDENTIALS_MISSING:
      if (isHcti) return 'HCTI is not configured. Add your HCTI credentials on the Integrations page.';
      if (isOpenAi) return 'OpenAI is not configured. Add your OpenAI API key on the Integrations page.';
      return `${label} is not configured. Add its credentials on the Integrations page.`;
    case CAT.AUTHENTICATION_FAILED:
      if (isHcti) return 'HCTI credentials were rejected. Update them on the Integrations page.';
      if (isOpenAi) return 'OpenAI rejected the API key. Update it on the Integrations page.';
      return `${label} rejected the credentials. Update them on the Integrations page.`;
    case CAT.PERMISSION_DENIED:
      return `${label} does not have permission to perform this action. Check the account's access.`;
    case CAT.PAYMENT_REQUIRED:
      if (isHcti) return 'HCTI reported a billing problem. Your account may have an unpaid balance.';
      return `${label} reported a billing problem on the account.`;
    case CAT.CREDITS_EXHAUSTED:
      if (isHcti) return 'HCTI credits may be exhausted. Check your HCTI account balance or top up credits.';
      if (isOpenAi) return 'OpenAI credits or quota may be exhausted. Check your OpenAI billing.';
      return `${label} may be out of credits. Check the account balance.`;
    case CAT.QUOTA_EXCEEDED:
      if (isOpenAi) return 'OpenAI quota was exceeded. Check your OpenAI plan and usage limits.';
      return `${label} quota was exceeded. Check the account's usage limits.`;
    case CAT.RATE_LIMITED:
      if (isHcti) return 'HCTI rate limit or quota was reached. Try again in a short while.';
      return `${label} rate limit was reached. Try again in a short while.`;
    case CAT.REQUEST_INVALID:
      return `${label} rejected the request. This usually needs a change to the content, not a retry.`;
    case CAT.PROVIDER_UNAVAILABLE:
      return `${label} is temporarily unavailable. This can be retried.`;
    case CAT.NETWORK_TIMEOUT:
      return `${label} did not respond in time. This can be retried.`;
    case CAT.NETWORK_FAILURE:
      return `${label} could not be reached. Check connectivity, then retry.`;
    case CAT.RESPONSE_INVALID:
      return `${label} returned an unexpected response. This can be retried.`;
    case CAT.RENDER_FAILED:
      return 'The image could not be rendered. This can be retried.';
    case CAT.MEDIA_PERSISTENCE_FAILED:
      return 'The image rendered but could not be saved to your Media library. This can be retried.';
    case CAT.INTERNAL_FAILURE:
      return 'Something went wrong on our side. This has been recorded.';
    default:
      return `${label} returned an unexpected error. This can be retried.`;
  }
}

/** The one-line "what to do next" hint, safe to show. */
export function nextActionFor(category) {
  switch (category) {
    case CAT.CREDENTIALS_MISSING:
    case CAT.AUTHENTICATION_FAILED:
      return 'Open Integrations and update the credentials.';
    case CAT.PERMISSION_DENIED:
      return 'Check the account permissions, then try again.';
    case CAT.PAYMENT_REQUIRED:
    case CAT.CREDITS_EXHAUSTED:
      return 'Check the provider account balance or billing, then retry.';
    case CAT.QUOTA_EXCEEDED:
      return 'Check the provider plan and usage limits.';
    case CAT.RATE_LIMITED:
    case CAT.PROVIDER_UNAVAILABLE:
    case CAT.NETWORK_TIMEOUT:
    case CAT.NETWORK_FAILURE:
    case CAT.RESPONSE_INVALID:
    case CAT.RENDER_FAILED:
    case CAT.MEDIA_PERSISTENCE_FAILED:
      return 'Retry in a little while.';
    case CAT.REQUEST_INVALID:
      return 'Adjust the content, then regenerate.';
    default:
      return 'Retry, or open diagnostics for details.';
  }
}

export class ProviderError extends AppError {
  /**
   * @param {object} opts
   * @param {string} opts.provider  a PROVIDER_NAMES value
   * @param {string} opts.operation e.g. 'render_social_image'
   * @param {string} opts.category  a PROVIDER_ERROR_CATEGORY value
   * @param {number} [opts.httpStatus] the provider's HTTP status, if any
   * @param {string} [opts.requestId]
   * @param {number} [opts.attemptNumber]
   * @param {number} [opts.maximumAttempts]
   * @param {string} [opts.errorCode] stable machine token (defaults to category)
   * @param {string} [opts.userMessage] override the derived safe message
   * @param {string} [opts.operatorMessage] a slightly more technical, still-safe line
   * @param {boolean} [opts.retryable] override the category default
   * @param {string} [opts.occurredAt] ISO timestamp (caller supplies; clock-free here)
   * @param {unknown} [opts.cause] original error — internal only, never serialized
   */
  constructor(opts = {}) {
    const provider = opts.provider || 'unknown';
    const category = opts.category || CAT.UNKNOWN_PROVIDER_ERROR;
    const userMessage = opts.userMessage || userMessageFor(provider, category);
    super(userMessage, {
      statusCode: clientStatusFor(category),
      code: category === CAT.CREDENTIALS_MISSING
        ? ERROR_CODES.CONFLICT
        : ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      cause: opts.cause,
    });
    this.provider = provider;
    this.operation = opts.operation || null;
    this.category = category;
    // Keep `.classification` too, so this type is a drop-in for the existing
    // OpenAIContentError/SocialImageError/OAuthError convention.
    this.classification = category;
    this.errorCode = opts.errorCode || category;
    this.httpStatus = Number.isFinite(opts.httpStatus) ? Number(opts.httpStatus) : null;
    this.retryable = typeof opts.retryable === 'boolean' ? opts.retryable : isRetryableCategory(category);
    this.requestId = opts.requestId || null;
    this.attemptNumber = Number.isFinite(opts.attemptNumber) ? Number(opts.attemptNumber) : null;
    this.maximumAttempts = Number.isFinite(opts.maximumAttempts) ? Number(opts.maximumAttempts) : null;
    this.operatorMessage = opts.operatorMessage
      || `${providerLabel(provider)} failed (${category})${this.httpStatus ? ` [HTTP ${this.httpStatus}]` : ''}.`;
    this.userMessage = userMessage;
    this.occurredAt = opts.occurredAt || null;
    this.nextAction = nextActionFor(category);
    this.shortLabel = shortCategoryLabel(category);
  }

  /** The safe, serializable projection — no cause, no stack, no secrets. */
  toSafeJSON() {
    return {
      provider: this.provider,
      operation: this.operation,
      category: this.category,
      errorCode: this.errorCode,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      requestId: this.requestId,
      attemptNumber: this.attemptNumber,
      maximumAttempts: this.maximumAttempts,
      operatorMessage: this.operatorMessage,
      userMessage: this.userMessage,
      nextAction: this.nextAction,
      shortLabel: this.shortLabel,
      occurredAt: this.occurredAt,
    };
  }
}

/** True when a value is already a normalized provider error. */
export function isProviderError(err) {
  return err instanceof ProviderError;
}

/**
 * Map an app AppError subclass name to a category. These are the classes
 * hctiService / socialImageService / providers already throw.
 */
function categoryFromAppErrorName(name) {
  switch (name) {
    case 'AuthenticationError': return CAT.AUTHENTICATION_FAILED;
    case 'AuthorizationError': return CAT.PERMISSION_DENIED;
    case 'RateLimitError': return CAT.RATE_LIMITED;
    case 'ValidationError': return CAT.REQUEST_INVALID;
    case 'ConfigurationError': return CAT.INTERNAL_FAILURE;
    case 'ExternalServiceError': return CAT.PROVIDER_UNAVAILABLE;
    default: return null;
  }
}

/**
 * Map an existing per-provider `.classification` token onto a normalized
 * category. Covers OpenAI content, the HCTI adapter, and the OpenAI verifier —
 * every legacy vocabulary the maps found.
 */
function categoryFromClassification(classification) {
  switch (classification) {
    // OpenAI content service
    case 'invalid_configuration': return CAT.CREDENTIALS_MISSING;
    case 'authentication_failed': return CAT.AUTHENTICATION_FAILED;
    case 'rate_limited': return CAT.RATE_LIMITED;
    case 'quota_exceeded': return CAT.QUOTA_EXCEEDED;
    case 'timeout': return CAT.NETWORK_TIMEOUT;
    case 'provider_unavailable': return CAT.PROVIDER_UNAVAILABLE;
    case 'invalid_request': return CAT.REQUEST_INVALID;
    case 'incomplete_output': return CAT.RESPONSE_INVALID;
    case 'content_refused': return CAT.REQUEST_INVALID;
    case 'invalid_provider_response': return CAT.RESPONSE_INVALID;
    // HCTI adapter classificationOf
    case 'invalid_credentials': return CAT.AUTHENTICATION_FAILED;
    case 'unauthorized': return CAT.PERMISSION_DENIED;
    case 'validation_error': return CAT.REQUEST_INVALID;
    case 'service_error': return CAT.PROVIDER_UNAVAILABLE;
    // socialImageService
    case 'hcti_not_configured': return CAT.CREDENTIALS_MISSING;
    case 'hcti_not_verified': return CAT.CREDENTIALS_MISSING;
    case 'image_generation_failed': return CAT.RENDER_FAILED;
    // OpenAI verifier
    case 'auth': return CAT.AUTHENTICATION_FAILED;
    case 'quota': return CAT.QUOTA_EXCEEDED;
    case 'unavailable': return CAT.PROVIDER_UNAVAILABLE;
    case 'not_configured': return CAT.CREDENTIALS_MISSING;
    default: return null;
  }
}

/** Recognize a Node network/abort error without a status code. */
function categoryFromNodeError(err) {
  const name = err?.name || '';
  const code = err?.code || '';
  if (name === 'AbortError' || code === 'ETIMEDOUT' || /timeout|timed out/i.test(err?.message || '')) {
    return CAT.NETWORK_TIMEOUT;
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return CAT.NETWORK_FAILURE;
  }
  return null;
}

/**
 * Fold ANY thrown error into a normalized ProviderError. Idempotent: a
 * ProviderError passed back in only has its context (attempt numbers, requestId,
 * occurredAt) filled where missing.
 *
 * @param {unknown} err
 * @param {object} ctx { provider, operation, httpStatus?, attemptNumber?, maximumAttempts?, requestId?, occurredAt?, category? }
 */
export function normalizeProviderError(err, ctx = {}) {
  if (err instanceof ProviderError) {
    // Enrich context without overwriting what the error already knows.
    if (err.attemptNumber == null && Number.isFinite(ctx.attemptNumber)) err.attemptNumber = Number(ctx.attemptNumber);
    if (err.maximumAttempts == null && Number.isFinite(ctx.maximumAttempts)) err.maximumAttempts = Number(ctx.maximumAttempts);
    if (!err.requestId && ctx.requestId) err.requestId = ctx.requestId;
    if (!err.occurredAt && ctx.occurredAt) err.occurredAt = ctx.occurredAt;
    if (!err.operation && ctx.operation) err.operation = ctx.operation;
    return err;
  }

  const provider = ctx.provider || 'unknown';
  let category = ctx.category || null;
  let httpStatus = Number.isFinite(ctx.httpStatus) ? Number(ctx.httpStatus)
    : (Number.isFinite(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600 ? null : null);

  if (!category) {
    // 1. An explicit HTTP status on the error or context.
    const statusOnErr = Number(err?.httpStatus ?? err?.status ?? NaN);
    if (Number.isFinite(statusOnErr) && statusOnErr >= 400) {
      httpStatus = httpStatus ?? statusOnErr;
      category = classifyHttpStatus(statusOnErr);
    }
  }
  if (!category && err?.classification) category = categoryFromClassification(err.classification);
  if (!category && err?.name) category = categoryFromAppErrorName(err.name);
  if (!category) category = categoryFromNodeError(err);
  if (!category) category = CAT.UNKNOWN_PROVIDER_ERROR;

  return new ProviderError({
    provider,
    operation: ctx.operation || null,
    category,
    httpStatus: httpStatus ?? (Number.isFinite(ctx.httpStatus) ? ctx.httpStatus : null),
    requestId: ctx.requestId || null,
    attemptNumber: ctx.attemptNumber,
    maximumAttempts: ctx.maximumAttempts,
    occurredAt: ctx.occurredAt || null,
    cause: err,
  });
}

export default {
  ProviderError,
  normalizeProviderError,
  classifyHttpStatus,
  isRetryableCategory,
  isProviderError,
  userMessageFor,
  nextActionFor,
  shortCategoryLabel,
};
