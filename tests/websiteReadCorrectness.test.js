// What the website reader reports must be TRUE, not merely present.
//
// Every case here was seen on a real site, in the panel, in front of the owner:
// a heading font of "600", a body font of "-apple-system", a business name of
// "default", and a services list made of sales promises. Each was confidently
// wrong, which is worse than blank — a blank field invites a correction, and a
// wrong one gets carried onto every poster.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { firstFontName, extractFonts, extractServices, isRealBusinessName } from '../src/services/websiteParser.js';
import { parse } from 'node-html-parser';

test('a font-weight that leaked in from a neighbouring property is not a font', () => {
  assert.equal(firstFontName('600'), '', 'a bare number is a weight, not a face');
  assert.equal(firstFontName('700, sans-serif'), '');
  assert.equal(firstFontName('  400  '), '');
});

test('generic and system families are not a brand font', () => {
  for (const generic of ['-apple-system', 'system-ui', 'sans-serif', 'serif', 'monospace', 'BlinkMacSystemFont', 'ui-sans-serif']) {
    assert.equal(firstFontName(generic), '', `${generic} is not a brand face`);
  }
  // A real face still comes through, including one that starts a system stack.
  assert.equal(firstFontName('"Playfair Display", Georgia, serif'), 'Playfair Display');
  assert.equal(firstFontName('Segoe UI, sans-serif'), 'Segoe UI');
});

test('a --heading-font-weight variable is not read as the heading face', () => {
  const html = `<html><head><style>
    :root { --heading-font-weight: 600; --body-font-size: 16px; }
    h1 { font-family: "Playfair Display", serif; }
    body { font-family: Inter, sans-serif; }
  </style></head><body><h1>x</h1></body></html>`;
  const fonts = extractFonts(parse(html));
  assert.equal(fonts.headingFont, 'Playfair Display', 'the h1 rule wins, not the weight variable');
  assert.equal(fonts.bodyFont, 'Inter');
});

test('a real font variable is still preferred', () => {
  const html = `<html><head><style>
    :root { --heading-font-family: Poppins, sans-serif; --body-font: Inter, sans-serif; }
    h1 { font-family: Arial; }
  </style></head><body></body></html>`;
  const fonts = extractFonts(parse(html));
  assert.equal(fonts.headingFont, 'Poppins');
  assert.equal(fonts.bodyFont, 'Inter');
});

test('a theme placeholder is not a business name', () => {
  for (const stub of ['default', 'Default', 'untitled', 'Home', 'index', 'My Site', 'demo', '   ']) {
    assert.equal(isRealBusinessName(stub), false, `"${stub}" is a placeholder`);
  }
  for (const real of ['NYC Waterproofing', 'Brick Pointing NYC', 'Karachi Coffee Roasters']) {
    assert.equal(isRealBusinessName(real), true, `"${real}" is a name`);
  }
});

test('a benefit is not a service', () => {
  const html = `<html><body><section class="services">
    <h3>Prevent water leaks and interior damage</h3>
    <h3>Increase property value</h3>
    <h3>Help you pass NYC DOB inspections</h3>
    <h3>Our Brick Restoration Services in NYC</h3>
    <h3>Brick Repointing</h3>
    <h3>Tuckpointing</h3>
    <h3>Mortar Joint Repair</h3>
  </section></body></html>`;
  const services = extractServices(parse(html));

  // The real services survive.
  for (const kept of ['Brick Repointing', 'Tuckpointing', 'Mortar Joint Repair']) {
    assert.ok(services.includes(kept), `expected to keep "${kept}" — got ${JSON.stringify(services)}`);
  }
  // The promises do not.
  for (const dropped of ['Prevent water leaks and interior damage', 'Increase property value', 'Help you pass NYC DOB inspections']) {
    assert.ok(!services.includes(dropped), `expected to drop "${dropped}"`);
  }
});
