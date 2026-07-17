/**
 * Byte-accurate image fixtures for upload tests.
 *
 * These build the ACTUAL header structures the validator parses, so a test that
 * says "reject an animated WebP" really does hand the validator the bytes of one
 * rather than a label. Nothing here decodes or renders; it only assembles the
 * header fields that carry format, dimensions and animation.
 */

import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

/** A valid still PNG of the given dimensions (RGB, one zlib-compressed IDAT). */
export function pngBytes(width = 64, height = 64) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const crc = (buf) => {
    let c = ~0 >>> 0;
    for (const b of buf) {
      c ^= b;
      for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, colour type 2 (RGB)
  const raw = Buffer.alloc(height * (1 + width * 3)); // filter byte + row
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** An animated PNG: a still PNG with an 'acTL' chunk inserted before IDAT. */
export function apngBytes(width = 64, height = 64) {
  const png = pngBytes(width, height);
  // Find the IDAT chunk start (length is at that offset).
  const idatTypeIdx = png.indexOf(Buffer.from('IDAT', 'ascii'));
  const idatStart = idatTypeIdx - 4; // back up over the 4-byte length
  const crc = (buf) => {
    let c = ~0 >>> 0;
    for (const b of buf) { c ^= b; for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return (~c) >>> 0;
  };
  const acTLData = Buffer.alloc(8); // num_frames(4) + num_plays(4)
  acTLData.writeUInt32BE(2, 0);
  const body = Buffer.concat([Buffer.from('acTL', 'ascii'), acTLData]);
  const len = Buffer.alloc(4); len.writeUInt32BE(acTLData.length);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc(body));
  const acTL = Buffer.concat([len, body, crcBuf]);
  return Buffer.concat([png.subarray(0, idatStart), acTL, png.subarray(idatStart)]);
}

/** A minimal valid JPEG with a real SOF0 carrying the given dimensions. */
export function jpegBytes(width = 48, height = 48) {
  const soi = Buffer.from([0xff, 0xd8]);
  // SOF0: FF C0, length(2)=17, precision(1)=8, height(2), width(2), comps(1)=3,
  // then 3 components x 3 bytes.
  const sof = Buffer.alloc(2 + 2 + 1 + 2 + 2 + 1 + 9);
  let o = 0;
  sof[o++] = 0xff; sof[o++] = 0xc0;
  sof.writeUInt16BE(17, o); o += 2;
  sof[o++] = 8;
  sof.writeUInt16BE(height, o); o += 2;
  sof.writeUInt16BE(width, o); o += 2;
  sof[o++] = 3;
  for (let c = 1; c <= 3; c += 1) { sof[o++] = c; sof[o++] = 0x11; sof[o++] = 0; }
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, sof, eoi]);
}

/** A valid extended WebP (VP8X) of the given dimensions; animated when asked. */
export function webpBytes(width = 80, height = 80, { animated = false } = {}) {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4); // file size after this field
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16); // VP8X chunk payload length
  buf[20] = animated ? 0x02 : 0x00; // flags: animation bit
  // reserved 21..23 = 0
  const w1 = width - 1; const h1 = height - 1;
  buf[24] = w1 & 0xff; buf[25] = (w1 >> 8) & 0xff; buf[26] = (w1 >> 16) & 0xff;
  buf[27] = h1 & 0xff; buf[28] = (h1 >> 8) & 0xff; buf[29] = (h1 >> 16) & 0xff;
  return buf;
}

/** Bytes that begin with a recognised, refused magic number. */
export const gifBytes = () => Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(16)]);
export const bmpBytes = () => Buffer.concat([Buffer.from([0x42, 0x4d]), Buffer.alloc(20)]);
export const tiffBytes = () => Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(20)]);
export const pdfBytes = () => Buffer.concat([Buffer.from('%PDF-1.7', 'ascii'), Buffer.alloc(16)]);
export const svgBytes = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'ascii');
export const zipBytes = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

/**
 * A polyglot: real PNG magic and IHDR, but JPEG-looking trailing bytes. The true
 * type is PNG; a caller that DECLARES image/jpeg is lying and must be rejected.
 */
export function pngWithJpegTail(width = 32, height = 32) {
  return Buffer.concat([pngBytes(width, height), Buffer.from([0xff, 0xd8, 0xff, 0xe0])]);
}

export default {
  pngBytes, apngBytes, jpegBytes, webpBytes,
  gifBytes, bmpBytes, tiffBytes, pdfBytes, svgBytes, zipBytes, pngWithJpegTail,
};
