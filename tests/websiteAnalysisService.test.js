import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWebsiteAnalysisService, isUnsafeSvg } from '../src/services/websiteAnalysisService.js';
import { parsePage, toHexColor, isUtilityColor, firstFontName } from '../src/services/websiteParser.js';

// --- fixtures --------------------------------------------------------------

const HOME_HTML = `<!doctype html>
<html><head>
  <title>Acme Roofing | Springfield</title>
  <meta name="description" content="Trusted roofing since 1998.">
  <meta property="og:site_name" content="Acme Roofing">
  <link rel="icon" href="/favicon.ico">
  <style>
    :root { --brand-primary-color: #1a73e8; --brand-secondary-color: #e8710a; --heading-font: 'Poppins', sans-serif; }
    body { font-family: 'Inter', Arial, sans-serif; color: #ffffff; background: #000000; }
    h1 { font-family: 'Poppins', sans-serif; }
    .btn { background: #1a73e8; border: 1px solid #f8f9fa; }
  </style>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"LocalBusiness","name":"Acme Roofing Ltd",
   "description":"Roofing experts serving Springfield.","logo":"https://acme.example/img/logo.png",
   "telephone":"+1 555 0100","email":"hello@acme.example",
   "address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Springfield","addressRegion":"IL","postalCode":"62704","addressCountry":"US"},
   "sameAs":["https://facebook.com/acme"]}
  </script>
</head><body>
  <header><img class="site-logo" src="/img/header-logo.png" alt="Acme logo"></header>
  <nav><a href="/about">About us</a><a href="/services">Our Services</a><a href="/contact">Contact</a>
       <a href="/logout">Log out</a><a href="https://evil.example/x">External</a></nav>
  <section class="services"><h2>Roof Repair</h2><h2>Gutter Cleaning</h2><h2>Roof Repair</h2></section>
  <a href="https://facebook.com/acme">FB</a><a href="https://instagram.com/acme">IG</a>
</body></html>`;

const ABOUT_HTML = `<html><head><title>About</title></head><body>
  <div class="about"><p>We are a family run roofing business established in 1998.</p></div>
</body></html>`;

const SERVICES_HTML = `<html><head><title>Services</title></head><body>
  <section class="services"><h2>Flat Roofing</h2><h3>Emergency Repairs</h3><h2>Gutter Cleaning</h2></section>
</body></html>`;

const CONTACT_HTML = `<html><head><title>Contact</title></head><body>
  <a href="tel:+15550100">Call</a><a href="mailto:hello@acme.example">Email</a>
</body></html>`;

/** Fake fetch service returning fixtures by URL. */
function fakeFetchService({ pages = {}, images = {} } = {}) {
  const calls = [];
  return {
    _calls: calls,
    async fetchValidated(url) {
      const key = url.toString();
      calls.push(key);
      const html = pages[key];
      if (html === undefined) throw new Error('not fetched in this test');
      return { finalUrl: new URL(key), contentType: 'text/html', text: html, bytes: null };
    },
    async fetchImage(url) {
      const key = url.toString();
      calls.push(key);
      const img = images[key];
      if (img === undefined) throw new Error('image not available');
      return { finalUrl: new URL(key), contentType: img.contentType, text: img.text || '', bytes: null };
    },
  };
}

const PAGES = {
  'https://acme.example/': HOME_HTML,
  'https://acme.example/about': ABOUT_HTML,
  'https://acme.example/services': SERVICES_HTML,
  'https://acme.example/contact': CONTACT_HTML,
};
const IMAGES = {
  'https://acme.example/img/logo.png': { contentType: 'image/png' },
};

function build(extra = {}) {
  const fetchService = extra.fetchService || fakeFetchService({ pages: PAGES, images: IMAGES });
  return {
    fetchService,
    svc: createWebsiteAnalysisService({ fetchService, normalizer: extra.normalizer || null }),
  };
}

// --- parser units ----------------------------------------------------------

test('colors: normalization and utility filtering', () => {
  assert.equal(toHexColor('#1a73e8'), '#1a73e8');
  assert.equal(toHexColor('#abc'), '#aabbcc');
  assert.equal(toHexColor('rgb(26, 115, 232)'), '#1a73e8');
  assert.equal(toHexColor('rgba(26,115,232,0.1)'), null); // effectively transparent
  assert.equal(toHexColor('nonsense'), null);

  assert.equal(isUtilityColor('#ffffff'), true); // white
  assert.equal(isUtilityColor('#f8f9fa'), true); // near-white
  assert.equal(isUtilityColor('#000000'), true); // black
  assert.equal(isUtilityColor('#808080'), true); // grey
  assert.equal(isUtilityColor('#1a73e8'), false); // brand blue
});

test('fonts: only safe plain names are returned', () => {
  assert.equal(firstFontName("'Poppins', sans-serif"), 'Poppins');
  assert.equal(firstFontName('Inter, Arial'), 'Inter');
  assert.equal(firstFontName('url(http://evil/x.woff)'), '');
  assert.equal(firstFontName('inherit'), '');
});

test('parsePage: JSON-LD, logo priority, colors, fonts, services, links', () => {
  const p = parsePage(HOME_HTML, 'https://acme.example/');
  // JSON-LD wins for identity + contacts.
  assert.equal(p.businessName, 'Acme Roofing Ltd');
  assert.equal(p.phone, '+1 555 0100');
  assert.equal(p.email, 'hello@acme.example');
  assert.equal(p.address, '1 Main St');
  assert.equal(p.city, 'Springfield');
  assert.equal(p.postalCode, '62704');
  // Logo: JSON-LD logo has top priority.
  assert.equal(p.logoUrl, 'https://acme.example/img/logo.png');
  assert.equal(p.logoSource, 'json_ld');
  assert.equal(p.faviconUrl, 'https://acme.example/favicon.ico');
  // Brand colors only — white/near-white/black filtered out.
  assert.ok(p.colors.includes('#1a73e8'));
  assert.ok(p.colors.includes('#e8710a'));
  assert.equal(p.colors.includes('#ffffff'), false);
  assert.equal(p.colors.includes('#000000'), false);
  assert.equal(p.colors.includes('#f8f9fa'), false);
  // Fonts from CSS variables / rules.
  assert.equal(p.fonts.headingFont, 'Poppins');
  assert.equal(p.fonts.bodyFont, 'Inter');
  // Services deduplicated.
  assert.deepEqual(p.services, ['Roof Repair', 'Gutter Cleaning']);
  // Social links.
  assert.ok(p.socialLinks.some((s) => s.platform === 'facebook.com'));
  // Crawl candidates: same-site only, no /logout, no external.
  assert.equal(p.pageLinks.about, 'https://acme.example/about');
  assert.equal(p.pageLinks.services, 'https://acme.example/services');
  assert.equal(p.pageLinks.contact, 'https://acme.example/contact');
  assert.equal(JSON.stringify(p.pageLinks).includes('evil.example'), false);
  assert.equal(JSON.stringify(p.pageLinks).includes('logout'), false);
});

test('parsePage: favicon fallback when no logo is present', () => {
  const html = '<html><head><title>X</title><link rel="icon" href="/fav.png"></head><body><p>hi</p></body></html>';
  const p = parsePage(html, 'https://acme.example/');
  assert.equal(p.logoUrl, 'https://acme.example/fav.png');
  assert.equal(p.logoSource, 'favicon');
});

test('parsePage: header logo used when no JSON-LD logo', () => {
  const html = '<html><head><title>X</title></head><body><header><img src="/img/hdr.png" alt="brand"></header></body></html>';
  const p = parsePage(html, 'https://acme.example/');
  assert.equal(p.logoUrl, 'https://acme.example/img/hdr.png');
  assert.equal(p.logoSource, 'header_image');
});

test('parsePage: malformed JSON-LD is ignored, never thrown', () => {
  const html = '<html><head><title>T</title><script type="application/ld+json">{bad json</script></head><body></body></html>';
  assert.doesNotThrow(() => parsePage(html, 'https://acme.example/'));
});

// --- unsafe SVG ------------------------------------------------------------

test('unsafe SVG detection', () => {
  assert.equal(isUnsafeSvg('<svg><script>alert(1)</script></svg>'), true);
  assert.equal(isUnsafeSvg('<svg onload="x()"></svg>'), true);
  assert.equal(isUnsafeSvg('<svg><image xlink:href="https://evil/x"/></svg>'), true);
  assert.equal(isUnsafeSvg('<svg><foreignObject/></svg>'), true);
  assert.equal(isUnsafeSvg('<svg><path d="M0 0"/></svg>'), false);
});

// --- orchestration ---------------------------------------------------------

test('analyzeWebsite: crawls at most 4 same-site pages and merges results', async () => {
  const { svc, fetchService } = build();
  const result = await svc.analyzeWebsite({ userId: '5', websiteUrl: 'acme.example' });

  const pageFetches = fetchService._calls.filter((c) => !c.includes('/img/'));
  assert.ok(pageFetches.length <= 4, `crawled ${pageFetches.length} pages`);
  assert.deepEqual(result.pagesAnalyzed.map((p) => p.kind).sort(), ['about', 'contact', 'home', 'services']);

  const s = result.suggestions;
  assert.equal(s.businessName, 'Acme Roofing Ltd');
  assert.equal(s.phone, '+1 555 0100');
  assert.equal(s.email, 'hello@acme.example');
  assert.equal(s.city, 'Springfield');
  assert.equal(s.primaryColor, '#1a73e8');
  assert.equal(s.headingFont, 'Poppins');
  assert.equal(s.logoUrl, 'https://acme.example/img/logo.png');
  assert.equal(s.logoValidated, true);
  // Services merged from the Services page + homepage, deduplicated.
  assert.ok(s.services.includes('Flat Roofing'));
  assert.ok(s.services.includes('Roof Repair'));
  assert.equal(new Set(s.services).size, s.services.length);
});

test('analyzeWebsite: never returns raw HTML or fetch internals', async () => {
  const { svc } = build();
  const result = await svc.analyzeWebsite({ userId: '5', websiteUrl: 'https://acme.example' });
  const blob = JSON.stringify(result);
  assert.equal(blob.includes('<html'), false);
  assert.equal(blob.includes('<script'), false);
  assert.equal(blob.includes('<style'), false);
  assert.equal(blob.includes('doctype'), false);
});

test('analyzeWebsite: an off-site logo is suggested but never fetched', async () => {
  const html = HOME_HTML.replace('https://acme.example/img/logo.png', 'https://cdn.evil.example/logo.png');
  const fetchService = fakeFetchService({ pages: { 'https://acme.example/': html }, images: {} });
  const { svc } = build({ fetchService });
  const result = await svc.analyzeWebsite({ userId: '5', websiteUrl: 'https://acme.example' });
  assert.equal(result.suggestions.logoUrl, 'https://cdn.evil.example/logo.png');
  assert.equal(result.suggestions.logoValidated, false); // suggestion only
  assert.equal(fetchService._calls.includes('https://cdn.evil.example/logo.png'), false); // never fetched
});

test('analyzeWebsite: an unsafe SVG logo is rejected', async () => {
  const html = HOME_HTML.replace('https://acme.example/img/logo.png', 'https://acme.example/img/logo.svg');
  const fetchService = fakeFetchService({
    pages: { 'https://acme.example/': html },
    images: { 'https://acme.example/img/logo.svg': { contentType: 'image/svg+xml', text: '<svg><script>alert(1)</script></svg>' } },
  });
  const { svc } = build({ fetchService });
  const result = await svc.analyzeWebsite({ userId: '5', websiteUrl: 'https://acme.example' });
  // The unsafe SVG is never adopted; the analyzer falls back to the favicon.
  assert.equal(result.suggestions.logoUrl.includes('logo.svg'), false);
  assert.equal(result.suggestions.logoValidated, false);
});

test('analyzeWebsite: a failing secondary page does not break the analysis', async () => {
  const fetchService = fakeFetchService({ pages: { 'https://acme.example/': HOME_HTML }, images: IMAGES });
  const { svc } = build({ fetchService });
  const result = await svc.analyzeWebsite({ userId: '5', websiteUrl: 'https://acme.example' });
  assert.equal(result.suggestions.businessName, 'Acme Roofing Ltd');
  assert.deepEqual(result.pagesAnalyzed.map((p) => p.kind), ['home']);
});

test('analyzeWebsite: works without OpenAI, and OpenAI failure never blocks', async () => {
  const failing = { async normalizeBusinessText() { throw new Error('openai down'); } };
  const { svc } = build({ normalizer: failing });
  const result = await svc.analyzeWebsite({ userId: '5', websiteUrl: 'https://acme.example' });
  assert.equal(result.suggestions.businessName, 'Acme Roofing Ltd'); // extraction still stands
  assert.equal(result.suggestions.businessDescription.length > 0, true);
});

test('analyzeWebsite: OpenAI normalization is used when available and gets no HTML/PII', async () => {
  const seen = [];
  const normalizer = {
    async normalizeBusinessText(input) {
      seen.push(input);
      return { description: 'Polished description.', services: ['Roofing'], category: 'Roofing Contractor', tone: 'professional' };
    },
  };
  const { svc } = build({ normalizer });
  const result = await svc.analyzeWebsite({ userId: '5', websiteUrl: 'https://acme.example' });
  assert.equal(result.suggestions.businessDescription, 'Polished description.');
  assert.equal(result.suggestions.businessCategory, 'Roofing Contractor');
  // The normalizer must not receive HTML, emails, or phone numbers.
  const blob = JSON.stringify(seen);
  assert.equal(blob.includes('<html'), false);
  assert.equal(blob.includes('hello@acme.example'), false);
  assert.equal(blob.includes('555 0100'), false);
});
