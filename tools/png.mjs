/**
 * A minimal, dependency-free PNG codec.
 *
 * The project has no image library, and the logo work needs three things:
 * decode the supplied source, unmatte its baked checkerboard into a real alpha
 * channel, and emit resized production assets. Adding sharp/jimp for a one-off
 * asset build would put a large native dependency into a vanilla ES-module app
 * that does not otherwise need one.
 *
 * A PNG IDAT stream is zlib-compressed filtered scanlines, and `node:zlib` is
 * built in, so decode/encode is a page of code. Scope is deliberately narrow:
 * 8-bit truecolour (type 2) and 8-bit truecolour+alpha (type 6). That is what
 * the source is and what the assets must be. Anything else throws rather than
 * guessing.
 *
 * This is a build tool, not application code. Nothing in src/ imports it.
 */

import { inflateSync, deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32, as PNG requires it for every chunk. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode a PNG into { width, height, data } where data is RGBA, 4 bytes per
 * pixel, regardless of whether the source carried an alpha channel.
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  let bitDepth = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colourType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colourType !== 2 && colourType !== 6) throw new Error(`unsupported colour type ${colourType}`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');

  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  prev.fill(0);

  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    raw.copy(line, 0, pos, pos + stride);
    pos += stride;

    // Undo the per-scanline filter. `channels` is the byte distance to the
    // pixel on the left, which is what PNG means by "a".
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[i] = (line[i] + a) & 0xff; break;
        case 2: line[i] = (line[i] + b) & 0xff; break;
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: line[i] = (line[i] + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`unknown filter ${filter}`);
      }
    }

    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      out[dst] = line[src];
      out[dst + 1] = line[src + 1];
      out[dst + 2] = line[src + 2];
      out[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }
    line.copy(prev);
  }

  return { width, height, data: out };
}

/** Encode RGBA into a PNG (colour type 6). Filter 0; zlib does the work. */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Box-filter downscale, averaging in PREMULTIPLIED space.
 *
 * Averaging straight RGBA would let the colour of fully transparent pixels bleed
 * into the result: a transparent white pixel next to a green edge would drag the
 * average toward white and produce a pale halo at 32px. Weighting colour by
 * alpha and dividing back out at the end is what keeps a small mark's edges the
 * same hue as the large one.
 */
export function resize({ width, height, data }, targetW, targetH = targetW) {
  const out = Buffer.alloc(targetW * targetH * 4);
  const xRatio = width / targetW;
  const yRatio = height / targetH;

  for (let y = 0; y < targetH; y += 1) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((y + 1) * yRatio)));
    for (let x = 0; x < targetW; x += 1) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((x + 1) * xRatio)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * width + sx) * 4;
          const alpha = data[i + 3] / 255;
          r += data[i] * alpha;
          g += data[i + 1] * alpha;
          b += data[i + 2] * alpha;
          a += data[i + 3];
          n += 1;
        }
      }

      const dst = (y * targetW + x) * 4;
      const avgAlpha = a / n;
      if (avgAlpha <= 0) {
        out[dst] = 0; out[dst + 1] = 0; out[dst + 2] = 0; out[dst + 3] = 0;
      } else {
        const w = avgAlpha / 255;
        out[dst] = Math.round(Math.min(255, r / n / w));
        out[dst + 1] = Math.round(Math.min(255, g / n / w));
        out[dst + 2] = Math.round(Math.min(255, b / n / w));
        out[dst + 3] = Math.round(avgAlpha);
      }
    }
  }
  return { width: targetW, height: targetH, data: out };
}

export default { decodePng, encodePng, resize };
