// Load a valid test env before importing modules that load config/env.js.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { MetaProvider } from '../src/providers/metaProvider.js';
import { createProviderHttp } from '../src/utils/providerHttp.js';
import { OAUTH_SCOPES } from '../src/config/constants.js';

const providerConfig = {
  available: true,
  appId: 'META_APP',
  appSecret: 'META_SUPER_SECRET',
  redirectUri: 'https://cyflow.cyfrow.net/api/oauth/meta/callback',
  graphVersion: 'v21.0',
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
  const http = createProviderHttp({ fetchImpl });
  return { provider: new MetaProvider({ providerConfig, http }), fetchImpl };
}

test('meta: authorization URL host, path, scopes, redirect', () => {
  const { provider } = build(() => jsonResponse(200, {}));
  const url = new URL(provider.getAuthorizationUrl({ state: 'STATE123' }));
  assert.equal(url.hostname, 'www.facebook.com');
  assert.equal(url.pathname, '/v21.0/dialog/oauth');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'META_APP');
  assert.equal(url.searchParams.get('redirect_uri'), providerConfig.redirectUri);
  assert.equal(url.searchParams.get('state'), 'STATE123');
  assert.deepEqual(url.searchParams.get('scope').split(','), OAUTH_SCOPES.meta);
});

test('meta: code exchange performs long-lived exchange', async () => {
  const { provider } = build((url) => {
    if (url.includes('fb_exchange_token')) return jsonResponse(200, { access_token: 'LONG', expires_in: 5184000 });
    if (url.includes('/oauth/access_token')) return jsonResponse(200, { access_token: 'SHORT' });
    return jsonResponse(404, {});
  });
  const result = await provider.exchangeAuthorizationCode({ code: 'the-code' });
  assert.equal(result.userAccessToken, 'LONG');
});

test('meta: discovers only publishable Pages, carrying Page tokens', async () => {
  const { provider } = build((url) => {
    if (url.includes('/me/accounts')) {
      return jsonResponse(200, {
        data: [
          { id: 'p1', name: 'Page One', tasks: ['CREATE_CONTENT', 'MANAGE'], access_token: 'PAGE1' },
          { id: 'p2', name: 'Page Two', tasks: ['ANALYZE'], access_token: 'PAGE2' }, // not publishable
          { id: 'p3', name: 'Page Three', tasks: ['MANAGE'], access_token: 'PAGE3' },
        ],
      });
    }
    if (url.includes('/me')) return jsonResponse(200, { id: 'fbuser' });
    return jsonResponse(404, {});
  });
  const accounts = await provider.discoverAccounts({ userAccessToken: 'LONG' });
  assert.equal(accounts.length, 2); // p1, p3 only
  assert.deepEqual(
    accounts.map((a) => a.providerAccountId).sort(),
    ['p1', 'p3'],
  );
  assert.equal(accounts[0].provider, 'meta');
  assert.equal(accounts[0].accountType, 'facebook_page');
  assert.equal(accounts[0].providerUserId, 'fbuser');
  assert.ok(accounts[0].accessToken); // Page token present internally
});

test('meta: no eligible Pages -> no_publishable_account', async () => {
  const { provider } = build((url) => {
    if (url.includes('/me/accounts')) {
      return jsonResponse(200, { data: [{ id: 'p1', name: 'x', tasks: ['ANALYZE'], access_token: 't' }] });
    }
    if (url.includes('/me')) return jsonResponse(200, { id: 'fbuser' });
    return jsonResponse(404, {});
  });
  await assert.rejects(() => provider.discoverAccounts({ userAccessToken: 'LONG' }), (e) => {
    assert.equal(e.classification, 'no_publishable_account');
    return true;
  });
});

test('meta: verifyAccount confirms Page id', async () => {
  const { provider } = build((url) => {
    if (url.includes('/p1')) return jsonResponse(200, { id: 'p1', name: 'Renamed Page' });
    return jsonResponse(404, {});
  });
  const v = await provider.verifyAccount({ account: { providerAccountId: 'p1' }, accessToken: 'PAGE1' });
  assert.equal(v.providerAccountId, 'p1');
  assert.equal(v.displayName, 'Renamed Page');
});

test('meta: error classifications & no secret leakage', async () => {
  // 400 on code exchange -> invalid_authorization_code
  const bad = build(() => jsonResponse(400, { error: { message: 'bad code' } }));
  await assert.rejects(() => bad.provider.exchangeAuthorizationCode({ code: 'x' }), (e) => {
    assert.equal(e.classification, 'invalid_authorization_code');
    assert.equal(e.message.includes(providerConfig.appSecret), false);
    return true;
  });

  // 401 -> invalid_token
  const unauth = build((url) => (url.includes('/me/accounts') ? jsonResponse(401, {}) : jsonResponse(200, { id: 'u' })));
  await assert.rejects(() => unauth.provider.discoverAccounts({ userAccessToken: 't' }), (e) => {
    assert.equal(e.classification, 'invalid_token');
    return true;
  });

  // 429 -> rate_limited
  const rl = build((url) => (url.includes('/me/accounts') ? jsonResponse(429, {}) : jsonResponse(200, { id: 'u' })));
  await assert.rejects(() => rl.provider.discoverAccounts({ userAccessToken: 't' }), (e) => {
    assert.equal(e.classification, 'rate_limited');
    return true;
  });

  // timeout -> provider_unavailable
  const to = build(() => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  });
  await assert.rejects(() => to.provider.exchangeAuthorizationCode({ code: 'x' }), (e) => {
    assert.equal(e.classification, 'provider_unavailable');
    return true;
  });
});
