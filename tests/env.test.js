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

test('env: reports Meta available only when fully configured (incl. graph version)', () => {
  const fullyConfigured = {
    META_APP_ID: 'app-id',
    META_APP_SECRET: 'app-secret',
    META_REDIRECT_URI: 'http://localhost:3000/oauth/meta/callback',
    META_GRAPH_API_VERSION: 'v21.0',
  };
  const ok = buildConfig(validRawEnv(fullyConfigured));
  assert.equal(ok.providerAvailability.meta, true);
  assert.equal(ok.config.providers.meta.graphVersion, 'v21.0');
});

// --- No invented defaults --------------------------------------------------

test('env: does not invent an OpenAI model default', () => {
  const { config } = buildConfig(validRawEnv()); // no OPENAI_* set
  assert.equal(config.openai.textModel, '');
  assert.equal(config.openai.available, false);
});

test('env: does not invent a Meta Graph API version default', () => {
  const { config } = buildConfig(validRawEnv()); // no META_* set
  // Unset → falsy (empty string), never a hardcoded version like "v21.0".
  assert.ok(!config.providers.meta.graphVersion);
  assert.doesNotMatch(String(config.providers.meta.graphVersion), /^v\d/);
});

// --- OpenAI model required when enabled ------------------------------------

test('env: OpenAI key without a model is unavailable in development (no throw)', () => {
  const { config, providerAvailability } = buildConfig(
    validRawEnv({ NODE_ENV: 'development', OPENAI_API_KEY: 'sk-test-key' }),
  );
  assert.equal(providerAvailability.openai, false);
  assert.equal(config.openai.textModel, '');
});

test('env: OpenAI key without a model FAILS in production', () => {
  assert.throws(
    () => buildConfig(validRawEnv({ NODE_ENV: 'production', OPENAI_API_KEY: 'sk-test-key' })),
    /OPENAI_TEXT_MODEL is required/,
  );
});

test('env: OpenAI available when key and model are both set', () => {
  const { providerAvailability } = buildConfig(
    validRawEnv({ OPENAI_API_KEY: 'sk-test-key', OPENAI_TEXT_MODEL: 'some-model' }),
  );
  assert.equal(providerAvailability.openai, true);
});

// --- Meta graph version required when enabled ------------------------------

test('env: partial Meta config is unavailable in development (no throw)', () => {
  const { providerAvailability } = buildConfig(
    validRawEnv({
      NODE_ENV: 'development',
      META_APP_ID: 'app-id',
      META_APP_SECRET: 'app-secret',
      META_REDIRECT_URI: 'http://localhost:3000/oauth/meta/callback',
      // META_GRAPH_API_VERSION intentionally missing
    }),
  );
  assert.equal(providerAvailability.meta, false);
});

test('env: enabled Meta missing the graph version FAILS in production', () => {
  assert.throws(
    () =>
      buildConfig(
        validRawEnv({
          NODE_ENV: 'production',
          META_APP_ID: 'app-id',
          META_APP_SECRET: 'app-secret',
          META_REDIRECT_URI: 'https://example.com/oauth/meta/callback',
          // META_GRAPH_API_VERSION intentionally missing
        }),
      ),
    /META_GRAPH_API_VERSION/,
  );
});

test('env: production with no provider config does not fail (providers simply unavailable)', () => {
  const { providerAvailability } = buildConfig(validRawEnv({ NODE_ENV: 'production' }));
  assert.equal(providerAvailability.meta, false);
  assert.equal(providerAvailability.instagram, false);
  assert.equal(providerAvailability.threads, false);
  assert.equal(providerAvailability.openai, false);
});

// --- Phase 3: per-provider Graph API versions + OAuth config ---------------

function fullMeta(overrides = {}) {
  return {
    META_APP_ID: 'meta-id',
    META_APP_SECRET: 'meta-secret',
    META_REDIRECT_URI: 'https://cyflow.cyfrow.net/api/oauth/meta/callback',
    META_GRAPH_API_VERSION: 'v21.0',
    ...overrides,
  };
}
function fullInstagram(overrides = {}) {
  return {
    INSTAGRAM_APP_ID: 'ig-id',
    INSTAGRAM_APP_SECRET: 'ig-secret',
    INSTAGRAM_REDIRECT_URI: 'https://cyflow.cyfrow.net/api/oauth/instagram/callback',
    INSTAGRAM_GRAPH_API_VERSION: 'v21.0',
    ...overrides,
  };
}
function fullThreads(overrides = {}) {
  return {
    THREADS_APP_ID: 'th-id',
    THREADS_APP_SECRET: 'th-secret',
    THREADS_REDIRECT_URI: 'https://cyflow.cyfrow.net/api/oauth/threads/callback',
    THREADS_GRAPH_API_VERSION: 'v1.0',
    ...overrides,
  };
}

test('env: instagram/threads available only when their graph version is set', () => {
  const ok = buildConfig(validRawEnv({ ...fullInstagram(), ...fullThreads() }));
  assert.equal(ok.providerAvailability.instagram, true);
  assert.equal(ok.providerAvailability.threads, true);
  assert.equal(ok.config.providers.instagram.graphVersion, 'v21.0');
  assert.equal(ok.config.providers.threads.graphVersion, 'v1.0');

  // Missing the instagram graph version -> unavailable in development.
  const missing = buildConfig(
    validRawEnv({ ...fullInstagram({ INSTAGRAM_GRAPH_API_VERSION: '' }) }),
  );
  assert.equal(missing.providerAvailability.instagram, false);
});

test('env: instagram uses its own version key, not META_GRAPH_API_VERSION', () => {
  const { config } = buildConfig(
    validRawEnv({
      ...fullInstagram({ INSTAGRAM_GRAPH_API_VERSION: 'vIG' }),
      META_GRAPH_API_VERSION: 'vMETA',
    }),
  );
  assert.equal(config.providers.instagram.graphVersion, 'vIG');
});

test('env: enabled provider missing graph version FAILS in production', () => {
  assert.throws(
    () =>
      buildConfig(
        validRawEnv({ NODE_ENV: 'production', ...fullThreads({ THREADS_GRAPH_API_VERSION: '' }) }),
      ),
    /THREADS_GRAPH_API_VERSION/,
  );
});

test('env: production rejects a non-HTTPS redirect URI', () => {
  assert.throws(
    () =>
      buildConfig(
        validRawEnv({
          NODE_ENV: 'production',
          ...fullMeta({ META_REDIRECT_URI: 'http://cyflow.cyfrow.net/api/oauth/meta/callback' }),
        }),
      ),
    /HTTPS/,
  );
});

test('env: OAuth settings have sane defaults and coerce numbers', () => {
  const { config } = buildConfig(validRawEnv());
  assert.equal(config.oauth.stateTtlMinutes, 10);
  assert.equal(config.oauth.httpTimeoutMs, 30000);
  assert.equal(config.oauth.tokenRefreshLeewayMinutes, 10);

  const custom = buildConfig(
    validRawEnv({ OAUTH_STATE_TTL_MINUTES: '5', OAUTH_HTTP_TIMEOUT_MS: '12000' }),
  );
  assert.strictEqual(custom.config.oauth.stateTtlMinutes, 5);
  assert.strictEqual(custom.config.oauth.httpTimeoutMs, 12000);
});
