import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWebsiteUrl,
  assertPublicHost,
  isPrivateIp,
  isPrivateIPv4,
  isPrivateIPv6,
  isBlockedHostname,
  isDisallowedPath,
  isSameSite,
  registrableDomain,
} from '../src/utils/urlSafety.js';
import { createWebsiteFetchService } from '../src/services/websiteFetchService.js';

/** A lookup that always resolves to the given address(es). */
const lookupTo = (...addresses) => async () => addresses.map((address) => ({ address }));

function htmlResponse(html = '<html><body>ok</body></html>', extra = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h) => {
        const k = h.toLowerCase();
        if (k === 'content-type') return 'text/html; charset=utf-8';
        if (k === 'content-length') return String(html.length);
        return null;
      },
    },
    async text() {
      return html;
    },
    ...extra,
  };
}

function redirectResponse(location, status = 302) {
  return {
    ok: false,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'location' ? location : null) },
    async text() {
      return '';
    },
  };
}

// --- private range detection ----------------------------------------------

test('blocks loopback, private IPv4, link-local, and metadata addresses', () => {
  for (const ip of [
    '127.0.0.1', '127.5.5.5', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', // AWS/GCP metadata
    '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255',
  ]) {
    assert.equal(isPrivateIPv4(ip), true, `${ip} must be blocked`);
    assert.equal(isPrivateIp(ip), true, `${ip} must be blocked`);
  }
  // Public addresses are allowed.
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1']) {
    assert.equal(isPrivateIPv4(ip), false, `${ip} should be allowed`);
  }
});

test('blocks private/loopback/link-local IPv6 (incl. IPv4-mapped)', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1']) {
    assert.equal(isPrivateIPv6(ip), true, `${ip} must be blocked`);
    assert.equal(isPrivateIp(ip), true, `${ip} must be blocked`);
  }
  assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false); // public
});

test('blocks internal hostnames', () => {
  for (const host of ['localhost', 'metadata.google.internal', 'foo.local', 'server.internal', 'intranet', 'ip6-localhost']) {
    assert.equal(isBlockedHostname(host), true, `${host} must be blocked`);
  }
  assert.equal(isBlockedHostname('example.com'), false);
});

// --- URL normalization -----------------------------------------------------

test('normalizes URLs, adds https, strips query/hash and rejects credentials', () => {
  const a = normalizeWebsiteUrl('example.com');
  assert.equal(a.url.toString(), 'https://example.com/');

  const b = normalizeWebsiteUrl('https://example.com/page?utm=1#frag');
  assert.equal(b.url.search, '');
  assert.equal(b.url.hash, '');

  assert.throws(() => normalizeWebsiteUrl('https://user:pass@example.com'), /credentials/i);
  assert.throws(() => normalizeWebsiteUrl('ftp://example.com'), /http/i);
  assert.throws(() => normalizeWebsiteUrl('http://localhost'), /cannot be analyzed/i);
  assert.throws(() => normalizeWebsiteUrl(''), /valid website URL/i);
});

test('production requires https; development allows http with a warning', () => {
  assert.throws(() => normalizeWebsiteUrl('http://example.com', { isProd: true }), /secure \(https\)/i);
  const dev = normalizeWebsiteUrl('http://example.com', { isProd: false });
  assert.deepEqual(dev.warnings, ['insecure_http']);
});

// --- DNS resolution --------------------------------------------------------

test('assertPublicHost rejects hosts resolving to private addresses', async () => {
  await assert.rejects(
    () => assertPublicHost('evil.example.com', { lookup: lookupTo('127.0.0.1') }),
    /cannot be analyzed/i,
  );
  await assert.rejects(
    () => assertPublicHost('evil.example.com', { lookup: lookupTo('169.254.169.254') }),
    /cannot be analyzed/i,
  );
  await assert.rejects(
    () => assertPublicHost('evil.example.com', { lookup: lookupTo('::1') }),
    /cannot be analyzed/i,
  );
  // A single private answer among public ones still rejects the host.
  await assert.rejects(
    () => assertPublicHost('mixed.example.com', { lookup: lookupTo('8.8.8.8', '10.0.0.5') }),
    /cannot be analyzed/i,
  );
  // All-public resolves fine.
  assert.deepEqual(await assertPublicHost('example.com', { lookup: lookupTo('93.184.216.34') }), ['93.184.216.34']);
});

test('assertPublicHost rejects literal private IPs and never leaks DNS errors', async () => {
  await assert.rejects(() => assertPublicHost('127.0.0.1'), /cannot be analyzed/i);
  await assert.rejects(
    () => assertPublicHost('nope.example.com', { lookup: async () => { throw new Error('EAI_AGAIN internal detail'); } }),
    (e) => {
      assert.match(e.message, /could not be reached/i);
      assert.equal(e.message.includes('EAI_AGAIN'), false); // no internal detail
      return true;
    },
  );
});

// --- fetch service ---------------------------------------------------------

test('fetch: a redirect to a private IP is blocked', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? redirectResponse('http://169.254.169.254/latest/meta-data/') : htmlResponse();
  };
  const svc = createWebsiteFetchService({ fetchImpl, lookup: lookupTo('93.184.216.34') });
  await assert.rejects(() => svc.fetchValidated(new URL('https://example.com/')), /cannot be analyzed/i);
  assert.equal(calls, 1); // the private hop was never fetched
});

test('fetch: a redirect to an internal hostname is blocked', async () => {
  const fetchImpl = async () => redirectResponse('http://localhost:8080/admin');
  const svc = createWebsiteFetchService({ fetchImpl, lookup: lookupTo('93.184.216.34') });
  await assert.rejects(() => svc.fetchValidated(new URL('https://example.com/')), /cannot be analyzed/i);
});

test('fetch: redirect count is limited', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return redirectResponse(`https://example.com/hop${n}`);
  };
  const svc = createWebsiteFetchService({ fetchImpl, lookup: lookupTo('93.184.216.34') });
  await assert.rejects(() => svc.fetchValidated(new URL('https://example.com/')), /redirected too many times/i);
});

test('fetch: non-HTML content is rejected', async () => {
  const pdf = {
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/pdf' : null) },
    async text() { return '%PDF-1.4'; },
  };
  const svc = createWebsiteFetchService({ fetchImpl: async () => pdf, lookup: lookupTo('93.184.216.34') });
  await assert.rejects(() => svc.fetchValidated(new URL('https://example.com/')), /did not return a web page/i);
});

test('fetch: oversized responses are rejected', async () => {
  const big = {
    ok: true,
    status: 200,
    headers: {
      get: (h) => {
        const k = h.toLowerCase();
        if (k === 'content-type') return 'text/html';
        if (k === 'content-length') return String(50 * 1024 * 1024);
        return null;
      },
    },
    async text() { return 'x'; },
  };
  const svc = createWebsiteFetchService({ fetchImpl: async () => big, lookup: lookupTo('93.184.216.34') });
  await assert.rejects(() => svc.fetchValidated(new URL('https://example.com/')), /too large/i);
});

test('fetch: timeout is classified safely and never leaks internals', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error('socket hang up internal'), { name: 'AbortError' }); };
  const svc = createWebsiteFetchService({ fetchImpl, lookup: lookupTo('93.184.216.34') });
  await assert.rejects(() => svc.fetchValidated(new URL('https://example.com/')), (e) => {
    assert.match(e.message, /took too long/i);
    assert.equal(e.message.includes('socket hang up'), false);
    return true;
  });
});

test('fetch: sends no credentials or auth headers', async () => {
  let seen = null;
  const fetchImpl = async (url, opts) => { seen = opts; return htmlResponse(); };
  const svc = createWebsiteFetchService({ fetchImpl, lookup: lookupTo('93.184.216.34') });
  await svc.fetchValidated(new URL('https://example.com/'));
  assert.equal(seen.redirect, 'manual');
  assert.equal('credentials' in seen, false);
  assert.equal(seen.headers.Authorization, undefined);
  assert.equal(seen.headers.Cookie, undefined);
});

// --- crawl scoping ---------------------------------------------------------

test('disallowed paths and cross-site links are excluded', () => {
  for (const p of ['/logout', '/admin/users', '/login', '/account/settings', '/checkout', '/cart', '/wp-admin/']) {
    assert.equal(isDisallowedPath(p), true, `${p} must be skipped`);
  }
  assert.equal(isDisallowedPath('/services/roofing'), false);

  assert.equal(isSameSite('www.example.com', 'example.com'), true);
  assert.equal(isSameSite('blog.example.com', 'example.com'), true);
  assert.equal(isSameSite('evil.com', 'example.com'), false);
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
});
