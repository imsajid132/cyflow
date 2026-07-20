// Golden parity fixtures — MEASURABLE comparison of the native engine against the
// sanitized Make.com recipes (see design-references/make-scenario/PARITY-COMPARISON.md).
//
// AI text is non-deterministic, so this does NOT assert exact captions. It locks
// the things that ARE deterministic and define parity: the weekday day-type
// SEQUENCE per niche, each day's writing FORMAT and image CONCEPT, the
// concept->poster-layout mapping, the Friday review gating, that the caption
// format is the AUTHORITATIVE Make format (not a generic pillar pick) and stays
// aligned with the poster concept, and the 1080x1080 canvas.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NICHES, DAY_TYPES, weekShapeFor, dayTypeFor, strategyForNiche, resolveWeek,
  layoutForConcept, CONCEPT_LAYOUT,
} from '../src/services/makeContentStrategy.js';
import { buildBriefSet } from '../src/services/plannerBriefService.js';
import { resolveRhythm } from '../src/services/weeklyRhythmService.js';
import { buildTemplate } from '../src/templates/socialImageTemplates.js';

// The golden, measurable per-day recipe for each niche (day-type key -> shape).
const CONTRACTOR_GOLDEN = [
  ['service_spotlight', 'service_benefit', 'service_card'],
  ['trust_stat', 'authority', 'stat_card'],
  ['code_tip', 'educational_insight', 'cheatsheet'],
  ['project_showcase', 'process', 'project_card'],
  ['maintenance_tip', 'quick_tip', 'cheatsheet'],
  ['pro_tip_warning', 'common_mistake', 'warning_card'],
  ['brand_insight', 'soft_promo', 'quote_card'],
];
const KNOWLEDGE_GOLDEN = [
  ['educational_tip', 'educational_insight', 'cheatsheet'],
  ['category_insight', 'educational_insight', 'quote_card'],
  ['hot_take_myth', 'myth_fact', 'comparison'],
  ['how_to_guide', 'checklist', 'cheatsheet'],
  ['industry_trend', 'educational_insight', 'quote_card'],
  ['quick_hack', 'quick_tip', 'cheatsheet'],
  ['thought_leadership', 'authority', 'quote_card'],
];

test('the contractor weekday sequence matches the Make recipe exactly', () => {
  const shape = weekShapeFor(NICHES.LOCAL_SERVICE);
  assert.equal(shape.length, 7);
  shape.forEach((day, i) => {
    const [key, format, concept] = CONTRACTOR_GOLDEN[i];
    assert.equal(day.key, key, `day ${i + 1} key`);
    assert.equal(day.format, format, `day ${i + 1} format`);
    assert.equal(day.imageConcept, concept, `day ${i + 1} concept`);
  });
});

test('the knowledge weekday sequence matches the Make recipe exactly', () => {
  const shape = weekShapeFor(NICHES.KNOWLEDGE_BUSINESS);
  assert.equal(shape.length, 7);
  shape.forEach((day, i) => {
    const [key, format, concept] = KNOWLEDGE_GOLDEN[i];
    assert.equal(day.key, key, `day ${i + 1} key`);
    assert.equal(day.format, format, `day ${i + 1} format`);
    assert.equal(day.imageConcept, concept, `day ${i + 1} concept`);
  });
});

test('every image concept maps to a real poster-* layout family', () => {
  for (const concept of Object.keys(CONCEPT_LAYOUT)) {
    const layout = layoutForConcept(concept);
    assert.ok(/^poster-/.test(layout), `${concept} -> ${layout} must be a poster family`);
  }
  // The eight Make concepts are all present.
  for (const c of ['service_card', 'stat_card', 'cheatsheet', 'project_card', 'warning_card', 'quote_card', 'comparison', 'testimonial']) {
    assert.ok(c in CONCEPT_LAYOUT, `${c} must map to a layout`);
  }
});

test('Friday is the maintenance tip until a real review exists, then the testimonial', () => {
  const strat = strategyForNiche(NICHES.LOCAL_SERVICE);
  const noReview = resolveWeek(strat, { hasReview: false });
  assert.equal(dayTypeFor({ week: noReview }, 5).key, 'maintenance_tip', 'no review -> maintenance');
  const withReview = resolveWeek(strat, { hasReview: true });
  assert.equal(dayTypeFor({ week: withReview }, 5).key, 'testimonial_spotlight', 'a real review -> testimonial');
  // A knowledge business has no testimonial gating; Friday stays the trend.
  const kStrat = strategyForNiche(NICHES.KNOWLEDGE_BUSINESS);
  assert.equal(dayTypeFor({ week: resolveWeek(kStrat, { hasReview: true }) }, 5).key, 'industry_trend');
});

const week = (dates) => dates.map((d, i) => ({ localDate: d, weekday: i + 1, scheduledForUtc: `${d} 09:00:00` }));
const MON_SUN = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];

test('buildBriefSet produces the AUTHORITATIVE Make format per weekday, aligned with the poster', () => {
  // A contractor profile (no knowledge signals) -> local service rhythm.
  const briefs = buildBriefSet({
    slots: week(MON_SUN),
    preferences: { contentMix: { soft_promo: 10 } }, // a mix that must NOT override the recipe
    profile: { businessName: 'Acme Waterproofing', businessCategory: 'Waterproofing contractor', services: ['Basement Waterproofing', 'French Drain', 'Sump Pump'] },
    platforms: ['facebook'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });
  assert.equal(briefs.length, 7);
  // The caption format on each day is the Make day-type format (authoritative),
  // regardless of the generic pillar or the content mix. Friday defaults to the
  // maintenance tip (no review on this profile).
  const expectedFormats = CONTRACTOR_GOLDEN.map(([, format]) => format);
  assert.deepEqual(briefs.map((b) => b.format), expectedFormats, 'authoritative Make formats, Mon..Sun');
  // The poster template each caption renders on is the concept's poster layout —
  // caption shape and image concept stay on the same intent.
  briefs.forEach((b, i) => {
    const concept = CONTRACTOR_GOLDEN[i][2];
    assert.equal(b.templateKey, layoutForConcept(concept), `day ${i + 1}: caption/poster aligned`);
  });
});

test('a knowledge business runs the knowledge recipe, never the contractor one', () => {
  const briefs = buildBriefSet({
    slots: week(MON_SUN),
    preferences: {},
    profile: { businessName: 'Peralytics', businessCategory: 'SEO agency', businessDescription: 'search and AI visibility consulting', services: ['Technical SEO', 'Content Strategy', 'Local SEO'] },
    platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });
  assert.deepEqual(briefs.map((b) => b.format), KNOWLEDGE_GOLDEN.map(([, format]) => format));
  // No contractor-only concept (warning/stat/service card) leaks into a
  // knowledge week's Monday–Wednesday.
  assert.equal(briefs[0].templateKey, layoutForConcept('cheatsheet'));
  assert.equal(briefs[2].templateKey, layoutForConcept('comparison'));
});

test('the poster canvas is exactly 1080x1080 (Make parity)', () => {
  const built = buildTemplate({
    template: 'poster-service', aspectRatio: 'square', backgroundStyle: 'light',
    brandName: 'Acme', headline: 'Where basement water comes from', subheadline: 'Seal it at the source',
    primaryColor: '#0B1A2E', accentColor: '#DC2626',
  });
  assert.equal(built.width, 1080, 'canvas width');
  assert.equal(built.height, 1080, 'canvas height');
});
