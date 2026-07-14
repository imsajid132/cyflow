// Load a valid test env before importing config/env.js (validates at import).
import './helpers/setupEnv.js';
import { validRawEnv } from './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildConfig } from '../src/config/env.js';

test('env: accepts a valid 32-byte base64 encryption key', () => {
  const { config } = buildConfig(validRawEnv());
  assert.ok(Buffer.isBuffer(config.encryptionKey));
  assert.equal(config.encryptionKey.length, 32);
});

test('env: rejects an encryption key that is not 32 bytes', () => {
  const bad = validRawEnv({ ENCRYPTION_KEY_BASE64: Buffer.alloc(16, 1).toString('base64') });
  assert.throws(() => buildConfig(bad), /32 bytes/);
});

test('env: rejects a missing encryption key', () => {
  const bad = validRawEnv({ ENCRYPTION_KEY_BASE64: '' });
  assert.throws(() => buildConfig(bad));
});

test('env: rejects an invalid PUBLIC_BASE_URL', () => {
  const bad = validRawEnv({ PUBLIC_BASE_URL: 'not a url' });
  assert.throws(() => buildConfig(bad), /Invalid URL/);
});

test('env: coerces numeric variables to numbers', () => {
  const { config } = buildConfig(validRawEnv({ PORT: '8080', DB_PORT: '3307', DB_CONNECTION_LIMIT: '7' }));
  assert.strictEqual(config.port, 8080);
  assert.strictEqual(config.db.port, 3307);
  assert.strictEqual(config.db.connectionLimit, 7);
});

test('env: rejects a non-numeric PORT', () => {
  assert.throws(() => buildConfig(validRawEnv({ PORT: 'abc' })));
});

test('env: coerces boolean variables', () => {
  const off = buildConfig(validRawEnv({ SCHEDULER_ENABLED: 'false' }));
  assert.strictEqual(off.config.scheduler.enabled, false);
  const on = buildConfig(validRawEnv({ SCHEDULER_ENABLED: 'true' }));
  assert.strictEqual(on.config.scheduler.enabled, true);
});

test('env: reports providers unavailable when credentials are absent', () => {
  const { providerAvailability } = buildConfig(validRawEnv());
  assert.equal(providerAvailability.meta, false);
  assert.equal(providerAvailability.instagram, false);
  assert.equal(providerAvailability.threads, false);
  assert.equal(providerAvailability.openai, false);
});

test('env: reports a provider available when fully configured', () => {
  const { providerAvailability } = buildConfig(
    validRawEnv({
      META_APP_ID: 'app-id',
      META_APP_SECRET: 'app-secret',
      META_REDIRECT_URI: 'http://localhost:3000/oauth/meta/callback',
    }),
  );
  assert.equal(providerAvailability.meta, true);
});
