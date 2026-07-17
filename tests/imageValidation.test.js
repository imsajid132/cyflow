import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  validateImageUpload, ImageValidationError, ALLOWED_IMAGE_TYPES, IMAGE_LIMITS,
} from '../src/services/imageValidation.js';
import {
  pngBytes, jpegBytes, webpBytes, apngBytes,
  gifBytes, bmpBytes, tiffBytes, pdfBytes, svgBytes, zipBytes, pngWithJpegTail,
} from './helpers/imageBytes.js';

const MAX = 8 * 1024 * 1024;
const rejectReason = (fn) => {
  try { fn(); return null; } catch (e) {
    assert.ok(e instanceof ImageValidationError, `expected ImageValidationError, got ${e}`);
    return e.reason;
  }
};

test('accepts a real PNG and reports true dimensions from the bytes', () => {
  const meta = validateImageUpload(pngBytes(120, 90), { maxBytes: MAX });
  assert.equal(meta.mimeType, 'image/png');
  assert.equal(meta.width, 120);
  assert.equal(meta.height, 90);
  assert.equal(meta.fileExtension, 'png');
  assert.equal(meta.byteSize, pngBytes(120, 90).length);
});

test('accepts a real JPEG and reads dimensions from the SOF', () => {
  const meta = validateImageUpload(jpegBytes(200, 150), { maxBytes: MAX });
  assert.equal(meta.mimeType, 'image/jpeg');
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 150);
  assert.equal(meta.fileExtension, 'jpg');
});

test('accepts a real WebP (VP8X) and reads its canvas dimensions', () => {
  const meta = validateImageUpload(webpBytes(300, 250), { maxBytes: MAX });
  assert.equal(meta.mimeType, 'image/webp');
  assert.equal(meta.width, 300);
  assert.equal(meta.height, 250);
  assert.equal(meta.fileExtension, 'webp');
});

test('checksum is the SHA-256 of the exact bytes and is stable', () => {
  const buf = pngBytes(64, 64);
  const meta = validateImageUpload(buf, { maxBytes: MAX });
  assert.equal(meta.checksum, crypto.createHash('sha256').update(buf).digest('hex'));
  assert.equal(validateImageUpload(buf, { maxBytes: MAX }).checksum, meta.checksum);
});

test('only three formats are allowed', () => {
  assert.deepEqual([...ALLOWED_IMAGE_TYPES], ['image/jpeg', 'image/png', 'image/webp']);
});

for (const [name, make] of [
  ['GIF', gifBytes], ['BMP', bmpBytes], ['TIFF', tiffBytes],
  ['PDF', pdfBytes], ['SVG', svgBytes], ['ZIP/archive', zipBytes],
]) {
  test(`refuses ${name} by magic bytes, with a named reason`, () => {
    const reason = rejectReason(() => validateImageUpload(make(), { maxBytes: MAX }));
    assert.ok(reason, `${name} should be refused`);
    assert.doesNotMatch(reason, /^$/);
  });
}

test('refuses an animated PNG (APNG) even though its header is a valid PNG', () => {
  const reason = rejectReason(() => validateImageUpload(apngBytes(64, 64), { maxBytes: MAX }));
  assert.match(reason, /animated/i);
});

test('refuses an animated WebP even though its VP8X header is valid', () => {
  const reason = rejectReason(() => validateImageUpload(webpBytes(80, 80, { animated: true }), { maxBytes: MAX }));
  assert.match(reason, /animated/i);
});

test('a still WebP with the same header shape is still accepted', () => {
  const meta = validateImageUpload(webpBytes(80, 80, { animated: false }), { maxBytes: MAX });
  assert.equal(meta.mimeType, 'image/webp');
});

test('polyglot guard: real PNG bytes declared as JPEG are rejected', () => {
  const reason = rejectReason(() => validateImageUpload(pngWithJpegTail(32, 32), { maxBytes: MAX, declaredMime: 'image/jpeg' }));
  assert.match(reason, /does not match/i);
});

test('a matching declared mime is accepted (no false positive)', () => {
  const meta = validateImageUpload(pngBytes(40, 40), { maxBytes: MAX, declaredMime: 'image/png' });
  assert.equal(meta.mimeType, 'image/png');
});

test('rejects an empty buffer', () => {
  assert.ok(rejectReason(() => validateImageUpload(Buffer.alloc(0), { maxBytes: MAX })));
});

test('rejects a non-buffer', () => {
  assert.ok(rejectReason(() => validateImageUpload('not a buffer', { maxBytes: MAX })));
});

test('rejects corrupt bytes that match no known format', () => {
  assert.ok(rejectReason(() => validateImageUpload(Buffer.from('xxxxxxxxxxxxxxxx'), { maxBytes: MAX })));
});

test('enforces the byte-size cap before parsing', () => {
  const reason = rejectReason(() => validateImageUpload(pngBytes(64, 64), { maxBytes: 10 }));
  assert.match(reason, /too large/i);
});

test('rejects dimensions below the minimum', () => {
  const reason = rejectReason(() => validateImageUpload(pngBytes(8, 8), { maxBytes: MAX }));
  assert.match(reason, /too small/i);
});

test('rejects a side larger than the maximum (via a claimed-huge WebP header)', () => {
  // A 30-byte WebP claiming 9000px: exactly the decompression-bomb shape, caught
  // from the header without any allocation or decode.
  const reason = rejectReason(() => validateImageUpload(webpBytes(9000, 100), { maxBytes: MAX }));
  assert.match(reason, /too large|px on a side/i);
});

test('rejects a pixel count over the cap even when each side is under the max', () => {
  // 7000x7000 = 49M pixels > 40M cap, both sides < 8000. Header-only, no decode.
  const reason = rejectReason(() => validateImageUpload(webpBytes(7000, 7000), { maxBytes: MAX }));
  assert.match(reason, /too many pixels/i);
});

test('limits are the documented conservative bounds', () => {
  assert.equal(IMAGE_LIMITS.MIN_DIMENSION, 16);
  assert.equal(IMAGE_LIMITS.MAX_DIMENSION, 8000);
  assert.equal(IMAGE_LIMITS.MAX_PIXELS, 40_000_000);
});
