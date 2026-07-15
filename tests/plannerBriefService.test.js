// Phase 4.7: the brief builder — where plan variation is engineered.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBriefSet,
  dealContentTypes,
  spread,
  ctaForPosition,
  toneForPosition,
  templateForContentType,
  composeBriefText,
  DEFAULT_CONTENT_MIX,
} from '../src/services/plannerBriefService.js';
import { CONTENT_TYPE_TEMPLATES, PLANNER_CONTENT_TYPES } from '../src/config/constants.js';
import { buildSchedule } from '../src/services/plannerScheduleService.js';

const NOW = new Date('2026-07-13T06:00:00Z');

const PROFILE = {
  businessName: 'Acme Roofing',
  businessCategory: 'Roofing contractor',
  businessDescription: 'Same-week roof repairs across Greater London.',
  city: 'London',
  region: 'Greater London',
  services: ['Roof repair', 'Gutter cleaning', 'Chimney work'],
  defaultCallToAction: 'Book a free quote',
};

function sevenSlots() {
  return buildSchedule({
    startDate: '2026-07-14', planLength: 7, cadence: 'every_day',
    times: ['09:00'], timezone: 'UTC', now: NOW,
  }).slots;
}

test('a weighted mix is allocated proportionally across the plan', () => {
  // 3:1 must stay 3:1 across 8 posts, not drift with rounding.
  const dealt = dealContentTypes({ educational: 3, tips: 1 }, 8);
  assert.equal(dealt.length, 8);
  assert.equal(dealt.filter((t) => t === 'educational').length, 6);
  assert.equal(dealt.filter((t) => t === 'tips').length, 2);
});

test('every dealt type is a real content type and the count is exact', () => {
  for (const count of [1, 3, 5, 7, 14]) {
    const dealt = dealContentTypes(DEFAULT_CONTENT_MIX, count);
    assert.equal(dealt.length, count, `count ${count}`);
    for (const type of dealt) assert.ok(PLANNER_CONTENT_TYPES.includes(type), `${type} is not a content type`);
  }
});

test('an empty or invalid mix falls back to the default rather than producing nothing', () => {
  assert.equal(dealContentTypes({}, 5).length, 5);
  assert.equal(dealContentTypes(null, 5).length, 5);
  assert.equal(dealContentTypes({ educational: 0, tips: -2 }, 5).length, 5);
  assert.equal(dealContentTypes({ nonsense: 5 }, 5).length, 5);
});

test('spread avoids consecutive repeats where possible', () => {
  const out = spread(['a', 'a', 'a', 'b', 'b', 'c']);
  assert.equal(out.length, 6);
  let adjacent = 0;
  for (let i = 1; i < out.length; i += 1) if (out[i] === out[i - 1]) adjacent += 1;
  // 3 a's in 6 slots can always be separated.
  assert.equal(adjacent, 0, `got ${out.join(',')}`);
  // A multiset that cannot be separated must still return every item.
  assert.equal(spread(['a', 'a', 'a']).length, 3);
  assert.deepEqual(spread([]), []);
});

test('a 7-day plan does not repeat the same content type back to back', () => {
  const briefs = buildBriefSet({
    slots: sevenSlots(),
    preferences: { contentMix: DEFAULT_CONTENT_MIX, goals: ['awareness', 'engagement'], tone: 'mixed', ctaMode: 'some' },
    profile: PROFILE,
    platforms: ['facebook'],
  });
  assert.equal(briefs.length, 7);
  for (let i = 1; i < briefs.length; i += 1) {
    assert.notEqual(
      briefs[i].contentType,
      briefs[i - 1].contentType,
      `positions ${i - 1}/${i} repeat ${briefs[i].contentType}`,
    );
  }
});

test('goals, services and angles all rotate across the week', () => {
  const briefs = buildBriefSet({
    slots: sevenSlots(),
    preferences: { contentMix: DEFAULT_CONTENT_MIX, goals: ['awareness', 'engagement', 'education'], tone: 'professional' },
    profile: PROFILE,
    platforms: ['facebook'],
  });
  assert.ok(new Set(briefs.map((b) => b.goal)).size >= 3, 'goals must rotate');
  assert.ok(new Set(briefs.map((b) => b.serviceEmphasis)).size >= 3, 'services must rotate');
  assert.ok(new Set(briefs.map((b) => b.angle)).size >= 4, 'angles must vary');
  // Every brief is aligned to its slot.
  briefs.forEach((b, i) => assert.equal(b.position, i));
  assert.equal(briefs[0].slot.localDate, '2026-07-14');
});

test('template selection follows content type and alternates within a type', () => {
  // The spec's mapping, asserted directly.
  assert.equal(templateForContentType('tips', 0), 'checklist-tips');
  assert.equal(templateForContentType('proof', 0), 'stat-proof');
  assert.equal(templateForContentType('comparison', 0), 'split-comparison');
  assert.equal(templateForContentType('authority', 0), 'editorial-premium');
  assert.equal(templateForContentType('cta', 0), 'geometric-conversion');
  // The second tips post of a plan must not look like the first.
  assert.notEqual(templateForContentType('tips', 1), templateForContentType('tips', 0));
  // An unknown type still yields a usable template.
  assert.equal(templateForContentType('nonsense', 0), 'editorial-premium');
  // Every content type maps to something.
  for (const type of PLANNER_CONTENT_TYPES) {
    assert.ok(CONTENT_TYPE_TEMPLATES[type], `${type} has no template mapping`);
    assert.ok(templateForContentType(type, 0));
  }
});

test('a plan uses several different templates', () => {
  const briefs = buildBriefSet({
    slots: sevenSlots(),
    preferences: { contentMix: DEFAULT_CONTENT_MIX, goals: ['awareness'], tone: 'professional' },
    profile: PROFILE,
    platforms: ['facebook'],
  });
  const templates = new Set(briefs.map((b) => b.templateKey));
  assert.ok(templates.size >= 4, `only ${templates.size} distinct templates: ${[...templates].join(',')}`);
});

test('CTA placement follows the mode instead of appearing on every post', () => {
  assert.equal(ctaForPosition('always', 0), true);
  assert.equal(ctaForPosition('always', 5), true);
  assert.deepEqual([0, 1, 2, 3].map((i) => ctaForPosition('some', i)), [true, false, true, false]);
  assert.deepEqual([0, 1, 2, 3].map((i) => ctaForPosition('light', i)), [true, false, false, true]);

  const slots = sevenSlots();
  const light = buildBriefSet({
    slots, preferences: { ctaMode: 'light' }, profile: PROFILE, platforms: ['facebook'],
  });
  const withCta = light.filter((b) => b.includeCta).length;
  assert.ok(withCta > 0 && withCta < light.length, `CTA-light produced ${withCta}/7`);
  // A post without a CTA carries no CTA text at all.
  for (const brief of light) {
    if (!brief.includeCta) assert.equal(brief.callToAction, null);
  }

  const always = buildBriefSet({
    slots, preferences: { ctaMode: 'always' }, profile: PROFILE, platforms: ['facebook'],
  });
  assert.ok(always.every((b) => b.includeCta));
  assert.ok(always.every((b) => b.callToAction === 'Book a free quote'));
});

test('tone maps through, and "mixed" rotates', () => {
  assert.equal(toneForPosition('professional', 0), 'professional');
  assert.equal(toneForPosition('confident', 0), 'bold');
  assert.equal(toneForPosition('educational', 0), 'informative');
  const mixed = [0, 1, 2, 3].map((i) => toneForPosition('mixed', i));
  assert.equal(new Set(mixed).size, 4, 'mixed must actually vary');

  const briefs = buildBriefSet({
    slots: sevenSlots(), preferences: { tone: 'mixed' }, profile: PROFILE, platforms: ['facebook'],
  });
  assert.ok(new Set(briefs.map((b) => b.tone)).size > 1);
});

test('the brief text only ever contains business facts we were given', () => {
  const text = composeBriefText({
    contentType: 'educational', angle: 'explain how something works in plain language',
    service: 'Roof repair', goal: 'awareness', profile: PROFILE,
  });
  assert.match(text, /Post type: educational/);
  assert.match(text, /Focus on this service: Roof repair/);
  assert.match(text, /Serves: London, Greater London/);
  // No invented commercial claims.
  assert.equal(/guarantee|free|discount|\d+%|\$|£\d/i.test(text), false, `invented claim in: ${text}`);

  // A bare profile produces a bare brief, not filler.
  const bare = composeBriefText({ contentType: 'tips', angle: 'a short numbered checklist', profile: null });
  assert.match(bare, /Post type: tips/);
  assert.equal(bare.includes('undefined'), false);
});

test('a business with no services still gets a full plan', () => {
  const briefs = buildBriefSet({
    slots: sevenSlots(),
    preferences: { contentMix: DEFAULT_CONTENT_MIX },
    profile: { businessName: 'Solo Trader' },
    platforms: ['threads'],
  });
  assert.equal(briefs.length, 7);
  for (const brief of briefs) {
    assert.equal(brief.serviceEmphasis, null);
    assert.ok(brief.brief.length > 0);
    assert.ok(brief.templateKey);
  }
});

test('no profile and no preferences still produces a usable plan', () => {
  const briefs = buildBriefSet({ slots: sevenSlots(), platforms: ['facebook'] });
  assert.equal(briefs.length, 7);
  for (const brief of briefs) {
    assert.ok(PLANNER_CONTENT_TYPES.includes(brief.contentType));
    assert.ok(brief.templateKey);
    assert.ok(brief.tone);
  }
});

test('the brief count never exceeds the slots given', () => {
  assert.equal(buildBriefSet({ slots: [], platforms: [] }).length, 0);
  assert.equal(buildBriefSet({ slots: sevenSlots().slice(0, 3), platforms: [] }).length, 3);
});
