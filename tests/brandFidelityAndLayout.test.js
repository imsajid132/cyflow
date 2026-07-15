/**
 * Phase 4.7.2 — brand colour fidelity, and content-to-layout mapping.
 *
 * The colour tests trace the whole production path with the real Cyfrow
 * palette, and assert against the RENDERED, SANITIZED html+css — the same
 * string socialImageService hands to HCTI. Asserting on buildPalette alone
 * would have missed the defect that actually mattered: the palette was correct
 * and the structured content never reached the template.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTemplate } from '../src/templates/socialImageTemplates.js';
import { sanitizeForTest } from '../src/services/socialImageService.js';
import { buildPalette } from '../src/templates/brandKit.js';
import { dealContentTypes, DEFAULT_CONTENT_MIX } from '../src/services/plannerBriefService.js';
import { FORMAT_TEMPLATES, PLANNER_LIMITS, PLANNER_DESIGN_FAMILIES } from '../src/config/constants.js';
import { PLAN } from './helpers/samplePlan.mjs';

/** The exact saved palette for the working example. */
const CYFROW = Object.freeze({
  primaryColor: '#111827',
  secondaryColor: '#23A455',
  accentColor: '#FDC70F',
});

/** Hues no Cyfrow render may contain: the old fallback palette and its family. */
const FORBIDDEN = ['#1f3a8a', '#e0653a', '#6366f1', '#8b5cf6', '#ec4899'];

function renderFor(post, overrides = {}) {
  const built = buildTemplate({
    template: post.templateKey,
    aspectRatio: 'square',
    backgroundStyle: 'light',
    brandName: 'Cyfrow Solutions',
    businessCategory: 'IT and web services',
    website: 'cyfrowsolutions.com',
    headline: post.headline,
    subheadline: post.subheadline,
    cta: post.cta,
    serviceTag: post.serviceTag,
    bullets: post.bullets,
    stat: post.stat,
    comparison: post.comparison,
    badge: post.badge,
    locationLabel: post.locationLabel,
    ...CYFROW,
    ...overrides,
  });
  return { ...built, safeHtml: sanitizeForTest(built.html) };
}

// --- exact colours -----------------------------------------------------------

test('the saved Cyfrow hexes survive the palette exactly, with no adjustment', () => {
  const p = buildPalette({ ...CYFROW, backgroundStyle: 'light' });
  assert.equal(p.brand, '#111827');
  assert.equal(p.accent, '#fdc70f');
  assert.equal(p.support, '#23a455');
  assert.equal(p.source, 'saved_brand_palette');
  assert.deepEqual(p.adjusted, [], 'no Cyfrow colour should need a readability adjustment');
});

test('every rendered Cyfrow card contains the exact saved brand colours', () => {
  for (const post of PLAN) {
    const { css } = renderFor(post);
    const lower = css.toLowerCase();
    assert.ok(lower.includes('#111827'), `day ${post.day} (${post.templateKey}) lost the brand colour`);
    assert.ok(lower.includes('#fdc70f'), `day ${post.day} (${post.templateKey}) lost the accent colour`);
  }
});

test('no rendered Cyfrow card contains an unrelated blue, purple, pink or orange', () => {
  for (const post of PLAN) {
    const lower = renderFor(post).css.toLowerCase();
    for (const hex of FORBIDDEN) {
      assert.ok(!lower.includes(hex), `day ${post.day} (${post.templateKey}) rendered ${hex}`);
    }
  }
});

test('the fallback palette is only reachable when the business saved no colour at all', () => {
  const none = buildPalette({ backgroundStyle: 'light' });
  assert.equal(none.source, 'fallback_palette');

  // One saved colour is enough to keep the fallback out of the render.
  const one = buildPalette({ primaryColor: '#111827', backgroundStyle: 'light' });
  assert.equal(one.source, 'saved_brand_palette');
  assert.equal(one.brand, '#111827');
});

test('an invalid saved colour never reaches the CSS', () => {
  const p = buildPalette({ primaryColor: 'red; background: url(http://evil)', accentColor: '#FDC70F' });
  assert.ok(!JSON.stringify(p).includes('evil'));
  assert.equal(p.accent, '#fdc70f');
});

test('no render ever emits a url(), so no remote asset can be fetched', () => {
  for (const post of PLAN) {
    const { css } = renderFor(post);
    assert.ok(!/url\s*\(/i.test(css), `day ${post.day} emitted a url() into CSS`);
  }
});

// --- the structured content actually reaches the layout -----------------------

test('checklist bullets survive into the sanitized html', () => {
  const post = PLAN.find((p) => p.templateKey === 'checklist-guide');
  const { safeHtml } = renderFor(post);
  assert.ok(/<li/.test(safeHtml), 'the list was flattened or never rendered');
  for (const bullet of post.bullets) {
    assert.ok(safeHtml.includes(bullet), `bullet missing after sanitization: ${bullet}`);
  }
});

test('comparison columns survive into the sanitized html', () => {
  const post = PLAN.find((p) => p.templateKey === 'comparison-cards');
  const { safeHtml } = renderFor(post);
  assert.ok(safeHtml.includes(post.comparison.leftTitle));
  assert.ok(safeHtml.includes(post.comparison.rightTitle));
  for (const item of [...post.comparison.leftItems, ...post.comparison.rightItems]) {
    assert.ok(safeHtml.includes(item), `comparison item missing: ${item}`);
  }
});

test('the category badge survives into the sanitized html', () => {
  for (const post of PLAN) {
    const { safeHtml } = renderFor(post);
    assert.ok(safeHtml.includes(post.badge), `day ${post.day} lost its badge`);
  }
});

test('a checklist layout with no bullets falls back rather than rendering an empty frame', () => {
  const post = { ...PLAN.find((p) => p.templateKey === 'checklist-guide'), bullets: [] };
  const { safeHtml } = renderFor(post);
  assert.ok(!/<li/.test(safeHtml));
  assert.ok(safeHtml.includes(post.subheadline), 'the fallback subheadline should carry the card');
});

test('a stat layout with no supplied figure never invents one', () => {
  const built = renderFor({
    templateKey: 'stat-highlight',
    headline: 'A specific claim about the work',
    subheadline: 'Supporting line.',
    badge: 'Insight',
    stat: null,
  });
  assert.ok(!/\d+%/.test(built.safeHtml), 'a percentage appeared with no figure supplied');
});

// --- the eyebrow rule is actually rendered ------------------------------------

test('the planner design families render an eyebrow rule above the headline', () => {
  const withEyebrow = ['light-editorial', 'editorial-insight', 'comparison-cards', 'service-authority'];
  for (const template of withEyebrow) {
    const { safeHtml } = renderFor({
      templateKey: template,
      headline: 'A specific and useful headline',
      subheadline: 'Supporting line.',
      badge: 'Insight',
      cta: 'Get in touch',
      serviceTag: 'Web development',
    });
    assert.ok(
      /eyebrow-rule/.test(safeHtml),
      `${template} has no eyebrow rule; reference grammar requires one above the headline`,
    );
  }
});

test('the field treatment survives sanitization', () => {
  for (const post of PLAN) {
    const { safeHtml } = renderFor(post);
    assert.ok(/grid-field/.test(safeHtml), `day ${post.day} (${post.templateKey}) lost its field treatment`);
  }
});

// --- content to layout mapping ------------------------------------------------

test('every format maps only onto layouts that exist', () => {
  for (const [format, templates] of Object.entries(FORMAT_TEMPLATES)) {
    for (const template of templates) {
      assert.ok(
        PLANNER_DESIGN_FAMILIES.includes(template),
        `${format} maps onto ${template}, which is not a planner design family`,
      );
    }
  }
});

test('the layout follows the shape of the message, not a rotation', () => {
  assert.deepEqual(FORMAT_TEMPLATES.checklist, ['checklist-guide']);
  assert.deepEqual(FORMAT_TEMPLATES.comparison, ['comparison-cards']);
  assert.deepEqual(FORMAT_TEMPLATES.service_benefit, ['service-authority']);
  assert.deepEqual(FORMAT_TEMPLATES.local_relevance, ['local-insight']);
  assert.ok(FORMAT_TEMPLATES.myth_fact.includes('comparison-cards'));
});

test('a 7-day plan reaches at least five distinct layouts', () => {
  const primary = (f) => (FORMAT_TEMPLATES[f] || ['editorial-insight'])[0];
  const layouts = dealContentTypes(DEFAULT_CONTENT_MIX, 7).map(primary);
  const distinct = new Set(layouts);
  assert.ok(
    distinct.size >= PLANNER_LIMITS.MIN_DISTINCT_LAYOUTS,
    `only ${distinct.size} layouts across 7 days: ${[...distinct].join(', ')}`,
  );
});

test('a plan never runs the same layout on consecutive days', () => {
  const primary = (f) => (FORMAT_TEMPLATES[f] || ['editorial-insight'])[0];
  for (const count of [3, 5, 7, 14]) {
    const layouts = dealContentTypes(DEFAULT_CONTENT_MIX, count).map(primary);
    for (let i = 1; i < layouts.length; i += 1) {
      assert.notEqual(layouts[i], layouts[i - 1], `${count}-day plan repeats ${layouts[i]} on days ${i} and ${i + 1}`);
    }
  }
});

test("layout variety never overrides the user's own content mix", () => {
  const primary = (f) => (FORMAT_TEMPLATES[f] || ['editorial-insight'])[0];
  // A user who wants only checklists gets only checklists, not five families.
  const only = dealContentTypes({ checklist: 1 }, 7);
  assert.deepEqual([...new Set(only)], ['checklist']);
  assert.deepEqual([...new Set(only.map(primary))], ['checklist-guide']);
});

test('layout variety only ever introduces a format the user weighted above zero', () => {
  const chosen = dealContentTypes({ checklist: 2, comparison: 1 }, 7);
  for (const format of chosen) {
    assert.ok(['checklist', 'comparison'].includes(format), `${format} was smuggled into a restricted mix`);
  }
});

test('the sample plan itself shows at least five layouts and no consecutive repeat', () => {
  const layouts = PLAN.map((p) => p.templateKey);
  assert.ok(new Set(layouts).size >= 5, `only ${new Set(layouts).size} layouts: ${layouts.join(', ')}`);
  for (let i = 1; i < layouts.length; i += 1) {
    assert.notEqual(layouts[i], layouts[i - 1], `days ${i} and ${i + 1} share a layout`);
  }
});

// --- headlines ----------------------------------------------------------------

test('no sample headline exceeds the visual limit or strands a one-word line', () => {
  for (const post of PLAN) {
    const words = post.headline.trim().split(/\s+/);
    assert.ok(words.length >= 3 && words.length <= 10, `day ${post.day}: ${words.length} words`);
    assert.ok(post.headline.length <= 62, `day ${post.day}: ${post.headline.length} chars`);
  }
});
