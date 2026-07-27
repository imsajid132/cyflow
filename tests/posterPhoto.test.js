// A photograph from the business's own website, made safe to put on a poster.
//
// The posters were colour and type only, and next to a real one they looked like
// placeholders. The fix is a picture OF the business, and the fix's cost is that
// the server now fetches a URL a user supplied — which is the shape of a
// server-side request forgery. These tests pin the refusals: a private address,
// a redirect INTO a private address, a body over the cap, and a file that is not
// an image whatever its server claimed.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchPosterPhoto, photoForDay, MAX_PHOTO_BYTES } from '../src/services/aiStudio/posterPhoto.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(400, 7)]);

/** A fetch that answers with whatever this test needs, and records the calls. */
function fakeFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const fn = async (url) => {
    calls.push(String(url));
    const next = queue.shift() || { status: 404 };
    return {
      status: next.status ?? 200,
      ok: (next.status ?? 200) < 400,
      headers: { get: (h) => next.headers?.[h.toLowerCase()] ?? null },
      arrayBuffer: async () => (next.body ? next.body.buffer.slice(next.body.byteOffset, next.body.byteOffset + next.body.length) : new ArrayBuffer(0)),
    };
  };
  fn.calls = calls;
  return fn;
}

/** Every hostname resolves to one public address unless a test says otherwise. */
const publicLookup = async () => [{ address: '93.184.216.34' }];

test('a real photograph comes back as an embeddable data URI', async () => {
  const photo = await fetchPosterPhoto('https://example.test/shop.jpg', {
    fetchImpl: fakeFetch({ body: JPEG, headers: { 'content-type': 'image/jpeg' } }),
    lookup: publicLookup,
  });
  assert.ok(photo);
  assert.equal(photo.mime, 'image/jpeg');
  assert.equal(photo.bytes, JPEG.length);
  assert.match(photo.dataUri, /^data:image\/jpeg;base64,/);
  // resvg draws PNG too, and a site's photographs are often PNG.
  const asPng = await fetchPosterPhoto('https://example.test/shop.png', {
    fetchImpl: fakeFetch({ body: PNG }),
    lookup: publicLookup,
  });
  assert.equal(asPng.mime, 'image/png');
});

/*
 * The whole reason this file is careful. A URL the user pasted must never be
 * able to make the server read something only the server can reach.
 */
test('an address that resolves to a private network is refused', async () => {
  const fetchImpl = fakeFetch({ body: JPEG });
  const photo = await fetchPosterPhoto('https://internal.example.test/x.jpg', {
    fetchImpl,
    lookup: async () => [{ address: '127.0.0.1' }],
  });
  assert.equal(photo, null);
  assert.equal(fetchImpl.calls.length, 0, 'the address is checked BEFORE the connection, not after');
});

test('a redirect into a private network is refused too', async () => {
  const fetchImpl = fakeFetch([
    { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
    { body: JPEG },
  ]);
  let asked = 0;
  const photo = await fetchPosterPhoto('https://example.test/photo.jpg', {
    fetchImpl,
    lookup: async (host) => { asked += 1; return [{ address: asked === 1 ? '93.184.216.34' : '169.254.169.254' }]; },
  });
  assert.equal(photo, null, 'the second hop is checked, not followed on trust');
  assert.equal(fetchImpl.calls.length, 1, 'the private hop was never fetched');
});

test('the addresses that never need a lookup are refused outright', async () => {
  const unsafe = [
    'http://localhost/x.jpg',
    'https://127.0.0.1/x.jpg',
    'file:///etc/passwd',
    'https://user:pass@example.test/x.jpg',
    'not a url',
    '',
  ];
  for (const url of unsafe) {
    const fetchImpl = fakeFetch({ body: JPEG });
    // eslint-disable-next-line no-await-in-loop
    const photo = await fetchPosterPhoto(url, { fetchImpl, lookup: publicLookup });
    assert.equal(photo, null, `${url} must be refused`);
    assert.equal(fetchImpl.calls.length, 0, `${url} must not be fetched at all`);
  }
});

/*
 * Base64 adds a third on top and the string goes through the SVG parser, so an
 * uncapped body is a way to exhaust a shared host with one URL.
 */
test('a declared length over the cap is refused before a byte is read', async () => {
  const photo = await fetchPosterPhoto('https://example.test/huge.jpg', {
    fetchImpl: fakeFetch({ body: JPEG, headers: { 'content-length': String(MAX_PHOTO_BYTES + 1) } }),
    lookup: publicLookup,
  });
  assert.equal(photo, null);
});

test('a body that grows past the cap is dropped', async () => {
  const photo = await fetchPosterPhoto('https://example.test/big.jpg', {
    maxBytes: 100,
    fetchImpl: fakeFetch({ body: Buffer.concat([JPEG, Buffer.alloc(500, 1)]) }),
    lookup: publicLookup,
  });
  assert.equal(photo, null);
});

/*
 * A Content-Type header is what a server SAYS. Only JPEG and PNG are proven to
 * render, and an HTML error page served as image/jpeg would put a hole in the
 * poster rather than a picture.
 */
test('the file must actually be an image by its own first bytes', async () => {
  const html = Buffer.from(`<!doctype html><html><body>${'not an image '.repeat(20)}</body></html>`);
  const photo = await fetchPosterPhoto('https://example.test/oops.jpg', {
    fetchImpl: fakeFetch({ body: html, headers: { 'content-type': 'image/jpeg' } }),
    lookup: publicLookup,
  });
  assert.equal(photo, null);
});

test('a failure is a plainer poster, never a thrown error', async () => {
  const cases = [
    { status: 404 },
    { status: 500 },
  ];
  for (const c of cases) {
    // eslint-disable-next-line no-await-in-loop
    const photo = await fetchPosterPhoto('https://example.test/x.jpg', { fetchImpl: fakeFetch(c), lookup: publicLookup });
    assert.equal(photo, null);
  }
  // A fetch that explodes is still not an exception the caller has to handle.
  const boom = await fetchPosterPhoto('https://example.test/x.jpg', {
    fetchImpl: async () => { throw new Error('socket hang up'); },
    lookup: publicLookup,
  });
  assert.equal(boom, null);
});

/*
 * A week that repeats one photograph seven times looks MORE automated than one
 * with no photographs at all.
 */
test('the days rotate through the pictures the user actually ticked', () => {
  const images = [
    { url: 'a.jpg', kind: 'photo', chosen: true },
    { url: 'logo.png', kind: 'logo', chosen: true },
    { url: 'b.jpg', kind: 'photo', chosen: true },
    { url: 'c.jpg', kind: 'photo', chosen: false },
  ];
  assert.equal(photoForDay(images, 1).url, 'a.jpg');
  assert.equal(photoForDay(images, 2).url, 'b.jpg');
  assert.equal(photoForDay(images, 3).url, 'a.jpg', 'it wraps rather than running out');
  // A logo stretched across a poster background is a mistake nobody makes on
  // purpose, and an unticked picture was unticked deliberately.
  assert.equal(images.filter((i) => photoForDay(images, 1) === i).length, 1);
  assert.equal(photoForDay([{ url: 'l.png', kind: 'logo', chosen: true }], 1), null);
  assert.equal(photoForDay([], 1), null);
  assert.equal(photoForDay(null, 1), null);
});
