// The free, browserless poster renderer (SVG -> PNG via @resvg/resvg-js) and the
// SVG extractor. This is the render path the daily automation uses on Hostinger,
// so it must produce a real 1080x1080 PNG with no browser and reject junk safely.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSvgToPng } from '../src/services/aiStudio/posterRenderer.js';
import { extractSvg } from '../src/services/aiStudio/aiStudioEngine.js';

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0EA5E9"/><stop offset="1" stop-color="#0F172A"/></linearGradient></defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <circle cx="880" cy="220" r="180" fill="#F59E0B"/>
  <text x="90" y="470" font-family="DejaVu Serif, serif" font-size="96" font-weight="700" fill="#ffffff">Stronger</text>
  <rect x="90" y="820" width="360" height="86" rx="43" fill="#F59E0B"/>
  <text x="270" y="874" font-family="DejaVu Sans, sans-serif" font-size="32" fill="#0F172A" text-anchor="middle">Start free trial</text>
</svg>`;

test('renderSvgToPng turns an SVG poster into a real 1080x1080 PNG, no browser', async () => {
  const png = await renderSvgToPng(SAMPLE_SVG);
  assert.ok(Buffer.isBuffer(png) && png.length > 1000, 'a non-trivial PNG buffer');
  assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG signature');
  assert.equal(png.readUInt32BE(16), 1080, 'width 1080');
  assert.equal(png.readUInt32BE(20), 1080, 'height 1080');
});

test('renderSvgToPng rejects a non-SVG input instead of producing junk', async () => {
  await assert.rejects(() => renderSvgToPng('<html><body>not svg</body></html>'), /needs an <svg>/);
  await assert.rejects(() => renderSvgToPng(''), /needs an <svg>/);
});

test('extractSvg pulls a bare <svg> out of fenced / chatty model output', () => {
  const fenced = '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect/></svg>\n```';
  const svg = extractSvg(fenced);
  assert.ok(svg.startsWith('<svg'), 'starts at the svg tag');
  assert.ok(svg.endsWith('</svg>'), 'ends at the closing tag');

  const chatty = 'Here is your poster:\n<svg width="1080" height="1080"><circle/></svg>\nHope you like it!';
  assert.equal(extractSvg(chatty), '<svg width="1080" height="1080"><circle/></svg>');

  assert.equal(extractSvg('no svg here'), null, 'returns null when there is no svg');
});

/*
 * ---- the photograph -------------------------------------------------------
 *
 * The posters were colour and type only, and next to a designed one they read
 * as placeholders. The picture that fixes that has to be INSIDE the document:
 * resvg will not fetch a URL from an SVG, so a remote href renders as a hole.
 *
 * The designer writes a token and the bytes go in afterwards, because a model
 * asked to emit base64 either invents it or spends its whole answer on it.
 * That swap is the one rule here that can be got wrong silently, so it is the
 * one pinned by a test.
 */
test('the photograph bytes replace the token, and the poster renders with it', async () => {
  const { designPoster, PHOTO_TOKEN } = await import('../src/services/aiStudio/aiStudioEngine.js');

  // A real 300x300 PNG, so the render below genuinely draws something.
  const inner = await renderSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#e11d48"/></svg>`);
  const dataUri = `data:image/png;base64,${inner.toString('base64')}`;

  const out = await designPoster({
    brand: { businessName: 'Pioneer Construction' },
    colors: { primary: '#121212', secondary: '#8a8a8a', accent: '#e8402a' },
    content: { headline: 'Bad pointing lets water in', subtext: '', cta: '' },
    photo: { dataUri, alt: 'a wall' },
    ask: async ({ system }) => {
      // The photograph rules are only sent when there IS a photograph.
      assert.match(system, /REAL PHOTOGRAPH/, 'the designer was told it has one');
      return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#121212"/><image xlink:href="${PHOTO_TOKEN}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/></svg>`;
    },
  });

  assert.equal(out.imageError, null);
  assert.ok(!out.markup.includes(PHOTO_TOKEN), 'the token is gone');
  assert.ok(out.markup.includes(dataUri), 'the bytes are in the document');
  assert.ok(out.png && out.png.length > 1000, 'and the whole thing rasterizes');
});

/*
 * A model that ignores the token would leave an <image> pointing at the literal
 * string. Shipping that is shipping a broken reference; the poster is better
 * without the element than with a hole where a picture was promised.
 */
test('a token the designer left unfilled is stripped, not shipped', async () => {
  const { designPoster, PHOTO_TOKEN } = await import('../src/services/aiStudio/aiStudioEngine.js');

  const out = await designPoster({
    brand: { businessName: 'X' },
    colors: { primary: '#121212', secondary: '#8a8a8a', accent: '#e8402a' },
    content: { headline: 'H', subtext: '', cta: '' },
    photo: null,
    ask: async ({ system }) => {
      assert.doesNotMatch(system, /REAL PHOTOGRAPH/, 'no photograph, no photograph rules');
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#121212"/><image href="${PHOTO_TOKEN}" x="0" y="0" width="1080" height="1080"/><text x="90" y="500" fill="#fff" font-family="Inter" font-size="60">H</text></svg>`;
    },
  });

  assert.equal(out.imageError, null);
  assert.ok(!out.markup.includes(PHOTO_TOKEN), 'no dangling reference survives');
  assert.ok(out.png && out.png.length > 500, 'the poster still renders, just without a picture');
});
