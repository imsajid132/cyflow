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
