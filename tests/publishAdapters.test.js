import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdapters } from '../src/publishing/adapters.js';
import {
  PROVIDER_CAPABILITIES, capabilityForAccountType, checkPublishReadiness,
} from '../src/publishing/providerCapabilities.js';
import { ADAPTER_RESULT, PUBLISH_ERROR_CATEGORY, PLATFORMS } from '../src/config/constants.js';

const config = { providers: { meta: { graphVersion: 'v21.0' }, instagram: { graphVersion: 'v21.0' }, threads: { graphVersion: 'v1.0' } }, publishing: { requestTimeoutMs: 5000 } };

/** A fake providerHttp client: scripts responses by URL substring, records calls. */
function fakeHttp(script = []) {
  const calls = [];
  return {
    calls,
    async request(opts) {
      calls.push(opts);
      const match = script.find((s) => opts.url.includes(s.match) && (!s.method || s.method === opts.method));
      if (!match) return { ok: true, status: 200, data: { id: 'default_id' } };
      if (match.throw) throw new Error('network');
      return { ok: match.status >= 200 && match.status < 300, status: match.status, data: match.data };
    },
  };
}

// --- capability registry ----------------------------------------------------

test('the registry defines exactly the three supported platforms', () => {
  assert.deepEqual(Object.keys(PROVIDER_CAPABILITIES).sort(), ['facebook', 'instagram', 'threads']);
  assert.equal(PROVIDER_CAPABILITIES.instagram.mediaRequired, true);
  assert.equal(PROVIDER_CAPABILITIES.facebook.mediaRequired, false);
  assert.equal(PROVIDER_CAPABILITIES.threads.mediaRequired, false);
  assert.equal(PROVIDER_CAPABILITIES.instagram.reconciliationSupported, true);
});

test('an unsupported account type has no capability', () => {
  assert.equal(capabilityForAccountType('linkedin_page'), null);
  assert.equal(capabilityForAccountType('facebook_profile'), null); // personal profile: unsupported
});

test('checkPublishReadiness enforces Instagram media and caption caps', () => {
  assert.equal(checkPublishReadiness({ accountType: 'instagram_professional', hasMedia: false }).category, PUBLISH_ERROR_CATEGORY.MEDIA_REQUIRED);
  assert.equal(checkPublishReadiness({ accountType: 'instagram_professional', hasMedia: true }).ok, true);
  assert.equal(checkPublishReadiness({ accountType: 'threads_profile', hasMedia: false, caption: 'x'.repeat(600) }).category, PUBLISH_ERROR_CATEGORY.VALIDATION_FAILED);
});

// --- Facebook adapter -------------------------------------------------------

test('Facebook text post calls /feed and returns published with the post id', async () => {
  const http = fakeHttp([{ match: '/feed', method: 'POST', status: 200, data: { id: 'fb_post_1' } }]);
  const a = createAdapters({ http, config })[PLATFORMS.FACEBOOK];
  const res = await a.publish({ providerAccountId: 'PAGE1', accessToken: 'tok', caption: 'Hello Page' });
  assert.equal(res.status, ADAPTER_RESULT.PUBLISHED);
  assert.equal(res.providerPostId, 'fb_post_1');
  assert.match(http.calls[0].url, /graph\.facebook\.com\/v21\.0\/PAGE1\/feed/);
  assert.equal(http.calls[0].form.message, 'Hello Page');
  assert.equal(http.calls[0].headers.Authorization, 'Bearer tok'); // token in header, not URL
  assert.doesNotMatch(http.calls[0].url, /tok/); // never in the URL
});

test('Facebook image post calls /photos with the media url', async () => {
  const http = fakeHttp([{ match: '/photos', method: 'POST', status: 200, data: { post_id: 'fb_photo_1' } }]);
  const a = createAdapters({ http, config })[PLATFORMS.FACEBOOK];
  const res = await a.publish({ providerAccountId: 'PAGE1', accessToken: 'tok', caption: 'Look', mediaUrl: 'https://x/media/abc' });
  assert.equal(res.status, ADAPTER_RESULT.PUBLISHED);
  assert.equal(res.providerPostId, 'fb_photo_1');
  assert.match(http.calls[0].url, /\/PAGE1\/photos/);
  assert.equal(http.calls[0].form.url, 'https://x/media/abc');
});

test('Facebook maps a 403 to permission_required (permanent)', async () => {
  const http = fakeHttp([{ match: '/feed', status: 403, data: { error: { message: 'no perm' } } }]);
  const a = createAdapters({ http, config })[PLATFORMS.FACEBOOK];
  const res = await a.publish({ providerAccountId: 'P', accessToken: 't', caption: 'x' });
  assert.equal(res.status, ADAPTER_RESULT.PERMANENT_FAILURE);
  assert.equal(res.errorCategory, PUBLISH_ERROR_CATEGORY.PERMISSION_REQUIRED);
  assert.doesNotMatch(res.safeMessage, /no perm/); // raw provider message never surfaced
});

test('Facebook maps a 500 to a retryable failure', async () => {
  const http = fakeHttp([{ match: '/feed', status: 503, data: {} }]);
  const res = await createAdapters({ http, config })[PLATFORMS.FACEBOOK].publish({ providerAccountId: 'P', accessToken: 't', caption: 'x' });
  assert.equal(res.status, ADAPTER_RESULT.RETRYABLE_FAILURE);
});

test('Facebook network error is an unknown result, never a rejection', async () => {
  const http = fakeHttp([{ match: '/feed', throw: true }]);
  const res = await createAdapters({ http, config })[PLATFORMS.FACEBOOK].publish({ providerAccountId: 'P', accessToken: 't', caption: 'x' });
  assert.equal(res.status, ADAPTER_RESULT.UNKNOWN_RESULT);
  assert.equal(res.errorCategory, PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN);
});

// --- Instagram adapter (container flow) -------------------------------------

test('Instagram creates a container then publishes it', async () => {
  const http = fakeHttp([
    { match: '/media_publish', method: 'POST', status: 200, data: { id: 'ig_media_1' } },
    { match: '/media', method: 'POST', status: 200, data: { id: 'container_1' } },
  ]);
  const a = createAdapters({ http, config })[PLATFORMS.INSTAGRAM];
  const res = await a.publish({ providerAccountId: 'IG1', accessToken: 'tok', caption: 'IG copy', mediaUrl: 'https://x/media/abc' });
  assert.equal(res.status, ADAPTER_RESULT.PUBLISHED);
  assert.equal(res.providerContainerId, 'container_1');
  assert.equal(res.providerPostId, 'ig_media_1');
  assert.match(http.calls[0].url, /graph\.instagram\.com\/v21\.0\/IG1\/media/);
  assert.equal(http.calls[0].form.image_url, 'https://x/media/abc');
  assert.match(http.calls[1].url, /\/IG1\/media_publish/);
  assert.equal(http.calls[1].form.creation_id, 'container_1');
});

test('Instagram without media is rejected before any call (media required)', async () => {
  const http = fakeHttp([]);
  const a = createAdapters({ http, config })[PLATFORMS.INSTAGRAM];
  const pf = await a.preflight({ caption: 'x', mediaUrl: null });
  assert.equal(pf.ok, false);
  assert.equal(pf.category, PUBLISH_ERROR_CATEGORY.MEDIA_REQUIRED);
  const res = await a.publish({ providerAccountId: 'IG1', accessToken: 't', caption: 'x', mediaUrl: null });
  assert.equal(res.errorCategory, PUBLISH_ERROR_CATEGORY.MEDIA_REQUIRED);
  assert.equal(http.calls.length, 0, 'no provider call when media is missing');
});

test('Instagram publish network error becomes submitted (reconcile the container)', async () => {
  const http = fakeHttp([
    { match: '/media_publish', throw: true },
    { match: '/media', method: 'POST', status: 200, data: { id: 'container_9' } },
  ]);
  const res = await createAdapters({ http, config })[PLATFORMS.INSTAGRAM].publish({ providerAccountId: 'IG1', accessToken: 't', caption: 'x', mediaUrl: 'https://x/m' });
  assert.equal(res.status, ADAPTER_RESULT.SUBMITTED);
  assert.equal(res.providerContainerId, 'container_9');
});

test('Instagram reconcile: FINISHED container becomes published', async () => {
  const http = fakeHttp([{ match: 'container_9', method: 'GET', status: 200, data: { status_code: 'FINISHED' } }]);
  const res = await createAdapters({ http, config })[PLATFORMS.INSTAGRAM].reconcile({ providerAccountId: 'IG1', accessToken: 't', containerId: 'container_9' });
  assert.equal(res.status, ADAPTER_RESULT.PUBLISHED);
});

// --- Threads adapter --------------------------------------------------------

test('Threads text post uses the create -> publish container flow', async () => {
  const http = fakeHttp([
    { match: '/threads_publish', method: 'POST', status: 200, data: { id: 'th_1' } },
    { match: '/threads', method: 'POST', status: 200, data: { id: 'th_container_1' } },
  ]);
  const a = createAdapters({ http, config })[PLATFORMS.THREADS];
  const res = await a.publish({ providerAccountId: 'TH1', accessToken: 'tok', caption: 'Threads copy' });
  assert.equal(res.status, ADAPTER_RESULT.PUBLISHED);
  assert.equal(res.providerPostId, 'th_1');
  assert.match(http.calls[0].url, /graph\.threads\.net\/v1\.0\/TH1\/threads/);
  assert.equal(http.calls[0].form.media_type, 'TEXT');
  assert.equal(http.calls[0].form.text, 'Threads copy');
});

test('Threads with media uses media_type IMAGE', async () => {
  const http = fakeHttp([
    { match: '/threads_publish', method: 'POST', status: 200, data: { id: 'th_2' } },
    { match: '/threads', method: 'POST', status: 200, data: { id: 'th_c2' } },
  ]);
  await createAdapters({ http, config })[PLATFORMS.THREADS].publish({ providerAccountId: 'TH1', accessToken: 't', caption: 'x', mediaUrl: 'https://x/m' });
  assert.equal(http.calls[0].form.media_type, 'IMAGE');
  assert.equal(http.calls[0].form.image_url, 'https://x/m');
});
