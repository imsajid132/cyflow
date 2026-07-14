import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateStateRow } from '../src/repositories/oauthStateRepository.js';
import { createOAuthService } from '../src/services/oauthService.js';
import { hashOAuthState } from '../src/services/encryptionService.js';
import { toMysqlUtc } from '../src/utils/time.js';
import {
  createFakeOAuthStateRepository,
  createFakeSocialAccountRepository,
  createFakeProviderRegistry,
  fakeWithTransaction,
} from './helpers/fakes.js';

const noopLogging = { record: async () => {} };
const future = () => toMysqlUtc(new Date(Date.now() + 600_000));
const past = () => toMysqlUtc(new Date(Date.now() - 600_000));

function row(overrides = {}) {
  return {
    id: '1',
    user_id: '10',
    provider: 'meta',
    consumed_at: null,
    expires_at: future(),
    ...overrides,
  };
}

test('evaluateStateRow: accepts a valid row', () => {
  assert.deepEqual(evaluateStateRow(row(), { provider: 'meta', expectedUserId: '10', nowMs: Date.now() }), { ok: true });
});

test('evaluateStateRow: rejects missing, provider mismatch, consumed, expired, cross-user', () => {
  const now = Date.now();
  assert.equal(evaluateStateRow(null, { provider: 'meta', expectedUserId: '10', nowMs: now }).reason, 'not_found');
  assert.equal(
    evaluateStateRow(row({ provider: 'instagram' }), { provider: 'meta', expectedUserId: '10', nowMs: now }).reason,
    'provider_mismatch',
  );
  assert.equal(
    evaluateStateRow(row({ consumed_at: '2026-01-01 00:00:00' }), { provider: 'meta', expectedUserId: '10', nowMs: now }).reason,
    'already_consumed',
  );
  assert.equal(
    evaluateStateRow(row({ expires_at: past() }), { provider: 'meta', expectedUserId: '10', nowMs: now }).reason,
    'expired',
  );
  assert.equal(
    evaluateStateRow(row(), { provider: 'meta', expectedUserId: '999', nowMs: now }).reason,
    'user_mismatch',
  );
});

function buildService(oauthStates = createFakeOAuthStateRepository()) {
  return {
    oauthStates,
    svc: createOAuthService({
      registry: createFakeProviderRegistry(),
      oauthStates,
      socialAccounts: createFakeSocialAccountRepository(),
      logging: noopLogging,
      withTransaction: fakeWithTransaction,
    }),
  };
}

test('startOAuth stores ONLY the state hash, with strong entropy', async () => {
  const { svc, oauthStates } = buildService();
  const { authorizationUrl } = await svc.startOAuth({ userId: '10', provider: 'meta' });

  const rawState = new URL(authorizationUrl).searchParams.get('state');
  assert.ok(rawState && rawState.length >= 40, 'raw state should be high-entropy');

  const stored = oauthStates._rows[0];
  assert.equal(stored.state_hash, hashOAuthState(rawState));
  assert.equal(stored.state_hash.length, 64);
  assert.equal('state' in stored, false); // raw state never stored
  assert.equal(stored.consumed_at, null);
});

test('consume once: replay is rejected', async () => {
  const oauthStates = createFakeOAuthStateRepository();
  const stateHash = hashOAuthState('raw-state-value');
  await oauthStates.createOAuthState({
    userId: '10',
    provider: 'meta',
    stateHash,
    redirectUri: 'https://cyflow.cyfrow.net/api/oauth/meta/callback',
    expiresAt: future(),
  });

  const first = await oauthStates.consumeOAuthState({ stateHash, provider: 'meta', expectedUserId: '10' });
  assert.equal(first.ok, true);
  const replay = await oauthStates.consumeOAuthState({ stateHash, provider: 'meta', expectedUserId: '10' });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'already_consumed');
});

test('consume rejects wrong provider and cross-user', async () => {
  const oauthStates = createFakeOAuthStateRepository();
  const stateHash = hashOAuthState('another-state');
  await oauthStates.createOAuthState({
    userId: '10',
    provider: 'meta',
    stateHash,
    redirectUri: 'https://cyflow.cyfrow.net/api/oauth/meta/callback',
    expiresAt: future(),
  });
  const wrongProvider = await oauthStates.consumeOAuthState({ stateHash, provider: 'threads', expectedUserId: '10' });
  assert.equal(wrongProvider.ok, false);
  const crossUser = await oauthStates.consumeOAuthState({ stateHash, provider: 'meta', expectedUserId: '77' });
  assert.equal(crossUser.ok, false);
  assert.equal(crossUser.reason, 'user_mismatch');
});
