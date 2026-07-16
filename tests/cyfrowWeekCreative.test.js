/**
 * Phase 4.8 — the controlled Cyfrow week, as a test.
 *
 * The same seven cards the render review looks at, checked deterministically so
 * a regression fails CI rather than waiting for someone to notice it in a
 * picture. Tests do not look at pictures; this covers what they CAN check, and
 * the rendered contact sheet covers the rest.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTemplate } from '../src/templates/socialImageTemplates.js';
import { sanitizeForTest, createSocialImageService } from '../src/services/socialImageService.js';
import { buildPalette } from '../src/templates/brandKit.js';
import { PLAN } from './helpers/samplePlan.mjs';
import { VISUAL_FAMILIES, CONTENT_PILLARS } from '../src/config/constants.js';

const CYFROW = Object.freeze({
  brandName: 'Cyfrow Solutions',
  website: 'cyfrowsolutions.com',
  primaryColor: '#111827',
  secondaryColor: '#23A455',
  accentColor: '#FDC70F',
});

/** Hues that are neither Cyfrow's nor any customer's: retired app placeholders. */
const FORBIDDEN_HUES = ['#1f3a8a', '#e0653a', '#6366f1', '#4f46e5', '#8b5cf6', '#ec4899', '#0ea5e9'];
/** Cyflow's OWN brand. It must never appear inside a customer's post. */
const CYFLOW_GREENS = ['#1f9e5b', '#1a844c'];

function render(post) {
  const built = buildTemplate({
    ...CYFROW,
    template: post.templateKey,
    aspectRatio: 'square',
    backgroundStyle: 'light',
    headline: post.headline,
    subheadline: post.subheadline,
    cta: post.cta,
    serviceTag: post.serviceTag,
    badge: post.badge,
    bullets: post.bullets,
    comparison: post.comparison,
    answerSummary: post.answerSummary,
    locationLabel: post.localLabel,
    stat: null,
  });
  return { built, html: sanitizeForTest(built.html) };
}

// --- the week's strategy ----------------------------------------------------

test('the week runs the Balanced rhythm, Monday to Sunday', () => {
  assert.deepEqual(PLAN.map((p) => p.weekday), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(PLAN.map((p) => p.pillar), [
    'educational_insight', 'service_promotion', 'trust_authority', 'problem_solution',
    'actionable_tips', 'engagement_local', 'soft_promo_recap',
  ]);
  for (const post of PLAN) assert.ok(CONTENT_PILLARS.includes(post.pillar));
});

test('the week reaches at least five visual families and never repeats one twice running', () => {
  const layouts = PLAN.map((p) => p.templateKey);
  assert.ok(new Set(layouts).size >= 5, `only ${new Set(layouts).size} layouts: ${layouts.join(', ')}`);
  for (let i = 1; i < layouts.length; i += 1) {
    assert.notEqual(layouts[i], layouts[i - 1], `days ${i} and ${i + 1} share a layout`);
  }
});

test('each post\'s named family and its layout agree', () => {
  for (const post of PLAN) {
    const family = VISUAL_FAMILIES[post.visualFamily];
    assert.ok(family, `${post.visualFamily} is not a real family`);
    assert.equal(family.layout, post.templateKey, `day ${post.day}: ${post.visualFamily} != ${post.templateKey}`);
  }
});

test('promotion does not dominate a Balanced week', () => {
  const promo = PLAN.filter((p) => ['service_promotion', 'soft_promo_recap'].includes(p.pillar));
  assert.ok(promo.length <= 2, `${promo.length} of 7 posts are promotional`);
});

test('the week uses at least four writing formats', () => {
  assert.ok(new Set(PLAN.map((p) => p.format)).size >= 4);
});

// --- the customer's brand, exactly ------------------------------------------

test('the Cyfrow palette resolves with no adjustment', () => {
  const palette = buildPalette({ ...CYFROW, backgroundStyle: 'light' });
  assert.equal(palette.source, 'saved_brand_palette');
  assert.deepEqual(palette.adjusted, []);
  assert.equal(palette.brand, '#111827');
  assert.equal(palette.accent, '#fdc70f');
  assert.equal(palette.support, '#23a455');
});

test('every card carries the exact saved colours and no unrelated hue', () => {
  for (const post of PLAN) {
    const css = render(post).built.css.toLowerCase();
    assert.ok(css.includes('#111827'), `day ${post.day} lost the brand colour`);
    assert.ok(css.includes('#fdc70f'), `day ${post.day} lost the accent`);
    for (const hex of FORBIDDEN_HUES) {
      assert.ok(!css.includes(hex), `day ${post.day} rendered unrelated ${hex}`);
    }
  }
});

test('the Cyflow app green never enters a customer creative', () => {
  for (const post of PLAN) {
    const { built, html } = render(post);
    for (const hex of CYFLOW_GREENS) {
      assert.ok(!built.css.toLowerCase().includes(hex), `day ${post.day}: Cyflow green leaked in`);
    }
    for (const marker of ['cyflow-mark', '/assets/brand/']) {
      assert.ok(!html.includes(marker), `day ${post.day}: a Cyflow asset reached a customer post`);
    }
  }
});

test('the customer green appears selectively across the week, not everywhere', () => {
  const withSupport = PLAN.filter((post) => render(post).built.css.toLowerCase().includes('#23a455'));
  assert.ok(withSupport.length >= 1, 'the saved green should appear somewhere');
  assert.ok(withSupport.length < PLAN.length, 'the saved green must not be forced onto every card');
});

// --- the content blocks survive ---------------------------------------------

test('every structured content block survives the production sanitizer', () => {
  for (const post of PLAN) {
    const { html } = render(post);
    if (post.bullets?.length) {
      assert.ok(/<li/.test(html), `day ${post.day}: the list was flattened`);
      for (const bullet of post.bullets) assert.ok(html.includes(bullet), `day ${post.day}: lost "${bullet}"`);
    }
    if (post.comparison) {
      assert.ok(html.includes(post.comparison.leftTitle));
      assert.ok(html.includes(post.comparison.rightTitle));
      for (const item of [...post.comparison.leftItems, ...post.comparison.rightItems]) {
        assert.ok(html.includes(item), `day ${post.day}: lost comparison item "${item}"`);
      }
    }
    assert.ok(html.includes(post.badge), `day ${post.day}: lost its badge`);
    assert.ok(/grid-field/.test(html), `day ${post.day}: lost its field treatment`);
  }
});

test('a FAQ answer is not truncated into nonsense, through the PRODUCTION path', async () => {
  /*
   * This test is written against socialImageService, NOT buildTemplate.
   *
   * The first version called buildTemplate directly and passed while the real
   * defect was still live: `answerSummary` was escaped and clamped correctly in
   * the builder, but socialImageService never FORWARDED it, so every real card
   * fell back to the subheadline and rendered its answer cut off mid-word. A
   * test that hands the builder a key production never sends proves nothing
   * about production. This one goes through the service the app actually calls.
   */
  const faq = PLAN.find((p) => p.templateKey === 'faq-editorial');
  assert.ok(faq?.answerSummary, 'the sample plan needs a FAQ with an answer');
  assert.ok(faq.answerSummary.length > 140, 'meaningless unless the answer exceeds the old subheadline limit');

  let renderedHtml = null;
  const service = createSocialImageService({
    integrationRepository: { getHctiCredentialRecord: async () => ({ configured: true, verifiedAt: '2026-01-01', encryptedUserId: 'v1:x', encryptedApiKey: 'v1:x' }) },
    decryptSecret: () => 'x',
    apiUsage: { recordUsage: async () => {} },
    // Capture exactly the html the renderer would receive.
    hctiService: { generateImage: async ({ html }) => { renderedHtml = html; return { imageId: 'i', url: 'https://example.com/i.png' }; } },
  });

  await service.generateSocialImage({
    userId: '1',
    template: faq.templateKey,
    brandName: 'Cyfrow Solutions',
    headline: faq.headline,
    subheadline: faq.subheadline,
    answerSummary: faq.answerSummary,
    badge: faq.badge,
    bullets: faq.bullets,
    ...CYFROW,
  });

  assert.ok(renderedHtml, 'the renderer received nothing');
  assert.ok(!renderedHtml.includes('…'), 'the answer reached the card ellipsised');
  const tail = faq.answerSummary.trim().split(/\s+/).slice(-4).join(' ');
  assert.ok(renderedHtml.includes(tail), `the answer was cut short before "${tail}"`);
});

test('no card claims a statistic, because the business supplied none', () => {
  for (const post of PLAN) {
    const { html } = render(post);
    assert.ok(!/\d+\s*%/.test(html), `day ${post.day}: a percentage appeared on a card`);
  }
});

test('no card contains a forbidden dash', () => {
  for (const post of PLAN) {
    const { html } = render(post);
    assert.ok(!/[—–]/.test(html), `day ${post.day}: a dash reached the card`);
  }
});

test('no render fetches a remote asset', () => {
  for (const post of PLAN) {
    assert.ok(!/url\s*\(/i.test(render(post).built.css), `day ${post.day} emitted a url()`);
  }
});
