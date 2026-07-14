/**
 * Test environment bootstrap.
 *
 * Import this module FIRST in any test that (transitively) loads
 * `src/config/env.js`, because that module validates `process.env` at import
 * time. Setting values here — before env.js is evaluated — keeps tests
 * hermetic and independent of any real `.env` file.
 *
 * These are throwaway, non-secret test values. No real credentials are used.
 */

import { Buffer } from 'node:buffer';

function setDefault(key, value) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

setDefault('NODE_ENV', 'test');
setDefault('PORT', '3000');
setDefault('PUBLIC_BASE_URL', 'http://localhost:3000');

setDefault('DB_HOST', '127.0.0.1');
setDefault('DB_PORT', '3306');
setDefault('DB_USER', 'test_user');
setDefault('DB_PASSWORD', 'test_password_value');
setDefault('DB_NAME', 'cyflow_social_test');
setDefault('DB_CONNECTION_LIMIT', '5');

setDefault('SESSION_SECRET', 'test-session-secret-value');
setDefault('SESSION_COOKIE_NAME', 'cyflow_social_session');
setDefault('SESSION_MAX_AGE_MS', '604800000');
setDefault('BCRYPT_ROUNDS', '10');

// A valid, deterministic 32-byte key (base64) for tests only.
setDefault('ENCRYPTION_KEY_BASE64', Buffer.alloc(32, 7).toString('base64'));

setDefault('SCHEDULER_ENABLED', 'true');

/** A complete, valid raw-env object for exercising buildConfig() directly. */
export function validRawEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'test_user',
    DB_PASSWORD: 'test_password_value',
    DB_NAME: 'cyflow_social_test',
    DB_CONNECTION_LIMIT: '5',
    SESSION_SECRET: 'test-session-secret-value',
    SESSION_COOKIE_NAME: 'cyflow_social_session',
    SESSION_MAX_AGE_MS: '604800000',
    BCRYPT_ROUNDS: '10',
    ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    SCHEDULER_ENABLED: 'true',
    ...overrides,
  };
}

export default { validRawEnv };
