/**
 * Phase 4.8 — the Cyflow app brand must never become the customer's brand.
 *
 * This is the separation the product depends on: Cyflow's green `cf` mark is
 * application chrome, and the customer's logo and saved palette are content.
 * Three real violations were found and fixed in this phase, and every one of
 * them was invisible to the test suite:
 *
 *   - the business logo preview fell back to the Cyflow app logo, on the very
 *     page where a user reviews their own brand;
 *   - the customer's colour picker defaulted to the app's indigo, seeding a hue
 *     they never chose into their palette and onto their posts;
 *   - the brand preview fell back to an indigo/blue gradient for any business
 *     that had saved no colours.
 *
 * These assert against the SHIPPED frontend source, because that is what the
 * browser loads. A unit test of a service could not have caught any of them.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { buildTemplate } from '../src/templates/socialImageTemplates.js';
import { sanitizeForTest } from '../src/services/socialImageService.js';

const read = (p) => readFileSync(p, 'utf8');

/**
 * Source with comments removed.
 *
 * These checks are about what the CODE does, not what the prose says. A comment
 * explaining "this used to default to #4f46e5, here is why that was wrong" is
 * the documentation of the fix, and flagging it would push the next person to
 * delete the explanation to get green.
 */
function code(path) {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Hues that are not Cyflow's and not any customer's: the old app placeholders. */
const RETIRED_APP_COLOURS = ['#6366f1', '#4f46e5', '#4338ca', '#0ea5e9'];

// --- the built mark ---------------------------------------------------------

test('every production logo asset exists', () => {
  const assets = [
    'cyflow-mark.png', 'cyflow-mark-512.png', 'cyflow-mark-192.png',
    'cyflow-mark-64.png', 'cyflow-mark-32.png', 'favicon-32.png', 'apple-touch-icon.png',
  ];
  for (const name of assets) {
    assert.ok(existsSync(`public/assets/brand/${name}`), `missing asset: ${name}`);
  }
});

test('the checkerboard source is kept in design-references and never served', () => {
  assert.ok(
    existsSync('design-references/brand/cyflow-app-mark-source.png'),
    'the original source must be preserved',
  );
  // Nothing under public/ may be the source, and no markup may point at it.
  assert.ok(!existsSync('public/assets/brand/cyflow-app-mark-source.png'));
  for (const page of ['public/app.html', 'public/404.html']) {
    assert.ok(!read(page).includes('cyflow-app-mark-source'), `${page} references the raw source`);
  }
});

test('the served mark has a real alpha channel, not a baked checkerboard', () => {
  // PNG IHDR: byte 25 is the colour type. 6 = truecolour+alpha.
  const bytes = readFileSync('public/assets/brand/cyflow-mark-512.png');
  assert.equal(bytes[25], 6, 'the production mark must carry an alpha channel');

  // ...and the source deliberately does not, which is why it cannot be served.
  const source = readFileSync('design-references/brand/cyflow-app-mark-source.png');
  assert.equal(source[25], 2, 'the source is expected to be truecolour with no alpha');
});

// --- the app uses the mark --------------------------------------------------

test('the app shell and auth page use the Cyflow mark, not a placeholder', () => {
  const app = read('public/app.html');
  assert.ok(app.includes('/assets/brand/favicon-32.png'), 'favicon must reference a real asset');
  assert.ok(app.includes('/assets/brand/cyflow-mark-64.png'), 'the sidebar lockup must use the mark');
  assert.ok(read('public/assets/js/pages/auth.js').includes('/assets/brand/cyflow-mark'));
});

test('the retired purple placeholder favicon is gone', () => {
  assert.ok(!existsSync('public/assets/favicon.svg'), 'the indigo gradient placeholder must not remain');
});

// --- the app brand never leaks into customer surfaces -----------------------

test('the business logo slot never falls back to the Cyflow app mark', () => {
  const src = code('public/assets/js/components/brandForm.js');
  const logoSection = src.slice(src.indexOf('logo-preview'), src.indexOf('const services'));
  assert.ok(
    !/cyflow-mark|favicon\.svg/.test(logoSection),
    'the customer logo preview must not reference the Cyflow app mark',
  );
  assert.ok(/logo-preview-empty/.test(src), 'a missing business logo needs a real empty state');
});

test('no customer-facing default seeds an app colour into the customer palette', () => {
  for (const file of ['public/assets/js/components/brandForm.js', 'public/assets/js/pages/brand.js']) {
    const src = code(file).toLowerCase();
    for (const hex of RETIRED_APP_COLOURS) {
      assert.ok(!src.includes(hex), `${file} still defaults a customer colour to ${hex}`);
    }
  }
});

test('a generated social creative carries the customer brand and no Cyflow asset', () => {
  const built = buildTemplate({
    template: 'editorial-insight',
    brandName: 'Cyfrow Solutions',
    headline: 'Your domain and hosting are separate',
    subheadline: 'Knowing which is which saves an afternoon.',
    primaryColor: '#111827',
    secondaryColor: '#23A455',
    accentColor: '#FDC70F',
    logoUrl: 'https://cdn.example.com/customer-logo.png',
    badge: 'Insight',
    website: 'cyfrowsolutions.com',
  });
  const html = sanitizeForTest(built.html);

  // The customer's own logo is what appears.
  assert.ok(html.includes('https://cdn.example.com/customer-logo.png'));
  // Nothing of Cyflow's does.
  for (const marker of ['cyflow-mark', '/assets/brand/', 'favicon']) {
    assert.ok(!html.includes(marker), `a customer creative referenced ${marker}`);
  }
  // Cyflow green is not imposed on the customer's palette.
  assert.ok(!built.css.toLowerCase().includes('#1f9e5b'), 'Cyflow green must not enter a customer creative');
  assert.ok(!built.css.toLowerCase().includes('#1a844c'));
  // The customer's saved colours are the ones used.
  assert.ok(built.css.toLowerCase().includes('#111827'));
  assert.ok(built.css.toLowerCase().includes('#fdc70f'));
});

test('the Cyflow app green never overrides a saved customer palette', () => {
  // A business whose brand IS a green must keep THEIR green, not Cyflow's.
  const built = buildTemplate({
    template: 'light-editorial',
    brandName: 'Green Gardens',
    headline: 'When to cut back a hedge',
    subheadline: 'Timing matters more than tools.',
    primaryColor: '#0b3d2e',
    accentColor: '#7bd389',
    badge: 'Tip',
  });
  const css = built.css.toLowerCase();
  assert.ok(css.includes('#0b3d2e'), "the customer's own green must survive");
  assert.ok(!css.includes('#1f9e5b'), 'Cyflow green must not be substituted in');
});

// --- the app colour system ---------------------------------------------------

test('the app brand ramp is derived from the mark, and is not the retired indigo', () => {
  const css = read('public/assets/css/design-system.css');
  const tokens = css.slice(css.indexOf(':root'), css.indexOf('@media'));
  assert.ok(tokens.includes('#1f9e5b'), 'the app brand must be the green sampled from the mark');
  assert.ok(tokens.includes('--cyflow-brand'), 'semantic brand tokens must exist');
  // The old ramp may only survive inside the comment explaining its removal.
  for (const hex of ['#6366f1', '#4f46e5', '#4338ca']) {
    const declared = new RegExp(`--brand-[0-9]+\\s*:\\s*${hex}`, 'i');
    assert.ok(!declared.test(tokens), `${hex} is still declared as an app brand token`);
  }
});

test('the sampled green is recorded, so the token is traceable to the logo', () => {
  const meta = JSON.parse(read('public/assets/brand/brand-green.json'));
  assert.equal(meta.hex, '#1f9e5b');
  assert.match(meta.source, /design-references\/brand\//);
});
