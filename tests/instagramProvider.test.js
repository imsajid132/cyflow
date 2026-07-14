import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { InstagramProvider } from '../src/providers/instagramProvider.js';
import { createProviderHttp } from '../src/utils/providerHttp.js';
import { OAUTH_SCOPES } from '../src/config/constants.js';

const providerConfig = {
  available: true,
  appId: 'IG_APP',
  appSecret: 'IG_SUPER_SECRET',
  redirectUri: 'https://cyflow.cyfrow.net/api/oauth/instagram/callback',
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
  return { provider: new InstagramProvider({ providerConfig, http: createProviderHttp({ fetchImpl }) }), fetchImpl };
}

test('instagram: authorization URL host, scopes, IG app id (not meta)', () => {
  const { provider } = build(() => jsonResponse(200, {}));
  const url = new URL(provider.getAuthorizationUrl({ state: 'S' }));
  assert.equal(url.hostname, 'www.instagram.com');
  assert.equal(url.searchParams.get('client_id'), 'IG_APP');
  assert.notEqual(url.searchParams.get('client_id'), 'META_APP');
  assert.deepEqual(url.searchParams.get('scope').split(','), OAUTH_SCOPES.instagram);
});

test('instagram: form-urlencoded code exchange + long-lived exchange honors expires_in', async () => {
  const { provider, fetchImpl } = build((url) => {
    if (url.includes('api.instagram.com/oauth/access_token')) {
      return jsonResponse(200, { access_token: 'SHORT', user_id: 12345 });
    }
    if (url.includes('graph.instagram.com/access_token')) {
      return jsonResponse(200, { access_token: 'LONG', expires_in: 5184000 });
    }
    return jsonResponse(404, {});
  });
  const result = await provider.exchangeAuthorizationCode({ code: 'the-code' });
  assert.equal(result.accessToken, 'LONG');
  assert.equal(result.expiresIn, 5184000);
  assert.equal(result.providerUserId, '12345');

  // code exchange used a form-urlencoded POST
  const exchangeCall = fetchImpl.calls.find((c) => c.url.includes('api.instagram.com/oauth/access_token'));
  assert.equal(exchangeCall.opts.method, 'POST');
  assert.match(exchangeCall.opts.headers['Content-Type'], /application\/x-www-form-urlencoded/);
});

test('instagram: professional account normalized; personal rejected', async () => {
  const okBuild = build((url) => {
    if (url.includes('/me')) return jsonResponse(200, { user_id: 'ig99', username: 'pro_user', account_type: 'BUSINESS', name: 'Pro' });
    return jsonResponse(404, {});
  });
  const accounts = await okBuild.provider.discoverAccounts({ accessToken: 'LONG', providerUserId: 'ig99' });
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].accountType, 'instagram_professional');
  assert.equal(accounts[0].username, 'pro_user');
  assert.equal(accounts[0].providerAccountId, 'ig99');

  const personal = build((url) =>
    url.includes('/me') ? jsonResponse(200, { user_id: 'ig1', username: 'me', account_type: 'PERSONAL' }) : jsonResponse(404, {}),
  );
  await assert.rejects(() => personal.provider.discoverAccounts({ accessToken: 'LONG' }), (e) => {
    assert.equal(e.classification, 'account_not_eligible');
    return true;
  });
});

test('instagram: token refresh honors expires_in', async () => {
  const { provider } = build((url) =>
    url.includes('refresh_access_token') ? jsonResponse(200, { access_token: 'REFRESHED', expires_in: 12345 }) : jsonResponse(404, {}),
  );
  const r = await provider.refreshAccountToken({ accessToken: 'OLD' });
  assert.equal(r.accessToken, 'REFRESHED');
  assert.equal(r.expiresIn, 12345);
});

test('instagram: error classification & no secret/token in errors', async () => {
  const to = build(() => {
    throw Object.assign(new Error('x'), { name: 'AbortError' });
  });
  await assert.rejects(() => to.provider.exchangeAuthorizationCode({ code: 'x' }), (e) => {
    assert.equal(e.classification, 'provider_unavailable');
    assert.equal(e.message.includes(providerConfig.appSecret), false);
    return true;
  });
});
