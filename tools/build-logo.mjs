/**
 * Build the production Cyflow app mark from the supplied source.
 *
 * The source (design-references/brand/cyflow-app-mark-source.png) is 1254x1254
 * PNG colour type 2: truecolour with NO alpha channel and no tRNS chunk. The
 * checkerboard people read as "transparency" is therefore baked pixels. Dropping
 * that file into the app would ship a grey chequered square.
 *
 * HOW THE CHECKERBOARD IS REMOVED
 *
 * Measured, not guessed. The source's chroma histogram is sharply bimodal:
 *
 *   chroma   0- 19 : 1,448,387 px  the checker (two achromatic tones, ~#fefefe
 *                                  and ~#f6f6f6, in 40px cells)
 *   chroma  20-119 :     4,755 px  the anti-aliased edge of the mark
 *   chroma 120-139 :   119,212 px  the solid mark
 *
 * The background is achromatic and the mark is chromatic, so chroma separates
 * them exactly. No colour-distance threshold against a sampled background is
 * needed, and no checker cell has to be located.
 *
 * The mark is ONE FLAT GREEN. That is what makes this clean: rather than solving
 * C = a*F + (1-a)*B per pixel to unmatte, every output pixel is set to the
 * canonical green and only ALPHA varies with chroma. An edge pixel becomes
 * partial-alpha pure green, so it composites correctly onto white, dark, or a
 * green tint. Carrying the observed edge RGB instead would bake the light
 * checker into the edge and halo on a dark background, which is the exact defect
 * this phase must avoid.
 *
 * Alpha ramps from lo..hi chroma, so the thin edge band keeps its gradient and
 * the shape is not stair-stepped by a hard threshold.
 *
 * CROP: the source's padding is asymmetric (L345 R285 T299 B315), which would
 * hang the mark off-centre in a sidebar. The mark is cropped to its own bounding
 * box and re-centred on a square canvas with even padding. The mark's own aspect
 * ratio (624x640) is preserved exactly; it is never stretched to square.
 *
 * Usage: node tools/build-logo.mjs
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { decodePng, encodePng, resize } from './png.mjs';

const SOURCE = 'design-references/brand/cyflow-app-mark-source.png';
const OUT_DIR = 'public/assets/brand';

/** Chroma: how much colour a pixel carries. 0 for any grey, white or black. */
const chromaOf = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

/** Below this a pixel is background; above it the mark is solid. Measured. */
const ALPHA_LO = 12;
const ALPHA_HI = 118;

/** Padding around the mark on the square canvas, as a share of the long edge. */
const PAD_RATIO = 0.085;

/**
 * The canonical brand green, taken as the MEDIAN of the solid interior rather
 * than the modal pixel. The source has light compression noise, so the median is
 * stable where a single sampled pixel is not.
 */
function sampleBrandGreen(img) {
  const rs = [];
  const gs = [];
  const bs = [];
  for (let i = 0; i < img.data.length; i += 4) {
    const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
    if (chromaOf(r, g, b) >= ALPHA_HI) { rs.push(r); gs.push(g); bs.push(b); }
  }
  const median = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
  return { r: median(rs), g: median(gs), b: median(bs), samples: rs.length };
}

function boundingBox(img, threshold = 40) {
  let minX = img.width; let minY = img.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (y * img.width + x) * 4;
      if (chromaOf(img.data[i], img.data[i + 1], img.data[i + 2]) > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Chroma -> alpha, with the mark's flat green as the only colour written. */
function unmatte(img, green) {
  const out = Buffer.alloc(img.width * img.height * 4);
  for (let i = 0; i < img.data.length; i += 4) {
    const c = chromaOf(img.data[i], img.data[i + 1], img.data[i + 2]);
    let a = (c - ALPHA_LO) / (ALPHA_HI - ALPHA_LO);
    a = Math.max(0, Math.min(1, a));
    out[i] = green.r;
    out[i + 1] = green.g;
    out[i + 2] = green.b;
    out[i + 3] = Math.round(a * 255);
  }
  return { width: img.width, height: img.height, data: out };
}

/** Crop to the mark and re-centre it on a square canvas with even padding. */
function cropCentred(img, box) {
  const long = Math.max(box.w, box.h);
  const size = Math.round(long * (1 + PAD_RATIO * 2));
  const out = Buffer.alloc(size * size * 4); // transparent
  const offsetX = Math.round((size - box.w) / 2);
  const offsetY = Math.round((size - box.h) / 2);

  for (let y = 0; y < box.h; y += 1) {
    for (let x = 0; x < box.w; x += 1) {
      const src = ((box.minY + y) * img.width + (box.minX + x)) * 4;
      const dst = ((offsetY + y) * size + (offsetX + x)) * 4;
      img.data.copy(out, dst, src, src + 4);
    }
  }
  return { width: size, height: size, data: out };
}

function main() {
  const img = decodePng(readFileSync(SOURCE));
  const green = sampleBrandGreen(img);
  const hex = `#${[green.r, green.g, green.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  console.log(`source          : ${img.width}x${img.height} (no alpha channel)`);
  console.log(`brand green     : ${hex}  (median of ${green.samples.toLocaleString()} solid px)`);

  const box = boundingBox(img);
  console.log(`mark bbox       : ${box.w}x${box.h} at (${box.minX},${box.minY})`);

  const unmatted = unmatte(img, green);
  const squared = cropCentred(unmatted, box);
  console.log(`production mark : ${squared.width}x${squared.height} (RGBA, real alpha)`);

  mkdirSync(OUT_DIR, { recursive: true });
  const assets = [
    ['cyflow-mark.png', 512],
    ['cyflow-mark-512.png', 512],
    ['cyflow-mark-192.png', 192],
    ['cyflow-mark-64.png', 64],
    ['cyflow-mark-32.png', 32],
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
  ];
  for (const [name, size] of assets) {
    const scaled = resize(squared, size);
    const bytes = encodePng(scaled);
    writeFileSync(join(OUT_DIR, name), bytes);
    console.log(`  ${name.padEnd(24)} ${String(size).padStart(3)}px  ${String(bytes.length).padStart(6)} B`);
  }

  /*
   * favicon.ico.
   *
   * Browsers request /favicon.ico whether or not a page declares link icons, so
   * without one every page load logs a 404. The modern ICO container can hold a
   * PNG verbatim, so this needs no new encoder: an ICONDIR, one ICONDIRENTRY,
   * and the 32px PNG bytes. That is "cleanly with existing tooling".
   */
  const ico32 = encodePng(resize(squared, 32));
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type: icon
  icoHeader.writeUInt16LE(1, 4); // one image
  const icoEntry = Buffer.alloc(16);
  icoEntry[0] = 32; // width
  icoEntry[1] = 32; // height
  icoEntry[2] = 0; // palette: none
  icoEntry[3] = 0; // reserved
  icoEntry.writeUInt16LE(1, 4); // colour planes
  icoEntry.writeUInt16LE(32, 6); // bits per pixel
  icoEntry.writeUInt32LE(ico32.length, 8);
  icoEntry.writeUInt32LE(6 + 16, 12); // offset: after header + entry
  const ico = Buffer.concat([icoHeader, icoEntry, ico32]);
  writeFileSync(join(OUT_DIR, 'favicon.ico'), ico);
  writeFileSync('public/favicon.ico', ico);
  console.log(`  ${'favicon.ico'.padEnd(24)}  32px  ${String(ico.length).padStart(6)} B  (also at public/favicon.ico)`);

  // Emit the sampled green so the design tokens are derived from the mark
  // itself rather than from somebody's memory of it.
  writeFileSync(join(OUT_DIR, 'brand-green.json'), `${JSON.stringify({ hex, rgb: [green.r, green.g, green.b], source: SOURCE }, null, 2)}\n`);
  console.log(`\nsampled green written to ${OUT_DIR}/brand-green.json -> ${hex}`);
}

main();
