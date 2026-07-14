/**
 * Rate-limit factories (express-rate-limit v7).
 *
 * `createRateLimiter(options)` returns configured middleware that emits the
 * standard API error envelope on limit. Presets for common scenarios (general
 * API, auth attempts, expensive generation) are exported too.
 */

import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '../config/constants.js';
import { config } from '../config/env.js';

// In the test environment the mounted limiters are pass-throughs so the suite
// is not flaky; rate-limit behavior itself is covered by an isolated test that
// builds a dedicated limiter via createRateLimiter().
const IS_TEST = config.env === 'test';

/** Key by authenticated user id + IP when available, else IP only. */
function userOrIpKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return req.user?.id ? `${req.user.id}:${ip}` : ip;
}

/** Return a real limiter, or a no-op passthrough under NODE_ENV=test. */
function limiter(options) {
  if (IS_TEST) return (req, res, next) => next();
  return createRateLimiter(options);
}

/**
 * Build a rate limiter.
 * @param {object} [options]
 * @param {number} [options.windowMs=900000] window in ms (default 15 min)
 * @param {number} [options.max=100] max requests per window per key
 * @param {string} [options.message] safe client message
 * @param {(req: import('express').Request) => string} [options.keyGenerator]
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests, please try again later',
    keyGenerator,
  } = options;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    // A custom key generator intentionally combines user id + IP; disable the
    // library's dev-time validations for those cases (they otherwise error on
    // the custom keyGenerator). Default limiters keep validations enabled.
    validate: keyGenerator ? false : undefined,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: ERROR_CODES.RATE_LIMIT_EXCEEDED, message },
        requestId: req.id ?? null,
      });
    },
  });
}

/** General-purpose API limiter. */
export const generalApiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
});

/** Stricter limiter for authentication endpoints (brute-force protection). */
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts, please try again later',
});

/** Tight limiter for expensive content-generation endpoints (later phases). */
export const generationLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Generation rate limit reached, please slow down',
});

// --- Phase 2 auth/HCTI limiters (no-op under NODE_ENV=test) ----------------

/** Registration: 5 attempts / hour / IP. */
export const registerLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many registration attempts, please try again later',
});

/** Login: 10 attempts / 15 minutes / IP (brute-force protection). */
export const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, please try again later',
});

/** Password change: 5 attempts / hour / user+IP. */
export const passwordChangeLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: userOrIpKey,
  message: 'Too many password change attempts, please try again later',
});

/** HCTI credential save: 10 / hour / user+IP. */
export const hctiSaveLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: userOrIpKey,
  message: 'Too many credential updates, please try again later',
});

/** HCTI credential test: 5 / 15 minutes / user+IP (consumes renders). */
export const hctiTestLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: userOrIpKey,
  message: 'Too many credential tests, please try again later',
});

export default {
  createRateLimiter,
  generalApiLimiter,
  authLimiter,
  generationLimiter,
  registerLimiter,
  loginLimiter,
  passwordChangeLimiter,
  hctiSaveLimiter,
  hctiTestLimiter,
};
