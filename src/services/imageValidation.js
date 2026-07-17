/**
 * Dependency-free image validation for uploads.
 *
 * WHY NO LIBRARY. C3 needs to VERIFY an upload — that its bytes really are a
 * JPEG/PNG/WebP, and what its true dimensions are — not to PROCESS it (no
 * resize, no re-encode, no thumbnail). Sharp exists for processing and pulls a
 * native binary; it would be the wrong tool for a verification-only job, and the
 * repo already reads and writes image bytes without one (tools/png.mjs). So this
 * parses the format headers directly. It is small, has no native dependency, and
 * cannot be tricked by a renamed file, a lying Content-Type, or a client-claimed
 * size — every fact it reports comes from the bytes.
 *
 * The parser is deliberately STRICT and narrow. It reads only the header fields
 * it needs (magic bytes, dimensions) and refuses anything it does not positively
 * recognise. A format we cannot verify is a format we reject.
 */

import crypto from 'node:crypto';

/** The formats an upload may be. Everything else is refused by default. */
export const ALLOWED_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Bounds. Deliberately conservative; a social image does not need to be huge,
 * and a decompression bomb is exactly a small file that claims enormous
 * dimensions, which the pixel cap below stops before any decode is attempted.
 */
export const IMAGE_LIMITS = Object.freeze({
  MIN_DIMENSION: 16,
  MAX_DIMENSION: 8000,
  MAX_PIXELS: 40_000_000, // ~6300x6300; well above any real social asset
});

/** A rejection with a safe, user-facing reason. */
export class ImageValidationError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ImageValidationError';
    this.reason = reason;
  }
}

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

/**
 * Detect the true format from magic bytes, and reject formats we refuse.
 *
 * The refusals are explicit and named, because "unsupported" is more helpful
 * than "invalid" — a user who uploaded a GIF should be told it is a GIF, not
 * that their file is broken.
 */
function detectFormat(buf) {
  if (buf.length < 12) throw new ImageValidationError('That file is too small to be a valid image.');

  // JPEG: FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // WebP: "RIFF"...."WEBP"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }

  // Named refusals for the formats a user might reasonably try.
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) throw new ImageValidationError('GIF images are not supported. Please upload a JPEG, PNG or WebP.');
  if (startsWith(buf, [0x3c, 0x3f, 0x78, 0x6d, 0x6c]) || startsWith(buf, [0x3c, 0x73, 0x76, 0x67])) throw new ImageValidationError('SVG images are not supported.');
  if (startsWith(buf, [0x42, 0x4d])) throw new ImageValidationError('BMP images are not supported. Please upload a JPEG, PNG or WebP.');
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) throw new ImageValidationError('TIFF images are not supported.');
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) throw new ImageValidationError('That is a PDF, not an image.');
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) throw new ImageValidationError('That looks like an archive, not an image.');

  throw new ImageValidationError('That file is not a supported image. Please upload a JPEG, PNG or WebP.');
}

/** PNG: width/height are the two big-endian uint32s right after the IHDR tag. */
function pngDimensions(buf) {
  // IHDR must be the first chunk: length(4) + "IHDR"(4) at offset 8, data at 16.
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new ImageValidationError('This PNG file is corrupt or incomplete.');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * JPEG: walk the marker segments to the Start-Of-Frame, which carries the real
 * dimensions. A JPEG lies about nothing here — the SOF is the decoder's own
 * source of truth.
 */
function jpegDimensions(buf) {
  let offset = 2; // skip the SOI (FF D8)
  const len = buf.length;
  while (offset < len) {
    if (buf[offset] !== 0xff) throw new ImageValidationError('This JPEG file is corrupt.');
    let marker = buf[offset + 1];
    // Skip padding fill bytes (multiple 0xFF).
    while (marker === 0xff && offset + 1 < len) { offset += 1; marker = buf[offset + 1]; }
    // SOF0..SOF15 carry dimensions, excluding DHT(C4), DAC(CC) and RSTn(D0-D7).
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > len) break;
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    // Standalone markers (no length): SOI/EOI/RSTn. Everything else has a length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(offset + 2);
    if (segLen < 2) throw new ImageValidationError('This JPEG file is corrupt.');
    offset += 2 + segLen;
  }
  throw new ImageValidationError('This JPEG file is corrupt or incomplete.');
}

/** WebP: three sub-formats (lossy VP8, lossless VP8L, extended VP8X). */
function webpDimensions(buf) {
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') {
    // Lossy: dimensions live in the frame header after the start code 9D 01 2A.
    const sc = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (sc < 0 || sc + 7 > buf.length) throw new ImageValidationError('This WebP file is corrupt.');
    return {
      width: buf.readUInt16LE(sc + 3) & 0x3fff,
      height: buf.readUInt16LE(sc + 5) & 0x3fff,
    };
  }
  if (fourcc === 'VP8L') {
    // Lossless: 14-bit width and height packed after the 0x2F signature byte.
    if (buf.length < 25 || buf[20] !== 0x2f) throw new ImageValidationError('This WebP file is corrupt.');
    const bits = buf.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (fourcc === 'VP8X') {
    // Extended: 24-bit width-1 and height-1, little-endian, at offset 24.
    if (buf.length < 30) throw new ImageValidationError('This WebP file is corrupt.');
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  throw new ImageValidationError('This WebP variant is not supported.');
}

function readDimensions(mime, buf) {
  if (mime === 'image/png') return pngDimensions(buf);
  if (mime === 'image/jpeg') return jpegDimensions(buf);
  if (mime === 'image/webp') return webpDimensions(buf);
  throw new ImageValidationError('That file is not a supported image.');
}

/**
 * APNG detection: an animated PNG carries an 'acTL' (animation control) chunk
 * BEFORE the first 'IDAT'. A still PNG never does. We only need to walk the
 * chunk headers as far as the first IDAT, so this is cheap and bounded.
 */
function isAnimatedPng(buf) {
  let offset = 8; // past the 8-byte signature
  const len = buf.length;
  while (offset + 8 <= len) {
    const chunkLen = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true; // animation control before image data
    if (type === 'IDAT') return false; // first image data reached: a still PNG
    if (chunkLen < 0) break;
    offset += 12 + chunkLen; // length(4) + type(4) + data + crc(4)
    if (!Number.isSafeInteger(offset)) break;
  }
  return false;
}

/** Animated WebP: only the extended (VP8X) form can animate; its flags byte at
 *  offset 20 has the animation bit (0x02) set. */
function isAnimatedWebp(buf) {
  if (buf.length < 21 || buf.toString('ascii', 12, 16) !== 'VP8X') return false;
  return (buf[20] & 0x02) !== 0;
}

/**
 * Validate an upload buffer end to end.
 *
 * @param {Buffer} buffer the raw uploaded bytes (memory storage)
 * @param {{ maxBytes: number, declaredMime?: string }} opts
 * @returns {{ mimeType, width, height, byteSize, checksum, fileExtension }}
 * @throws {ImageValidationError} with a safe reason on any failure
 */
export function validateImageUpload(buffer, { maxBytes, declaredMime = null } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImageValidationError('No image was received.');
  }
  if (typeof maxBytes === 'number' && buffer.length > maxBytes) {
    const mb = Math.floor(maxBytes / (1024 * 1024));
    throw new ImageValidationError(`That image is too large. The maximum is ${mb} MB.`);
  }

  // The TRUE type, from the bytes. A declared type that disagrees is a lie and
  // is rejected — this is the polyglot / renamed-file guard.
  const mimeType = detectFormat(buffer);
  if (declaredMime && declaredMime !== mimeType && ALLOWED_IMAGE_TYPES.includes(declaredMime)) {
    throw new ImageValidationError('The file type does not match its contents.');
  }

  // Animated images are out of scope. GIF (the usual animated format) is already
  // refused in detectFormat; APNG and animated WebP masquerade as still PNG/WebP,
  // so they are caught explicitly here before dimensions are trusted.
  if (mimeType === 'image/png' && isAnimatedPng(buffer)) {
    throw new ImageValidationError('Animated PNG images are not supported. Please upload a still image.');
  }
  if (mimeType === 'image/webp' && isAnimatedWebp(buffer)) {
    throw new ImageValidationError('Animated WebP images are not supported. Please upload a still image.');
  }

  const { width, height } = readDimensions(mimeType, buffer);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ImageValidationError('This image is corrupt or has no readable dimensions.');
  }
  if (width < IMAGE_LIMITS.MIN_DIMENSION || height < IMAGE_LIMITS.MIN_DIMENSION) {
    throw new ImageValidationError(`This image is too small. The minimum is ${IMAGE_LIMITS.MIN_DIMENSION}x${IMAGE_LIMITS.MIN_DIMENSION} pixels.`);
  }
  if (width > IMAGE_LIMITS.MAX_DIMENSION || height > IMAGE_LIMITS.MAX_DIMENSION) {
    throw new ImageValidationError(`This image is too large. The maximum is ${IMAGE_LIMITS.MAX_DIMENSION}px on a side.`);
  }
  if (width * height > IMAGE_LIMITS.MAX_PIXELS) {
    throw new ImageValidationError('This image has too many pixels to process safely.');
  }

  return {
    mimeType,
    width,
    height,
    byteSize: buffer.length,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    fileExtension: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimeType],
  };
}

export default { validateImageUpload, ImageValidationError, ALLOWED_IMAGE_TYPES, IMAGE_LIMITS };
