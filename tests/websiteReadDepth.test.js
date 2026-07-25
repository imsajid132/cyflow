// How much of a real site the reader actually gets.
//
// A live read of a real construction company came back with no fonts, no
// industry and no pictures — all three of which the page stated plainly. The
// owner was left filling in by hand what their own markup already said. Each
// test here is one of those gaps.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';

import {
  fontsFromWebfontLinks, extractFonts, extractImages, humanizeSchemaType, extractJsonLd,
} from '../src/services/websiteParser.js';

test('fonts are read from a Google Fonts request when the CSS is external', () => {
  const html = `<html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&family=Inter:wght@400&display=swap">
  </head><body></body></html>`;
  const root = parse(html);
  assert.deepEqual(fontsFromWebfontLinks(root), ['Poppins', 'Inter']);

  // Nothing else names a face, so the request is what the fields report.
  const fonts = extractFonts(root);
  assert.equal(fonts.headingFont, 'Poppins');
  assert.equal(fonts.bodyFont, 'Inter');
});

test('the older css?family= shape and @import are read too', () => {
  const html = `<html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto|Open+Sans">
    <style>@import url("https://fonts.googleapis.com/css2?family=Lora");</style>
  </head><body></body></html>`;
  const names = fontsFromWebfontLinks(parse(html));
  assert.deepEqual(names, ['Roboto', 'Open Sans', 'Lora']);
});

test('a rule in the page still beats a mere webfont request', () => {
  const html = `<html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins">
    <style>h1 { font-family: "Playfair Display", serif; }</style>
  </head><body></body></html>`;
  // A link says a face was loaded; a rule says where it is used.
  assert.equal(extractFonts(parse(html)).headingFont, 'Playfair Display');
});

test('the schema type answers the industry the field was leaving blank', () => {
  assert.equal(humanizeSchemaType('GeneralContractor'), 'General contractor');
  assert.equal(humanizeSchemaType('HVACBusiness'), 'Hvac business');
  assert.equal(humanizeSchemaType('RoofingContractor'), 'Roofing contractor');

  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":["LocalBusiness","GeneralContractor"],"name":"Pioneer Construction NYC"}
  </script></head><body></body></html>`;
  const ld = extractJsonLd(parse(html));
  assert.equal(ld.category, 'General contractor', 'the specific type wins over the generic container');
});

test('every picture the site uses reaches the library, sorted by what it is', () => {
  const html = `<html><head><meta property="og:image" content="/img/preview.jpg"></head><body>
    <img src="/img/hero-facade.jpg" alt="Restored brownstone facade" width="1600" height="900">
    <img src="/img/crew-at-work.png" alt="Crew repointing" width="1200" height="800">
    <img src="/img/logo.svg" alt="Logo" width="200" height="60">
    <img src="/img/icon-check.png" alt="" width="24" height="24">
    <img data-src="/img/lazy-shopfront.jpg" alt="Our shopfront" width="1200" height="800">
    <img srcset="/img/team-800.jpg 800w, /img/team-1600.jpg 1600w" alt="The team">
    <div style="background-image:url('/img/hero-bg.jpg')" aria-label="Workshop"></div>
    <img src="data:image/gif;base64,R0lGOD" alt="tracking">
    <img src="/img/spacer.png" alt="" width="1" height="1">
  </body></html>`;
  const images = extractImages(parse(html), 'https://example.test/');
  const find = (part) => images.find((i) => i.url.includes(part));

  // Photographs, however the site chose to load them.
  for (const photo of ['hero-facade.jpg', 'crew-at-work.png', 'preview.jpg', 'lazy-shopfront.jpg', 'team-800.jpg', 'hero-bg.jpg']) {
    assert.ok(find(photo), `${photo} must reach the library`);
  }
  // Marks and icons are present too — labelled, so they simply start unticked.
  assert.equal(find('logo.svg').kind, 'logo');
  assert.equal(find('icon-check').kind, 'icon');
  assert.equal(find('hero-facade').kind, 'photo');

  // Only genuine non-pictures are refused.
  assert.ok(!find('data:'), 'a tracking pixel is not a picture');
  assert.ok(!find('spacer'), 'a spacer is not a picture');

  // Alt text travels with the picture — the designer needs to know what it shows.
  assert.equal(find('hero-facade.jpg').alt, 'Restored brownstone facade');
});

test('a relative image is resolved against the site, never left relative', () => {
  const images = extractImages(parse('<img src="photos/shop.jpg" width="900">'), 'https://example.test/about/');
  assert.equal(images[0].url, 'https://example.test/about/photos/shop.jpg');
});

/*
 * The case that kept coming back empty: a site whose every font rule resolves to
 * a CSS variable that resolves to another variable. Nothing rule-based can
 * follow that chain — but the site self-hosts the face and says so outright.
 */
test('a self-hosted face is read from the site own @font-face rule', () => {
  const html = `<html><head><style>
    :root { --font-sans: var(--font-inter), ui-sans-serif, system-ui; --font-display: var(--font-inter), sans-serif; }
    @font-face{font-family:Inter;font-style:normal;font-weight:100 900;src:url(/fonts/inter.woff2) format("woff2")}
    body { font-family: var(--font-sans); }
    h1 { font-family: var(--font-display); }
  </style></head><body></body></html>`;
  const fonts = extractFonts(parse(html));
  assert.equal(fonts.headingFont, 'Inter', 'the shipped face is the answer when every rule ends at a var()');
  assert.equal(fonts.bodyFont, 'Inter');
});

test('the other variable naming order is read too', () => {
  const html = `<html><head><style>
    :root { --font-display: Playfair Display, serif; --font-sans: Inter, sans-serif; }
  </style></head><body></body></html>`;
  const fonts = extractFonts(parse(html));
  assert.equal(fonts.headingFont, 'Playfair Display');
  assert.equal(fonts.bodyFont, 'Inter');
});
