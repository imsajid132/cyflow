import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { ThreadsProvider } from '../src/providers/threadsProvider.js';
import { createProviderHttp } from '../src/utils/providerHttp.js';
import { OAUTH_SCOPES } from '../src/config/constants.js';

const providerConfig = {
  available: true,
  appId: 'TH_APP',
  appSecret: 'TH_SUPER_SECRET',
  redirectUri: 'https://cyflow.cyfrow.net/api/oauth/threads/callback',
  graphVersion: 'v1.0',
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
  };
}
function makeFetch(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  fn.calls = calls;
  return fn;
}
function build(handler) {
  const fetchImpl = makeFetch(handler);
  return { provider: new ThreadsProvider({ providerConfig, http: createProviderHttp({ fetchImpl }) }), fetchImpl };
}

test('threads: authorization URL host + scopes', () => {
  const { provider } = build(() => jsonResponse(200, {}));
  const url = new URL(provider.getAuthorizationUrl({ state: 'S' }));
  assert.equal(url.hostname, 'threads.net');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.deepEqual(url.searchParams.get('scope').split(','), OAUTH_SCOPES.threads);
});

test('threads: code exchange + th_exchange_token long-lived exchange honors expires_in', async () => {
  const { provider, fetchImpl } = build((url) => {
    if (url.includes('graph.threads.net/oauth/access_token')) return jsonResponse(200, { access_token: 'SHORT', user_id: 'th5' });
    if (url.includes('graph.threads.net/access_token')) return jsonResponse(200, { access_token: 'LONG', expires_in: 5184000 });
    return jsonResponse(404, {});
  });
  const result = await provider.exchangeAuthorizationCode({ code: 'c' });
  assert.equal(result.accessToken, 'LONG');
  assert.equal(result.expiresIn, 5184000);

  const longCall = fetchImpl.calls.find((c) => c.url.includes('graph.threads.net/access_token'));
  assert.match(longCall.url, /grant_type=th_exchange_token/);
});

test('threads: profile normalized', async () => {
  const { provider } = build((url) =>
    url.includes('/me') ? jsonResponse(200, { id: 'th5', username: 'threader', name: 'Threads User' }) : jsonResponse(404, {}),
  );
  const accounts = await provider.discoverAccounts({ accessToken: 'LONG', providerUserId: 'th5' });
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].accountType, 'threads_profile');
  assert.equal(accounts[0].providerAccountId, 'th5');
  assert.equal(accounts[0].username, 'threader');
});

test('threads: token refresh via th_refresh_token', async () => {
  const { provider, fetchImpl } = build((url) =>
    url.includes('refresh_access_token') ? jsonResponse(200, { access_token: 'REF', expires_in: 999 }) : jsonResponse(404, {}),
  );
  const r = await provider.refreshAccountToken({ accessToken: 'OLD' });
  assert.equal(r.accessToken, 'REF');
  assert.equal(r.expiresIn, 999);
  const call = fetchImpl.calls.find((c) => c.url.includes('refresh_access_token'));
  assert.match(call.url, /grant_type=th_refresh_token/);
});

test('threads: error classification & no secret in errors', async () => {
  const unauth = build((url) => (url.includes('/me') ? jsonResponse(401, {}) : jsonResponse(200, {})));
  await assert.rejects(() => unauth.provider.discoverAccounts({ accessToken: 'x' }), (e) => {
    assert.equal(e.classification, 'invalid_token');
    assert.equal(e.message.includes(providerConfig.appSecret), false);
    return true;
  });
});
