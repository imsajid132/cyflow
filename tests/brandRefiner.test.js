// What the page MEANS, after the parser has said what it CONTAINS.
//
// A real SEO company came back with its industry as "Professional service" — the
// generic schema container it happened to declare — and its services as
// "Six services. One unified playbook.", "Foundations", "Growth" and "The same
// fundamentals, a different finish line.", with the real services mixed in and
// indistinguishable by rule. This is the pass that tells them apart, and the
// guarantees that keep it from making things worse.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';

import { refineBrand } from '../src/services/aiStudio/brandRefiner.js';
import { extractImages } from '../src/services/websiteParser.js';

/** Run `fn` with a stubbed Claude reply and a key in place, then restore. */
async function withClaude(reply, fn) {
  const savedKey = process.env.AI_API_KEY;
  const savedFetch = globalThis.fetch;
  process.env.AI_API_KEY = 'test-key';
  globalThis.fetch = async () => new Response(
    JSON.stringify({ content: [{ type: 'text', text: reply }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
  try {
    return await fn();
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedKey;
  }
}

const SCRAPE = {
  websiteUrl: 'https://aiseocompany.com',
  businessName: 'Peralytics',
  industry: 'Professional service',
  description: 'Peralytics AI SEO Company helps brands rank in Google AI Overviews, ChatGPT, Perplexity, Gemini and Claude.',
  services: [
    'Six services. One unified playbook.', 'Generative Engine Optimization',
    'Answer Engine Optimization', 'LLM SEO', 'Foundations', 'Visibility', 'Growth',
    'The same fundamentals, a different finish line.',
  ],
};

test('the real services survive and the headings do not', async () => {
  const out = await withClaude(JSON.stringify({
    industry: 'AI SEO agency',
    description: 'An SEO agency that helps brands appear in AI answers.',
    services: ['Generative Engine Optimization', 'Answer Engine Optimization', 'LLM SEO'],
    tone: 'direct, technical, confident',
  }), () => refineBrand(SCRAPE));

  assert.equal(out.industry, 'AI SEO agency', 'a specific trade, not a schema container');
  assert.deepEqual(out.services, ['Generative Engine Optimization', 'Answer Engine Optimization', 'LLM SEO']);
  assert.ok(!out.services.includes('Foundations'), 'a section heading is not a service');
  assert.equal(out.tone, 'direct, technical, confident');
});

test('a generic container handed back is refused, not shown as an improvement', async () => {
  for (const generic of ['Professional service', 'Organization', 'Local business', 'Company']) {
    // eslint-disable-next-line no-await-in-loop
    const out = await withClaude(JSON.stringify({ industry: generic, services: [], description: '', tone: '' }),
      () => refineBrand(SCRAPE));
    assert.equal(out.industry, '', `"${generic}" says nothing and must not replace the scrape`);
  }
});

test('with no AI configured the scrape is left exactly as it was', async () => {
  const saved = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    assert.equal(await refineBrand(SCRAPE), null, 'null means "keep what you had"');
  } finally {
    if (saved !== undefined) process.env.AI_API_KEY = saved;
  }
});

test('an AI failure loses nothing', async () => {
  const savedKey = process.env.AI_API_KEY;
  const savedFetch = globalThis.fetch;
  process.env.AI_API_KEY = 'test-key';
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    assert.equal(await refineBrand(SCRAPE), null);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedKey;
  }
});

test('nonsense back from the model does not become brand data', async () => {
  const out = await withClaude('I could not read that site, sorry!', () => refineBrand(SCRAPE));
  assert.equal(out, null, 'no JSON, no refinement');
});

/*
 * The other half of the same failure: five "photos from your site" that were all
 * the company's CUSTOMERS' logos, from a trusted-by strip. On a poster they
 * would advertise somebody else.
 */
test('a customers logo strip is labelled, not hidden — the library keeps everything', () => {
  const html = `<html><body>
    <img src="/img/our-work-facade.jpg" alt="Facade we restored" width="1400" height="900">
    <section class="trusted-by">
      <h3>Trusted by</h3>
      <img src="/img/acme-co.png" alt="Acme" width="400" height="200">
      <img src="/img/sparr.png" alt="Sparr" width="400" height="200">
    </section>
    <div class="client-logos">
      <img src="/img/tc-services.png" alt="TC Services" width="400" height="200">
    </div>
  </body></html>`;
  const images = extractImages(parse(html), 'https://example.test/');
  const byName = (part) => images.find((i) => i.url.includes(part));

  /*
   * Dropping these was wrong twice over: a site was left showing no pictures at
   * all, and an owner who wanted one of them had no way to reach it. Every
   * picture the site uses is in the library; the KIND is what decides whether it
   * starts selected.
   */
  assert.equal(images.length, 4, 'every picture is in the library');
  assert.equal(byName('our-work-facade').kind, 'photo');
  for (const other of ['acme-co', 'sparr', 'tc-services']) {
    assert.equal(byName(other).kind, 'logo', `${other} is a mark, and is labelled as one`);
  }
});

/*
 * A rule cannot tell a company's own work from its customers' logos; the model
 * can, from the description and the filename. What matters most is the failure
 * shape: no opinion must never be read as "throw the photographs away".
 */
test('the model picks the photographs that are actually of this business', async () => {
  const images = [
    { url: 'https://x.test/img/our-facade.jpg', alt: 'Facade we restored' },
    { url: 'https://x.test/img/acme-logo.png', alt: 'Acme' },
    { url: 'https://x.test/img/crew.jpg', alt: 'Our crew on site' },
  ];
  const out = await withClaude(JSON.stringify({
    industry: 'Masonry contractor', description: '', services: [], tone: '', keepImages: [0, 2],
  }), () => refineBrand({ ...SCRAPE, images }));
  assert.deepEqual(out.keepImages, [0, 2], 'the client logo is left out');
});

test('an out-of-range index is ignored rather than trusted', async () => {
  const images = [{ url: 'https://x.test/a.jpg', alt: 'A' }];
  const out = await withClaude(JSON.stringify({ industry: 'X', services: [], keepImages: [0, 5, -1, 'two'] }),
    () => refineBrand({ ...SCRAPE, images }));
  assert.deepEqual(out.keepImages, [0]);
});

test('no opinion on the images is not a decision to discard them', async () => {
  const images = [{ url: 'https://x.test/a.jpg', alt: 'A' }, { url: 'https://x.test/b.jpg', alt: 'B' }];
  const out = await withClaude(JSON.stringify({ industry: 'X', description: '', services: [], tone: '' }),
    () => refineBrand({ ...SCRAPE, images }));
  assert.equal(out.keepImages, null, 'null tells the caller to keep every picture');
});
