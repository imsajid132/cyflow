/**
 * Phase 4.8 — the weekly content rhythm.
 *
 * The defect this replaces: strategy was dealt by POSITION, so a plan starting
 * on a Thursday opened with whatever came first in the deal, and every short
 * plan looked the same. Strategy now follows the real calendar weekday.
 *
 * These are pure-function tests: no model, no database, no clock.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRhythm,
  weekdayConfig,
  pillarSequenceForDay,
  formatsForPillar,
  visualFamiliesForPillar,
  familyLayout,
  describeRhythm,
  isPreset,
} from '../src/services/weeklyRhythmService.js';
import { buildBriefSet } from '../src/services/plannerBriefService.js';
import {
  CONTENT_PILLARS,
  RHYTHM_PRESETS,
  RHYTHM_PRESET_PILLARS,
  VISUAL_FAMILIES,
  PLANNER_FORMATS,
  PILLAR_FORMATS,
  PILLAR_VISUAL_FAMILIES,
} from '../src/config/constants.js';

/** A slot as the schedule engine really produces it. */
function slot(localDate, weekday, localTime = '09:00') {
  return {
    localDate,
    localTime,
    weekday,
    scheduledForUtc: `${localDate} ${localTime}:00`,
    scheduledForInstant: new Date(`${localDate}T${localTime}:00Z`),
  };
}

// --- the Balanced rhythm ----------------------------------------------------

test('the Balanced rhythm maps the brief\'s pillar to every weekday', () => {
  const rhythm = resolveRhythm({ preset: 'balanced' });
  const expected = {
    1: 'educational_insight',   // Monday
    2: 'service_promotion',     // Tuesday
    3: 'trust_authority',       // Wednesday
    4: 'problem_solution',      // Thursday
    5: 'actionable_tips',       // Friday
    6: 'engagement_local',      // Saturday
    7: 'soft_promo_recap',      // Sunday
  };
  for (const [weekday, pillar] of Object.entries(expected)) {
    assert.equal(weekdayConfig(rhythm, Number(weekday)).pillar, pillar, `weekday ${weekday}`);
  }
});

test('every preset exists, covers all seven weekdays, and names real pillars', () => {
  for (const preset of RHYTHM_PRESETS) {
    assert.ok(isPreset(preset));
    const rhythm = resolveRhythm({ preset });
    assert.equal(rhythm.preset, preset);
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const config = weekdayConfig(rhythm, weekday);
      assert.ok(config, `${preset} has no config for weekday ${weekday}`);
      assert.ok(CONTENT_PILLARS.includes(config.pillar), `${preset}/${weekday}: ${config.pillar}`);
      assert.equal(config.enabled, true);
    }
  }
});

test('the themed presets genuinely differ from Balanced', () => {
  const balanced = RHYTHM_PRESET_PILLARS.balanced;
  for (const preset of ['education_led', 'trust_building', 'growth_promotion', 'local_business']) {
    const pillars = RHYTHM_PRESET_PILLARS[preset];
    const differs = [1, 2, 3, 4, 5, 6, 7].some((d) => pillars[d] !== balanced[d]);
    assert.ok(differs, `${preset} is identical to balanced`);
  }
});

test('an unknown preset falls back to Balanced rather than breaking', () => {
  const rhythm = resolveRhythm({ preset: 'nonsense' });
  assert.equal(rhythm.preset, 'balanced');
  assert.equal(weekdayConfig(rhythm, 1).pillar, 'educational_insight');
});

// --- custom weekday overrides -----------------------------------------------

test('a custom rhythm overrides only the weekdays it names', () => {
  const rhythm = resolveRhythm({
    preset: 'balanced',
    customRhythm: { 3: { pillar: 'actionable_tips' } },
  });
  assert.equal(weekdayConfig(rhythm, 3).pillar, 'actionable_tips', 'Wednesday overridden');
  assert.equal(weekdayConfig(rhythm, 1).pillar, 'educational_insight', 'Monday untouched');
  assert.equal(weekdayConfig(rhythm, 4).pillar, 'problem_solution', 'Thursday untouched');
});

test('a weekday can be disabled, and a locked weekday can pin format and family', () => {
  const rhythm = resolveRhythm({
    preset: 'balanced',
    customRhythm: {
      6: { enabled: false },
      2: { locked: true, format: 'checklist', visualFamily: 'checklist_guide', ctaMode: 'direct_cta' },
    },
  });
  assert.equal(weekdayConfig(rhythm, 6).enabled, false);
  const tuesday = weekdayConfig(rhythm, 2);
  assert.equal(tuesday.locked, true);
  assert.equal(tuesday.format, 'checklist');
  assert.equal(tuesday.visualFamily, 'checklist_guide');
  assert.equal(tuesday.ctaMode, 'direct_cta');
});

test('a custom rhythm ignores values that are not real pillars, formats or families', () => {
  const rhythm = resolveRhythm({
    preset: 'balanced',
    customRhythm: {
      1: { pillar: 'made_up_pillar', format: 'not_a_format', visualFamily: 'not_a_family', ctaMode: 'shouting' },
    },
  });
  const monday = weekdayConfig(rhythm, 1);
  assert.equal(monday.pillar, 'educational_insight', 'a bogus pillar falls back to the preset');
  assert.equal(monday.format, null);
  assert.equal(monday.visualFamily, null);
  assert.equal(monday.ctaMode, 'automatic');
});

test('string weekday keys work too, because JSON round-trips numbers as strings', () => {
  const rhythm = resolveRhythm({ preset: 'balanced', customRhythm: { '4': { pillar: 'trust_authority' } } });
  assert.equal(weekdayConfig(rhythm, 4).pillar, 'trust_authority');
});

test('a resolved rhythm is frozen, so nothing downstream can mutate a run snapshot', () => {
  const rhythm = resolveRhythm({ preset: 'balanced' });
  assert.throws(() => { rhythm.weekdays[1].pillar = 'service_promotion'; }, TypeError);
  assert.equal(weekdayConfig(rhythm, 1).pillar, 'educational_insight');
});

// --- the actual calendar weekday --------------------------------------------

test('a Thursday-to-Saturday plan starts on Thursday strategy, not Monday', () => {
  // 2026-07-16 is a Thursday.
  const slots = [slot('2026-07-16', 4), slot('2026-07-17', 5), slot('2026-07-18', 6)];
  const briefs = buildBriefSet({
    slots,
    preferences: {},
    profile: { services: ['Local SEO'] },
    platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });

  assert.equal(briefs.length, 3);
  assert.equal(briefs[0].pillar, 'problem_solution', 'Thursday');
  assert.equal(briefs[1].pillar, 'actionable_tips', 'Friday');
  assert.equal(briefs[2].pillar, 'engagement_local', 'Saturday');
  assert.notEqual(briefs[0].pillar, 'educational_insight', 'must not open with Monday strategy');
});

test('a full week lands each Balanced pillar on its own weekday', () => {
  // 2026-07-13 is a Monday.
  const dates = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
  const slots = dates.map((d, i) => slot(d, i + 1));
  const briefs = buildBriefSet({
    slots, preferences: {}, profile: { services: ['On-Page SEO'] }, platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });

  assert.deepEqual(briefs.map((b) => b.pillar), [
    'educational_insight', 'service_promotion', 'trust_authority', 'problem_solution',
    'actionable_tips', 'engagement_local', 'soft_promo_recap',
  ]);
  // Each brief carries the weekday it was built for.
  assert.deepEqual(briefs.map((b) => b.weekday), [1, 2, 3, 4, 5, 6, 7]);
});

test('a weekend-only plan uses weekend strategy', () => {
  const slots = [slot('2026-07-18', 6), slot('2026-07-19', 7)];
  const briefs = buildBriefSet({
    slots, preferences: {}, profile: null, platforms: ['threads'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });
  assert.equal(briefs[0].pillar, 'engagement_local');
  assert.equal(briefs[1].pillar, 'soft_promo_recap');
});

test('a custom rhythm actually changes what a plan writes about', () => {
  const slots = [slot('2026-07-13', 1)];
  const briefs = buildBriefSet({
    slots, preferences: {}, profile: null, platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced', customRhythm: { 1: { pillar: 'trust_authority' } } }),
  });
  assert.equal(briefs[0].pillar, 'trust_authority');
});

// --- multiple posts per day -------------------------------------------------

test('a day\'s first post takes its pillar; the rest take complements', () => {
  const sequence = pillarSequenceForDay('service_promotion', 3);
  assert.equal(sequence.length, 3);
  assert.equal(sequence[0], 'service_promotion', 'the primary is the weekday pillar');
  assert.equal(new Set(sequence).size, 3, 'no pillar repeats within a day');
  for (const pillar of sequence) assert.ok(CONTENT_PILLARS.includes(pillar));
});

test('one post a day is just the primary pillar', () => {
  assert.deepEqual(pillarSequenceForDay('actionable_tips', 1), ['actionable_tips']);
});

test('a pillar sequence never loops forever, even asking for more than exist', () => {
  const sequence = pillarSequenceForDay('educational_insight', 7);
  assert.equal(sequence.length, 7);
  assert.equal(sequence[0], 'educational_insight');
});

test('two posts on one day differ in pillar, format and visual family', () => {
  // Two slots, same calendar day, different times.
  const slots = [slot('2026-07-14', 2, '09:00'), slot('2026-07-14', 2, '17:00')];
  const briefs = buildBriefSet({
    slots, preferences: {}, profile: { services: ['On-Page SEO', 'Local SEO'] }, platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });

  assert.equal(briefs.length, 2);
  assert.equal(briefs[0].pillar, 'service_promotion', 'the morning post is the weekday pillar');
  assert.notEqual(briefs[1].pillar, briefs[0].pillar, 'the evening post must complement, not repeat');
  assert.notEqual(briefs[1].format, briefs[0].format, 'two posts in a day must not share a format');
  assert.notEqual(briefs[1].templateKey, briefs[0].templateKey, 'nor a layout');
});

test('the exact selected times are used and no extra time is invented', () => {
  const slots = [slot('2026-07-14', 2, '09:00'), slot('2026-07-14', 2, '17:00')];
  const briefs = buildBriefSet({
    slots, preferences: {}, profile: null, platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });
  assert.deepEqual(briefs.map((b) => b.slot.localTime), ['09:00', '17:00']);
  assert.equal(briefs.length, slots.length, 'never more posts than slots');
});

// --- pillar / format / family coherence -------------------------------------

test('every pillar admits only real formats, and every format is reachable', () => {
  for (const pillar of CONTENT_PILLARS) {
    const formats = formatsForPillar(pillar);
    assert.ok(formats.length > 0, `${pillar} has no formats`);
    for (const format of formats) {
      assert.ok(PLANNER_FORMATS.includes(format), `${pillar} names unknown format ${format}`);
    }
  }
  // Every pillar in the constant table is covered.
  assert.deepEqual(Object.keys(PILLAR_FORMATS).sort(), [...CONTENT_PILLARS].sort());
});

test('every pillar admits only real visual families', () => {
  for (const pillar of CONTENT_PILLARS) {
    const families = visualFamiliesForPillar(pillar);
    assert.ok(families.length > 0, `${pillar} has no families`);
    for (const family of families) {
      assert.ok(VISUAL_FAMILIES[family], `${pillar} names unknown family ${family}`);
    }
  }
  assert.deepEqual(Object.keys(PILLAR_VISUAL_FAMILIES).sort(), [...CONTENT_PILLARS].sort());
});

test('all seventeen required visual families exist and resolve to a real layout', () => {
  const required = [
    'editorial_insight', 'light_editorial', 'service_authority', 'trust_editorial',
    'process_steps', 'problem_solution', 'comparison_cards', 'myth_fact',
    'checklist_guide', 'numbered_steps', 'faq_editorial', 'local_authority',
    'conversational_insight', 'soft_conversion', 'brand_statement', 'weekly_recap',
    'verified_stat',
  ];
  assert.equal(required.length, 17);
  for (const key of required) {
    assert.ok(VISUAL_FAMILIES[key], `missing family: ${key}`);
    assert.ok(VISUAL_FAMILIES[key].label, `${key} needs a label`);
    assert.ok(familyLayout(key, { hasStat: true }), `${key} must resolve to a layout`);
  }
});

test('the families are not seventeen copies of one card', () => {
  const layouts = new Set(Object.values(VISUAL_FAMILIES).map((f) => f.layout));
  assert.ok(layouts.size >= 8, `only ${layouts.size} structural layouts behind 17 families`);
});

test('a stat family with no verified figure never renders a stat layout', () => {
  assert.equal(VISUAL_FAMILIES.verified_stat.requiresStat, true);
  assert.equal(familyLayout('verified_stat', { hasStat: true }), 'stat-highlight');
  assert.notEqual(
    familyLayout('verified_stat', { hasStat: false }),
    'stat-highlight',
    'a stat layout with no stat is the fake-statistic failure',
  );
});

test('a brief\'s visual family and its layout always agree', () => {
  const dates = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
  const slots = dates.map((d, i) => slot(d, i + 1));
  const briefs = buildBriefSet({
    slots, preferences: {}, profile: { services: ['SEO Audit'] }, platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });
  for (const brief of briefs) {
    assert.ok(VISUAL_FAMILIES[brief.visualFamily], `unknown family ${brief.visualFamily}`);
    /*
     * The templateKey now follows the assigned Make image concept (a poster-*
     * layout), which is authoritative over the nominal visual family. So the
     * template is EITHER the family's own layout (older path) OR a poster
     * layout the concept chose. The visualFamily label stays valid either way.
     */
    const posterDriven = brief.templateKey.startsWith('poster-');
    assert.ok(
      posterDriven || VISUAL_FAMILIES[brief.visualFamily].layout === brief.templateKey,
      `day ${brief.weekday}: family ${brief.visualFamily} does not match layout ${brief.templateKey}`,
    );
  }
});

// --- CTA strategy -----------------------------------------------------------

test('a weekday CTA mode drives the post\'s CTA strategy', () => {
  const cases = [
    ['no_cta', false, 'none'],
    ['soft_cta', true, 'soft'],
    ['conversational_cta', true, 'conversational'],
    ['direct_cta', true, 'direct'],
  ];
  for (const [ctaMode, include, strategy] of cases) {
    const briefs = buildBriefSet({
      slots: [slot('2026-07-13', 1)],
      preferences: {},
      profile: { defaultCallToAction: 'Book a call' },
      platforms: ['instagram'],
      rhythm: resolveRhythm({ preset: 'balanced', customRhythm: { 1: { ctaMode } } }),
    });
    assert.equal(briefs[0].includeCta, include, ctaMode);
    assert.equal(briefs[0].ctaStrategy, strategy, ctaMode);
    if (!include) assert.equal(briefs[0].callToAction, null);
  }
});

// --- the brief carries the strategy ------------------------------------------

test('the brief text states the pillar purpose, and invents no business facts', () => {
  const briefs = buildBriefSet({
    slots: [slot('2026-07-15', 3)],
    preferences: {},
    profile: { businessName: 'Cyfrow Solutions', businessCategory: 'SEO agency', services: ['SEO Audit'] },
    platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });
  const brief = briefs[0];
  assert.equal(brief.pillar, 'trust_authority');
  assert.match(brief.brief, /Trust and Authority/);
  assert.match(brief.brief, /Never invent reviews, years, or results/i);
  // Only facts we were given.
  assert.match(brief.brief, /SEO agency/);
  assert.ok(!/\d+ years|\d+ clients|\d+%/.test(brief.brief), 'the brief must not invent figures');
});

test('describeRhythm gives the wizard a full, labelled week', () => {
  const described = describeRhythm(resolveRhythm({ preset: 'balanced' }));
  assert.equal(described.length, 7);
  assert.equal(described[0].weekday, 1);
  assert.equal(described[0].pillarLabel, 'Educational Insight');
  assert.ok(described[0].purpose);
  for (const day of described) {
    assert.ok(day.pillarLabel, `weekday ${day.weekday} needs a label`);
    assert.ok(day.purpose, `weekday ${day.weekday} needs a purpose`);
  }
});

// --- the content mix is a real control, not a decoration --------------------

test('the Make recipe format is authoritative; the content mix cannot override it', () => {
  /*
   * EXACT MAKE PARITY: the Make day-type's own format decides the caption shape,
   * so the caption is written for the same intent the poster is drawn for. The
   * generic content mix may NOT override the recipe — it only fills when the
   * strategy assigned no format. So two opposite mixes produce the SAME formats:
   * the recipe wins.
   */
  const dates = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
  const slots = dates.map((d, i) => slot(d, i + 1));
  const plan = (contentMix) => buildBriefSet({
    slots, preferences: { contentMix }, profile: { services: ['SEO Audit'] }, platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });

  const checklisty = plan({ checklist: 10, faq_answer: 8 });
  const promotional = plan({ soft_promo: 10, comparison: 8 });

  assert.deepEqual(
    checklisty.map((b) => b.format),
    promotional.map((b) => b.format),
    'the Make recipe format is authoritative regardless of the generic content mix',
  );
  // Every slot has a real recipe format (the knowledge day-type formats).
  assert.ok(checklisty.every((b) => typeof b.format === 'string' && b.format.length > 0));
});

test('the mix can never override the weekday pillar', () => {
  const dates = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
  const slots = dates.map((d, i) => slot(d, i + 1));
  // A mix of nothing but promotion must NOT turn Monday into a service advert.
  const briefs = buildBriefSet({
    slots, preferences: { contentMix: { soft_promo: 10 } }, profile: null, platforms: ['instagram'],
    rhythm: resolveRhythm({ preset: 'balanced' }),
  });
  assert.deepEqual(briefs.map((b) => b.pillar), [
    'educational_insight', 'service_promotion', 'trust_authority', 'problem_solution',
    'actionable_tips', 'engagement_local', 'soft_promo_recap',
  ], 'the rhythm owns the purpose of each weekday; the mix only leans the writing');
});
