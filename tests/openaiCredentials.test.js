/**
 * Milestone C1 — a customer's OpenAI key is theirs, and only theirs.
 *
 * THE DEFECT. openaiContentService built ONE client from config.openai.apiKey —
 * a single global application key — and cached it in module state:
 *
 *     let cachedClient = client;
 *     function getClient() {
 *       if (cachedClient) return cachedClient;
 *       cachedClient = new OpenAI({ apiKey: config.openai.apiKey, ... });
 *     }
 *
 * Every customer's generation ran on that credential and billed one account.
 * The rule "never silently use a global application key" was not merely
 * violated, it was the only code path there was.
 *
 * These tests drive the REAL resolver against a fake integration repository and
 * a fake client builder, so the credential logic is exercised rather than
 * stubbed. The planner fakes elsewhere inject a client and never reach this
 * code — which is exactly why it needs its own tests.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAiClientResolver, resolveModel, OPENAI_NOT_CONFIGURED_MESSAGE } from '../src/services/openaiClientResolver.js';
import { encryptSecret, decryptSecret } from '../src/services/encryptionService.js';
import { OPENAI_MODELS } from '../src/config/constants.js';

const ALICE = '1';
const BOB = '2';
const ALICE_KEY = 'sk-test-alice-0000000000000000000000000000000000000AAAA';
const BOB_KEY = 'sk-test-bob-11111111111111111111111111111111111111BBBB';

/** An in-memory user_integrations, with the same surface as the real repository. */
function fakeIntegrations(rows = {}) {
  const store = new Map(Object.entries(rows));
  return {
    _store: store,
    async getOpenAiCredentialRecord(userId) {
      const r = store.get(String(userId));
      if (!r) return null;
      return {
        encryptedApiKey: r.encryptedApiKey ?? null,
        encryptionVersion: r.encryptionVersion ?? 1,
        model: r.model ?? null,
        verifiedAt: r.verifiedAt ?? null,
        configured: r.encryptedApiKey != null,
      };
    },
    async hasConfiguredOpenAiCredentials(userId) {
      return store.get(String(userId))?.encryptedApiKey != null;
    },
  };
}

const cfg = (over = {}) => ({
  env: 'production',
  openai: {
    apiKey: 'sk-GLOBAL-application-key-that-must-never-serve-a-customer',
    textModel: 'gpt-4o-mini',
    available: true,
    requestTimeoutMs: 1000,
    allowLegacyGlobalKey: false,
    ...(over.openai ?? {}),
  },
  ...(over.env ? { env: over.env } : {}),
});

/** Captures the apiKey it was handed, so a test can prove WHOSE key was used. */
function spyBuilder() {
  const calls = [];
  const build = ({ apiKey, userId }) => {
    calls.push({ apiKey, userId });
    return { __fakeClient: true, userId };
  };
  return { build, calls };
}

// --- encryption at rest ------------------------------------------------------

test('the key is stored as an envelope, never as plaintext', () => {
  const envelope = encryptSecret(ALICE_KEY);
  assert.ok(!envelope.includes(ALICE_KEY), 'the plaintext key is present in the stored value');
  assert.match(envelope, /^v1:[^:]+:[^:]+:[^:]+$/, 'expected v1:<iv>:<tag>:<ciphertext>');
  assert.equal(decryptSecret(envelope), ALICE_KEY, 'it must still round-trip');
});

test('replacing a key produces a different envelope and a fresh IV', () => {
  // Same plaintext, encrypted twice. If the IV were reused the envelopes would
  // match, and identical ciphertext across users would leak that they share a
  // key.
  const a = encryptSecret(ALICE_KEY);
  const b = encryptSecret(ALICE_KEY);
  assert.notEqual(a, b, 'two encryptions of the same key must not be identical');
  assert.notEqual(a.split(':')[1], b.split(':')[1], 'the IV must be fresh every time');
  assert.equal(decryptSecret(a), decryptSecret(b));
});

// --- the customer's own key, and nobody else's -------------------------------

test('a user generates with their OWN key', async () => {
  const spy = spyBuilder();
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({
      [ALICE]: { encryptedApiKey: encryptSecret(ALICE_KEY) },
      [BOB]: { encryptedApiKey: encryptSecret(BOB_KEY) },
    }),
    config: cfg(),
    buildClient: spy.build,
  });

  const a = await resolver.resolveForUser(ALICE);
  assert.equal(a.source, 'customer');
  assert.equal(spy.calls[0].apiKey, ALICE_KEY);

  const b = await resolver.resolveForUser(BOB);
  assert.equal(spy.calls[1].apiKey, BOB_KEY);
  assert.notEqual(spy.calls[0].apiKey, spy.calls[1].apiKey, 'two users must not share a key');
});

test('one user never receives another user\'s key', async () => {
  const spy = spyBuilder();
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({ [ALICE]: { encryptedApiKey: encryptSecret(ALICE_KEY) } }),
    config: cfg(),
    buildClient: spy.build,
  });

  // Bob has no key. He must be refused — NOT handed Alice's.
  await assert.rejects(() => resolver.resolveForUser(BOB), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, OPENAI_NOT_CONFIGURED_MESSAGE);
    return true;
  });
  assert.equal(spy.calls.length, 0, 'a refused user must not cause a client to be built');
});

test('nothing is cached across users', async () => {
  // The original defect was a module-level `cachedClient`: whoever built it
  // first won, for everyone, until restart.
  const spy = spyBuilder();
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({
      [ALICE]: { encryptedApiKey: encryptSecret(ALICE_KEY) },
      [BOB]: { encryptedApiKey: encryptSecret(BOB_KEY) },
    }),
    config: cfg(),
    buildClient: spy.build,
  });

  await resolver.resolveForUser(ALICE);
  await resolver.resolveForUser(BOB);
  await resolver.resolveForUser(ALICE);

  assert.deepEqual(spy.calls.map((c) => c.apiKey), [ALICE_KEY, BOB_KEY, ALICE_KEY]);
});

// --- the global key is gone ---------------------------------------------------

test('in PRODUCTION a missing customer key is refused, never served the global key', async () => {
  const spy = spyBuilder();
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({}),
    // Global key present and "available" — exactly the old happy path.
    config: cfg({ env: 'production' }),
    buildClient: spy.build,
  });

  await assert.rejects(() => resolver.resolveForUser(ALICE), (err) => {
    assert.equal(err.message, OPENAI_NOT_CONFIGURED_MESSAGE);
    return true;
  });
  assert.equal(spy.calls.length, 0, 'the global key was used for a customer');
  assert.equal(await resolver.isAvailableForUser(ALICE), false);
});

test('the legacy global key stays off even when the flag is set, if the env is production', async () => {
  // Two independent conditions, both required. A .env copied from a laptop to a
  // server is the ordinary way a dev switch goes live; this is what makes that
  // mistake harmless.
  const spy = spyBuilder();
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({}),
    config: cfg({ env: 'production', openai: { allowLegacyGlobalKey: true } }),
    buildClient: spy.build,
  });
  assert.equal(resolver.legacyGlobalKeyAllowed(), false);
  await assert.rejects(() => resolver.resolveForUser(ALICE));
  assert.equal(spy.calls.length, 0);
});

test('the legacy global key is off by default outside production too', async () => {
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({}),
    config: { ...cfg(), env: 'development' },
    buildClient: spyBuilder().build,
  });
  // allowLegacyGlobalKey defaults to false: the safe state is the one you get
  // by doing nothing.
  assert.equal(resolver.legacyGlobalKeyAllowed(), false);
  await assert.rejects(() => resolver.resolveForUser(ALICE));
});

test('the legacy global key works ONLY when explicitly enabled AND not production', async () => {
  const spy = spyBuilder();
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({}),
    config: { ...cfg({ openai: { allowLegacyGlobalKey: true } }), env: 'development' },
    buildClient: spy.build,
  });
  assert.equal(resolver.legacyGlobalKeyAllowed(), true);

  const r = await resolver.resolveForUser(ALICE);
  assert.equal(r.source, 'legacy-global', 'the source must be reported honestly');
  assert.equal(spy.calls[0].apiKey, cfg().openai.apiKey);
  assert.equal(await resolver.isAvailableForUser(ALICE), true);
});

test('a customer key always wins over the legacy global key', async () => {
  const spy = spyBuilder();
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({ [ALICE]: { encryptedApiKey: encryptSecret(ALICE_KEY) } }),
    config: { ...cfg({ openai: { allowLegacyGlobalKey: true } }), env: 'development' },
    buildClient: spy.build,
  });
  const r = await resolver.resolveForUser(ALICE);
  assert.equal(r.source, 'customer');
  assert.equal(spy.calls[0].apiKey, ALICE_KEY);
});

// --- a broken envelope must not fall through ---------------------------------

test('a key that will not decrypt is refused, not replaced by the global key', async () => {
  /*
   * Wrong key, tampered row, or an envelope version this build cannot read.
   * Falling through to the global key would bill a different account for this
   * customer's work AND hide a real problem behind a working feature.
   */
  const spy = spyBuilder();
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({ [ALICE]: { encryptedApiKey: 'v1:not:a:valid-envelope' } }),
    config: { ...cfg({ openai: { allowLegacyGlobalKey: true } }), env: 'development' },
    buildClient: spy.build,
  });

  await assert.rejects(() => resolver.resolveForUser(ALICE), (err) => {
    assert.match(err.message, /could not be read/);
    return true;
  });
  assert.equal(spy.calls.length, 0, 'it fell through to another credential');
});

test('a resolver error never contains the key or the envelope', async () => {
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({ [ALICE]: { encryptedApiKey: 'v1:not:a:valid-envelope' } }),
    config: cfg(),
  });
  const err = await resolver.resolveForUser(ALICE).catch((e) => e);
  const text = `${err.message} ${err.stack ?? ''}`;
  assert.ok(!text.includes('v1:not:a:valid-envelope'), 'the envelope leaked into an error');
  assert.ok(!text.includes(ALICE_KEY));
});

test('the resolver never returns the key to its caller', async () => {
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({ [ALICE]: { encryptedApiKey: encryptSecret(ALICE_KEY) } }),
    config: cfg(),
    buildClient: spyBuilder().build,
  });
  const r = await resolver.resolveForUser(ALICE);
  assert.deepEqual(Object.keys(r).sort(), ['client', 'model', 'source']);
  assert.ok(!JSON.stringify(r).includes(ALICE_KEY), 'the key is reachable from the return value');
});

// --- models -------------------------------------------------------------------

test('a stored model is honoured only while it is still supported', () => {
  assert.equal(resolveModel('gpt-4o', 'gpt-4o-mini'), 'gpt-4o');
  // An unsupported string would fail at generation time, after the spend, on the
  // customer's bill. It falls back instead.
  assert.equal(resolveModel('some-model-we-removed', 'gpt-4o-mini'), 'gpt-4o-mini');
  assert.equal(resolveModel(null, 'gpt-4o-mini'), 'gpt-4o-mini');
  for (const m of OPENAI_MODELS) assert.equal(resolveModel(m, 'gpt-4o-mini'), m);
});

test('a user\'s selected model is used', async () => {
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({
      [ALICE]: { encryptedApiKey: encryptSecret(ALICE_KEY), model: 'gpt-4o' },
    }),
    config: cfg(),
    buildClient: spyBuilder().build,
  });
  assert.equal((await resolver.resolveForUser(ALICE)).model, 'gpt-4o');
});

// --- availability -------------------------------------------------------------

test('availability is per user, and never decrypts to answer', async () => {
  const resolver = createOpenAiClientResolver({
    integrations: fakeIntegrations({ [ALICE]: { encryptedApiKey: encryptSecret(ALICE_KEY) } }),
    config: cfg(),
    buildClient: spyBuilder().build,
  });
  assert.equal(await resolver.isAvailableForUser(ALICE), true);
  assert.equal(await resolver.isAvailableForUser(BOB), false);
});

test('a repository failure reports unavailable rather than throwing', async () => {
  const resolver = createOpenAiClientResolver({
    integrations: {
      async getOpenAiCredentialRecord() { throw new Error('db down'); },
      async hasConfiguredOpenAiCredentials() { throw new Error('db down'); },
    },
    config: cfg(),
  });
  assert.equal(await resolver.isAvailableForUser(ALICE), false);
  await assert.rejects(() => resolver.resolveForUser(ALICE), (err) => {
    assert.equal(err.message, OPENAI_NOT_CONFIGURED_MESSAGE);
    return true;
  });
});
