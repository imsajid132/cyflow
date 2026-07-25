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

test('the site photographs are collected, and the junk is not', () => {
  const html = `<html><head><meta property="og:image" content="/img/preview.jpg"></head><body>
    <img src="/img/hero-facade.jpg" alt="Restored brownstone facade" width="1600" height="900">
    <img src="/img/crew-at-work.png" alt="Crew repointing" width="1200" height="800">
    <img src="/img/logo.svg" alt="Logo" width="200" height="60">
    <img src="/img/icon-check.png" alt="" width="24" height="24">
    <img src="data:image/gif;base64,R0lGOD" alt="tracking">
    <img src="/img/spacer.png" alt="" width="1" height="1">
  </body></html>`;
  const images = extractImages(parse(html), 'https://example.test/');
  const urls = images.map((i) => i.url);

  assert.ok(urls.some((u) => u.endsWith('/img/hero-facade.jpg')), 'the hero photo is kept');
  assert.ok(urls.some((u) => u.endsWith('/img/crew-at-work.png')), 'the crew photo is kept');
  assert.ok(urls.some((u) => u.endsWith('/img/preview.jpg')), 'og:image is kept');
  for (const junk of ['logo', 'icon-check', 'spacer', 'data:']) {
    assert.ok(!urls.some((u) => u.includes(junk)), `${junk} must not be offered as a photo`);
  }
  // Alt text travels with the picture — the designer needs to know what it shows.
  assert.equal(images.find((i) => i.url.endsWith('hero-facade.jpg')).alt, 'Restored brownstone facade');
});

test('a relative image is resolved against the site, never left relative', () => {
  const images = extractImages(parse('<img src="photos/shop.jpg" width="900">'), 'https://example.test/about/');
  assert.equal(images[0].url, 'https://example.test/about/photos/shop.jpg');
});
