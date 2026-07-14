/**
 * Rate-limit factories (express-rate-limit v7).
 *
 * `createRateLimiter(options)` returns configured middleware that emits the
 * standard API error envelope on limit. Presets for common scenarios (general
 * API, auth attempts, expensive generation) are exported too.
 */

import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '../config/constants.js';

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

export default {
  createRateLimiter,
  generalApiLimiter,
  authLimiter,
  generationLimiter,
};
