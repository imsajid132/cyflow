// The normalized provider-error model: classification, safe messages, redaction.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ProviderError,
  normalizeProviderError,
  classifyHttpStatus,
  isRetryableCategory,
  userMessageFor,
  shortCategoryLabel,
} from '../src/utils/providerErrors.js';
import { logProviderEvent, logProviderFailure } from '../src/utils/providerLog.js';
import {
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ValidationError,
  ExternalServiceError,
} from '../src/utils/errors.js';
import { PROVIDER_ERROR_CATEGORY as CAT, PROVIDER_NAMES } from '../src/config/constants.js';

test('HTTP status maps to the right category, including 402', () => {
  assert.equal(classifyHttpStatus(401), CAT.AUTHENTICATION_FAILED);
  assert.equal(classifyHttpStatus(402), CAT.PAYMENT_REQUIRED);
  assert.equal(classifyHttpStatus(403), CAT.PERMISSION_DENIED);
  assert.equal(classifyHttpStatus(408), CAT.NETWORK_TIMEOUT);
  assert.equal(classifyHttpStatus(429), CAT.RATE_LIMITED);
  assert.equal(classifyHttpStatus(400), CAT.REQUEST_INVALID);
  assert.equal(classifyHttpStatus(422), CAT.REQUEST_INVALID);
  assert.equal(classifyHttpStatus(500), CAT.PROVIDER_UNAVAILABLE);
  assert.equal(classifyHttpStatus(503), CAT.PROVIDER_UNAVAILABLE);
});

test('retryable is derived correctly per category', () => {
  assert.equal(isRetryableCategory(CAT.RATE_LIMITED), true);
  assert.equal(isRetryableCategory(CAT.PROVIDER_UNAVAILABLE), true);
  assert.equal(isRetryableCategory(CAT.NETWORK_TIMEOUT), true);
  assert.equal(isRetryableCategory(CAT.RENDER_FAILED), true);
  // Standing conditions must NOT be retried.
  assert.equal(isRetryableCategory(CAT.AUTHENTICATION_FAILED), false);
  assert.equal(isRetryableCategory(CAT.CREDITS_EXHAUSTED), false);
  assert.equal(isRetryableCategory(CAT.PAYMENT_REQUIRED), false);
  assert.equal(isRetryableCategory(CAT.REQUEST_INVALID), false);
  assert.equal(isRetryableCategory(CAT.CREDENTIALS_MISSING), false);
});

test('a ProviderError built from an HCTI 402 reads as a credit problem', () => {
  const err = new ProviderError({
    provider: PROVIDER_NAMES.HCTI,
    operation: 'render_social_image',
    category: CAT.CREDITS_EXHAUSTED,
    httpStatus: 402,
    attemptNumber: 2,
    maximumAttempts: 2,
  });
  assert.equal(err.retryable, false);
  assert.equal(err.shortLabel, 'Credits exhausted');
  assert.match(err.userMessage, /credits may be exhausted/i);
  assert.match(err.userMessage, /HCTI/);
});

test('normalizeProviderError folds AppError subclasses to categories', () => {
  const cases = [
    [new AuthenticationError('rejected'), CAT.AUTHENTICATION_FAILED],
    [new AuthorizationError('no'), CAT.PERMISSION_DENIED],
    [new RateLimitError('slow down'), CAT.RATE_LIMITED],
    [new ValidationError('bad'), CAT.REQUEST_INVALID],
    [new ExternalServiceError('down'), CAT.PROVIDER_UNAVAILABLE],
  ];
  for (const [raw, expected] of cases) {
    const pe = normalizeProviderError(raw, { provider: PROVIDER_NAMES.HCTI, operation: 'render_social_image' });
    assert.equal(pe.category, expected, `${raw.name} -> ${expected}`);
    assert.equal(pe.provider, PROVIDER_NAMES.HCTI);
  }
});

test('normalizeProviderError folds legacy .classification tokens', () => {
  const cases = [
    ['invalid_credentials', CAT.AUTHENTICATION_FAILED],
    ['hcti_not_configured', CAT.CREDENTIALS_MISSING],
    ['image_generation_failed', CAT.RENDER_FAILED],
    ['quota_exceeded', CAT.QUOTA_EXCEEDED],
    ['timeout', CAT.NETWORK_TIMEOUT],
  ];
  for (const [classification, expected] of cases) {
    const raw = Object.assign(new Error('x'), { classification });
    const pe = normalizeProviderError(raw, { provider: PROVIDER_NAMES.OPENAI });
    assert.equal(pe.category, expected, `${classification} -> ${expected}`);
  }
});

test('normalizeProviderError recognizes Node network + abort errors', () => {
  const timeout = normalizeProviderError(Object.assign(new Error('aborted'), { name: 'AbortError' }), { provider: PROVIDER_NAMES.HCTI });
  assert.equal(timeout.category, CAT.NETWORK_TIMEOUT);
  const refused = normalizeProviderError(Object.assign(new Error('nope'), { code: 'ECONNREFUSED' }), { provider: PROVIDER_NAMES.HCTI });
  assert.equal(refused.category, CAT.NETWORK_FAILURE);
});

test('normalizeProviderError reads an HTTP status carried on the error', () => {
  const raw = Object.assign(new Error('boom'), { status: 429 });
  const pe = normalizeProviderError(raw, { provider: PROVIDER_NAMES.HCTI, operation: 'render_social_image' });
  assert.equal(pe.category, CAT.RATE_LIMITED);
  assert.equal(pe.httpStatus, 429);
});

test('normalizeProviderError is idempotent and only enriches context', () => {
  const first = new ProviderError({ provider: PROVIDER_NAMES.HCTI, category: CAT.RENDER_FAILED });
  const again = normalizeProviderError(first, { attemptNumber: 2, maximumAttempts: 2, requestId: 'req-1' });
  assert.equal(again, first, 'same instance');
  assert.equal(again.attemptNumber, 2);
  assert.equal(again.maximumAttempts, 2);
  assert.equal(again.requestId, 'req-1');
  assert.equal(again.category, CAT.RENDER_FAILED, 'category not overwritten');
});

test('toSafeJSON carries the safe fields and no secrets, cause or stack', () => {
  const secretCause = new Error('Authorization: Basic c2VjcmV0OmtleQ==');
  const err = new ProviderError({
    provider: PROVIDER_NAMES.HCTI,
    operation: 'render_social_image',
    category: CAT.AUTHENTICATION_FAILED,
    httpStatus: 401,
    requestId: 'req-9',
    attemptNumber: 1,
    maximumAttempts: 2,
    cause: secretCause,
  });
  const safe = err.toSafeJSON();
  assert.deepEqual(Object.keys(safe).sort(), [
    'attemptNumber', 'category', 'errorCode', 'httpStatus', 'maximumAttempts',
    'nextAction', 'occurredAt', 'operation', 'operatorMessage', 'provider',
    'requestId', 'retryable', 'shortLabel', 'userMessage',
  ].sort());
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('Authorization'), false);
  assert.equal(serialized.includes('c2VjcmV0'), false);
  assert.equal('cause' in safe, false);
  assert.equal('stack' in safe, false);
});

test('userMessageFor gives provider-specific, actionable, secret-free lines', () => {
  assert.match(userMessageFor(PROVIDER_NAMES.HCTI, CAT.AUTHENTICATION_FAILED), /HCTI credentials were rejected/i);
  assert.match(userMessageFor(PROVIDER_NAMES.OPENAI, CAT.AUTHENTICATION_FAILED), /OpenAI rejected the API key/i);
  assert.match(userMessageFor(PROVIDER_NAMES.HCTI, CAT.CREDITS_EXHAUSTED), /credits may be exhausted/i);
  assert.match(userMessageFor(PROVIDER_NAMES.HCTI, CAT.NETWORK_TIMEOUT), /did not respond in time/i);
  assert.equal(shortCategoryLabel(CAT.MEDIA_PERSISTENCE_FAILED), 'Media storage error');
});

test('logProviderEvent emits only allow-listed fields (no secrets leak)', () => {
  const lines = [];
  const orig = console.warn;
  console.warn = (t) => lines.push(t);
  try {
    logProviderEvent('provider_operation_failed', {
      provider: 'hcti',
      category: 'credits_exhausted',
      httpStatus: 402,
      retryable: false,
      apiKey: 'sk-should-not-appear',
      authorization: 'Basic leak',
      caption: 'private post copy',
    });
  } finally {
    console.warn = orig;
  }
  assert.equal(lines.length, 1);
  const obj = JSON.parse(lines[0]);
  assert.equal(obj.event, 'provider_operation_failed');
  assert.equal(obj.provider, 'hcti');
  assert.equal(obj.category, 'credits_exhausted');
  assert.equal(obj.httpStatus, 402);
  assert.equal('apiKey' in obj, false);
  assert.equal('authorization' in obj, false);
  assert.equal('caption' in obj, false);
  assert.equal(lines[0].includes('sk-should-not-appear'), false);
  assert.equal(lines[0].includes('private post copy'), false);
});

test('logProviderFailure serializes a ProviderError safely', () => {
  const lines = [];
  const orig = console.warn;
  console.warn = (t) => lines.push(t);
  try {
    const err = new ProviderError({
      provider: PROVIDER_NAMES.HCTI,
      operation: 'render_social_image',
      category: CAT.CREDITS_EXHAUSTED,
      httpStatus: 402,
      cause: new Error('secret: Basic abc'),
    });
    logProviderFailure(err, { jobType: 'generate_automation_slot', attempt: 2 });
  } finally {
    console.warn = orig;
  }
  const obj = JSON.parse(lines[0]);
  assert.equal(obj.provider, 'hcti');
  assert.equal(obj.category, 'credits_exhausted');
  assert.equal(obj.jobType, 'generate_automation_slot');
  assert.equal(obj.attempt, 2);
  assert.equal(lines[0].includes('secret'), false);
});
