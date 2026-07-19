// The native content engine derived from the Make.com scenarios.
//
// Seven "Daily Content Generator (Multi-Platform)" scenarios were inspected and
// their extractions live in design-references/make-scenario/extracted/. What was
// migrated is strategy: a day-of-week rhythm, a content type paired with a
// visual concept, and the writing direction that gave those posts their
// variety. What was NOT migrated is every business constant those scenarios
// hardcoded, and one card that fabricated customer reviews.
//
// These tests exist because "we copied the good bits" is not a verifiable
// statement. Each one names the specific way the migration could have gone
// wrong.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import {
  NICHES, DAY_TYPES, NICHE_STRATEGIES, resolveNiche, strategyForNiche, dayTypeFor, weekShapeFor, resolveWeek,
} from '../src/services/makeContentStrategy.js';
import {
  planBatch, summarizeDiversity, usedElements, problemFor,
} from '../src/services/batchDiversityPlanner.js';
import { buildBriefSet } from '../src/services/plannerBriefService.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTRACTED = path.join(ROOT, 'design-references', 'make-scenario', 'extracted');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const slotsFor = (n) => Array.from({ length: n }, (_, i) => ({
  weekday: (i % 7) + 1,
  localDate: `2027-03-${String(i + 1).padStart(2, '0')}`,
}));

const WATERPROOFING = {
  businessName: 'Test Waterproofing Co',
  businessCategory: 'Waterproofing contractor',
  businessDescription: 'Basement and foundation waterproofing for homes',
  city: 'Brooklyn',
  region: 'NY',
  services: [
    'Basement Waterproofing', 'Foundation Waterproofing', 'French Drain Installation',
    'Sump Pump Installation', 'Basement Leak Inspection',
  ],
};

const SEO_AGENCY = {
  businessName: 'Test Search Agency',
  businessCategory: 'SEO agency',
  businessDescription: 'Search and AI visibility consulting for brands',
  city: 'Austin',
  region: 'TX',
  services: ['Technical SEO Audit', 'Content Strategy', 'Local SEO', 'Link Acquisition'],
};

// ------------------------------------------------- extraction and safety
test('every inspected scenario has a committed extraction', () => {
  const files = readdirSync(EXTRACTED).filter((f) => f.endsWith('.md'));
  const expected = [
    'brick-pointing.md', 'concrete.md', 'peralytics.md', 'pioneer.md',
    'roofing.md', 'sidewalks.md', 'waterproofing.md',
  ];
  for (const name of expected) {
    assert.ok(files.includes(name), `missing extraction: ${name}`);
  }
  assert.equal(files.length, 7, 'seven scenarios matched the name, and seven were extracted');
});

test('no Make credential or private identifier is committed', () => {
  /*
   * The extractions carry prompts and CSS on purpose. They must not carry the
   * things that would let someone act as this account. Checked as patterns
   * rather than as known values, so a NEW secret pasted in later still fails.
   */
  const forbidden = [
    // __IMTCONN__ is Make's own field name and appears beside every redacted
    // value. What must never appear is a value that was not replaced.
    { name: 'unredacted connection value', re: /__IMTCONN__`?\s*[:=]\s*`?(?!\[REDACTED\])[A-Za-z0-9]/ },
    { name: 'bearer or api token', re: /\b(sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/ },
    { name: 'long numeric account id', re: /"(page_id|account_id|board_id|datastore|spreadsheetId)"\s*:\s*"?\d{8,}/i },
    { name: 'email address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
    { name: 'hcti credential', re: /hcti[_-]?(api[_-]?)?key\s*[:=]\s*['"][A-Za-z0-9-]{8,}/i },
  ];
  for (const file of readdirSync(EXTRACTED).filter((f) => f.endsWith('.md'))) {
    const body = readFileSync(path.join(EXTRACTED, file), 'utf8');
    for (const { name, re } of forbidden) {
      assert.ok(!re.test(body), `${file} contains a ${name}`);
    }
  }
});

test('production source has no Make.com runtime dependency', () => {
  /*
   * Make was a reference, not a component. Nothing under src/ may call it, and
   * no scenario id may appear there — an id in source is the first step toward
   * someone wiring a fetch to it.
   */
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : (e.name.endsWith('.js') ? [full] : []);
  });
  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file);
    /*
     * Comments are stripped first. Saying in a docstring where a rhythm came
     * from is the documentation this migration is supposed to leave behind; the
     * thing that would be a dependency is a URL, an import or a scenario id in
     * executable code. Checking the raw text would have made the honest comment
     * indistinguishable from a live call.
     */
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/https?:\/\/[^'"\s]*make\.com|integromat/i.test(code), `${rel} calls Make.com at runtime`);
    assert.ok(!/from\s+['"][^'"]*make-scenario|require\([^)]*make-scenario/.test(code),
      `${rel} imports extracted scenario data`);
    assert.ok(!/\b92\d{5}\b/.test(code), `${rel} contains what looks like a Make scenario id`);
  }
});

test('no example business from the scenarios is hardcoded in the engine', () => {
  /*
   * The source scenarios baked a name, a phone number and a borough list into
   * every prompt. The whole point of the migration is that those became
   * workspace data, so the strategy modules must not name any of them.
   */
  const sources = [
    read('src', 'services', 'makeContentStrategy.js'),
    read('src', 'services', 'batchDiversityPlanner.js'),
  ].join('\n');

  for (const name of ['Makkah', 'Peralytics', 'Pioneer Construction', 'NYC Waterproofing',
    'Sidewalks Repair', 'aiseocompany', 'nyc-waterproofing']) {
    assert.ok(!sources.includes(name), `the engine names the example business "${name}"`);
  }
  // Phone numbers and street addresses from the scenarios.
  assert.ok(!/\(\d{3}\)\s?\d{3}-\d{4}/.test(sources), 'the engine contains a phone number');
  // A brand palette belongs to a workspace, not to a strategy module.
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(sources), 'the engine contains a hardcoded colour');
});

test('the fabricated-testimonial card was not migrated', () => {
  /*
   * Five of six contractor scenarios rendered a five-star card carrying a
   * customer quote, name, location and initials that the model invented. A
   * fake review of a real business is forbidden. The testimonial card exists
   * for exact parity, but it is REAL-REVIEW-ONLY: it renders only when the
   * workspace has a stored review, and it is never fed generated text.
   */
  // The default Friday, with no reviews, is the safe maintenance tip.
  const friday = dayTypeFor(strategyForNiche(NICHES.LOCAL_SERVICE), 5);
  assert.equal(friday.key, 'maintenance_tip', 'with no review, Friday is the maintenance tip');

  // The testimonial day type is gated: it declares it requires a review and
  // carries no generated substance of its own.
  assert.equal(DAY_TYPES.testimonial_spotlight.requiresReview, true,
    'the testimonial day type must declare it needs a real review');

  // The week resolver only routes to it when a review is available.
  const withReview = resolveWeek(strategyForNiche(NICHES.LOCAL_SERVICE), { hasReview: true });
  const noReview = resolveWeek(strategyForNiche(NICHES.LOCAL_SERVICE), { hasReview: false });
  assert.equal(withReview[5], 'testimonial_spotlight', 'a real review upgrades Friday to the testimonial');
  assert.equal(noReview[5], 'maintenance_tip', 'no review keeps the safe fallback');
});

// ------------------------------------------------- dynamic business context
test('the niche comes from the workspace business, not from a name in code', () => {
  assert.equal(resolveNiche(WATERPROOFING), NICHES.LOCAL_SERVICE);
  assert.equal(resolveNiche(SEO_AGENCY), NICHES.KNOWLEDGE_BUSINESS);
  // A profile with nothing recorded still gets a posting shape, because a
  // rhythm is not a claim about the business.
  assert.equal(resolveNiche(null), NICHES.LOCAL_SERVICE);
  assert.equal(resolveNiche({}), NICHES.LOCAL_SERVICE);
});

test('a contractor plan never produces knowledge-business day types', () => {
  const briefs = buildBriefSet({ slots: slotsFor(10), preferences: {}, profile: WATERPROOFING, platforms: ['facebook'] });
  const seoOnly = ['category_insight', 'thought_leadership', 'industry_trend', 'hot_take_myth', 'quick_hack'];
  for (const b of briefs) {
    assert.ok(!seoOnly.includes(b.dayType), `contractor plan produced "${b.dayType}"`);
  }
  assert.equal(briefs[0].niche, NICHES.LOCAL_SERVICE);
});

test('an SEO plan never produces contractor day types', () => {
  const briefs = buildBriefSet({ slots: slotsFor(10), preferences: {}, profile: SEO_AGENCY, platforms: ['facebook'] });
  const tradeOnly = ['service_spotlight', 'code_tip', 'project_showcase', 'maintenance_tip', 'pro_tip_warning'];
  for (const b of briefs) {
    assert.ok(!tradeOnly.includes(b.dayType), `SEO plan produced "${b.dayType}"`);
  }
  assert.equal(briefs[0].niche, NICHES.KNOWLEDGE_BUSINESS);
});

test('one business\'s services cannot appear in another\'s plan', () => {
  const wp = buildBriefSet({ slots: slotsFor(10), preferences: {}, profile: WATERPROOFING, platforms: ['facebook'] });
  const seo = buildBriefSet({ slots: slotsFor(10), preferences: {}, profile: SEO_AGENCY, platforms: ['facebook'] });

  const wpServices = new Set(wp.map((b) => b.serviceEmphasis).filter(Boolean));
  const seoServices = new Set(seo.map((b) => b.serviceEmphasis).filter(Boolean));

  for (const s of wpServices) assert.ok(WATERPROOFING.services.includes(s), `"${s}" is not this business's service`);
  for (const s of seoServices) assert.ok(SEO_AGENCY.services.includes(s), `"${s}" is not this business's service`);
  for (const s of seoServices) assert.ok(!wpServices.has(s), 'service leaked between businesses');
});

test('the reader problem is built from this business\'s own services', () => {
  const briefs = buildBriefSet({ slots: slotsFor(10), preferences: {}, profile: WATERPROOFING, platforms: ['facebook'] });
  const problems = briefs.map((b) => b.audienceProblem);
  const mentioning = problems.filter((p) => WATERPROOFING.services.some((s) => p.includes(s.toLowerCase())));
  assert.ok(mentioning.length >= 8, `expected most problems to name a real service, got ${mentioning.length}/10`);
});

test('a business with no services recorded gets no invented one', () => {
  const bare = { ...WATERPROOFING, services: [] };
  const briefs = buildBriefSet({ slots: slotsFor(6), preferences: {}, profile: bare, platforms: ['facebook'] });
  for (const b of briefs) {
    assert.equal(b.serviceEmphasis, null, 'no service may be invented');
    assert.ok(typeof b.audienceProblem === 'string' && b.audienceProblem.length > 0);
  }
});

// ------------------------------------------------------------ batch diversity
test('a ten-post batch is not ten versions of one angle', () => {
  /*
   * The observed failure: ten waterproofing posts that all argued patching does
   * not work. Each dimension is asserted separately, because a batch can vary
   * its openings and still say one thing.
   */
  const briefs = buildBriefSet({ slots: slotsFor(10), preferences: {}, profile: WATERPROOFING, platforms: ['facebook'] });
  const plan = briefs.map((b, i) => ({
    position: i, service: b.serviceEmphasis, audienceProblem: b.audienceProblem,
    dayTypeKey: b.dayType, openingStyle: b.openingStyle, closingStyle: b.closingStyle,
    writingFormat: b.writingFormat, hashtagFamily: b.hashtagFamily,
    imageConcept: b.imageConcept, headlineStyle: b.headlineStyle,
  }));
  const d = summarizeDiversity(plan);

  assert.equal(d.services, 5, 'every recorded service must be used');
  assert.ok(d.problems >= 8, `problems: ${d.problems}`);
  assert.equal(d.dayTypes, 7, 'the full week must be represented');
  assert.ok(d.openings >= 6, `openings: ${d.openings}`);
  assert.ok(d.closings >= 5, `closings: ${d.closings}`);
  assert.ok(d.formats >= 5, `structures: ${d.formats}`);
  assert.ok(d.hashtagFamilies >= 4, `hashtag families: ${d.hashtagFamilies}`);
  assert.ok(d.imageConcepts >= 4, `image concepts: ${d.imageConcepts}`);
  assert.ok(d.headlineStyles >= 5, `headline styles: ${d.headlineStyles}`);
});

test('every rotation bank is fully visited before it repeats', () => {
  /*
   * This is the defect that shipped in the first draft of the planner: each
   * bank advanced by a different stride, and a stride sharing a factor with its
   * bank length visits only part of it. Six closings with stride two gave
   * three. A long batch is the only way to see it.
   */
  const plan = planBatch({
    slots: slotsFor(30),
    dayTypeAt: (d) => dayTypeFor(strategyForNiche(NICHES.LOCAL_SERVICE), d),
    services: WATERPROOFING.services,
  });
  const d = summarizeDiversity(plan);
  assert.equal(d.openings, 8, 'all eight opening styles');
  assert.equal(d.closings, 6, 'all six closing styles');
  assert.equal(d.formats, 6, 'all six structures');
  assert.equal(d.hashtagFamilies, 5, 'all five hashtag families');
  // Seven, not five: the day type names its own headline treatment and the
  // five-entry bank is only the fallback when it does not.
  assert.equal(d.headlineStyles, 7, 'one headline treatment per day type');
});

test('the image concept follows the day, as it did in the source', () => {
  const week = weekShapeFor(NICHES.LOCAL_SERVICE);
  assert.deepEqual(week.map((d) => d.key), [
    'service_spotlight', 'trust_stat', 'code_tip', 'project_showcase',
    'maintenance_tip', 'pro_tip_warning', 'brand_insight',
  ]);
  // A stat day gets a stat card; a checklist day gets a cheatsheet.
  assert.equal(week[1].imageConcept, 'stat_card');
  assert.equal(week[2].imageConcept, 'cheatsheet');
  assert.equal(week[5].imageConcept, 'warning_card');
  for (const day of week) {
    assert.ok(day.imageConcept, `${day.key} has no image concept`);
    assert.ok(day.layoutHint, `${day.key} has no layout`);
  }
});

test('an unmatched weekday falls back to a real day type, never a blank', () => {
  // Every switch in the source lacked a default branch, which rendered an empty
  // card on an unmatched day.
  const strategy = strategyForNiche(NICHES.LOCAL_SERVICE);
  for (const bad of [0, 8, -1, 99, null, undefined]) {
    const day = dayTypeFor(strategy, bad);
    assert.ok(day.key && day.purpose && day.imageConcept, `weekday ${bad} produced a blank day type`);
  }
});

// -------------------------------------------------------------------- retry
test('a retry is told what the rest of the batch already spent', () => {
  const plan = planBatch({
    slots: slotsFor(7),
    dayTypeAt: (d) => dayTypeFor(strategyForNiche(NICHES.LOCAL_SERVICE), d),
    services: WATERPROOFING.services,
  });
  const generated = plan.map((p, i) => ({
    position: i, topic: `topic ${i}`,
    caption: `Opening line number ${i}. Then a second sentence.`,
  }));

  const used = usedElements(plan, generated, 3);

  assert.ok(!used.topics.includes('topic 3'), 'a slot is not its own constraint');
  assert.ok(used.topics.includes('topic 0') && used.topics.includes('topic 6'));
  assert.ok(used.openingSentences.length >= 5, 'the retry sees real opening sentences');
  assert.ok(!used.openingSentences.some((s) => s.includes('number 3')));
  for (const key of ['services', 'problems', 'openingStyles', 'closingStyles',
    'hashtagFamilies', 'imageConcepts', 'headlineStyles']) {
    assert.ok(Array.isArray(used[key]) && used[key].length > 0, `retry context is missing ${key}`);
  }
});

test('a retry can change every dimension while keeping the slot\'s role', () => {
  const plan = planBatch({
    slots: slotsFor(7),
    dayTypeAt: (d) => dayTypeFor(strategyForNiche(NICHES.LOCAL_SERVICE), d),
    services: WATERPROOFING.services,
  });
  const slot = plan[2];
  const used = usedElements(plan, [], 2);

  // The role is fixed: Wednesday stays a rules-and-requirements post.
  assert.equal(slot.dayTypeKey, 'code_tip');
  // Everything the rewrite may vary has alternatives outside what the batch used.
  assert.ok(!used.openingStyles.includes(slot.openingStyle) || used.openingStyles.length < 8);
  assert.ok(used.imageConcepts.length >= 3, 'other concepts exist to move to');
});

// --------------------------------------------------------------- guardrails
test('the strategy carries no claim about any business', () => {
  /*
   * Day purposes and opening guidance are instructions to a writer. If one of
   * them asserted a fact ("licensed and insured", "since 2003"), every business
   * using that rhythm would publish it.
   */
  const text = Object.values(DAY_TYPES)
    .flatMap((d) => [d.purpose, d.openingGuidance, d.label])
    .join(' ')
    .toLowerCase();
  for (const claim of ['licensed', 'insured', 'certified', 'award', 'guarantee',
    '24/7', 'years of experience', 'since 19', 'since 20', 'five star', '5 star']) {
    assert.ok(!text.includes(claim), `the strategy asserts "${claim}"`);
  }
});

test('no generated guidance contains an em dash or en dash', () => {
  const text = [
    ...Object.values(DAY_TYPES).flatMap((d) => [d.purpose, d.openingGuidance, d.label]),
  ].join(' ');
  assert.ok(!/[—–]/.test(text), 'dashes are forbidden in generated copy guidance');
});

test('both niches define a complete, distinct week', () => {
  const local = weekShapeFor(NICHES.LOCAL_SERVICE).map((d) => d.key);
  const knowledge = weekShapeFor(NICHES.KNOWLEDGE_BUSINESS).map((d) => d.key);
  assert.equal(new Set(local).size, 7, 'seven distinct local day types');
  assert.equal(new Set(knowledge).size, 7, 'seven distinct knowledge day types');
  assert.equal(local.filter((k) => knowledge.includes(k)).length, 0, 'the two weeks must not overlap');
  assert.equal(Object.keys(NICHE_STRATEGIES).length, 2, 'two strategies, not eight hardcoded workflows');
});

test('extractions are reference material, never loaded at runtime', () => {
  assert.ok(existsSync(EXTRACTED), 'extractions are committed for review');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : (e.name.endsWith('.js') ? [full] : []);
  });
  for (const file of walk(path.join(ROOT, 'src'))) {
    // Comments stripped: naming the reference folder in a docstring is how a
    // reader finds the source material. Reading it at runtime is the defect.
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!code.includes('design-references'),
      `${path.relative(ROOT, file)} reads design references at runtime`);
  }
});

test('problemFor never returns an empty or malformed problem', () => {
  for (let i = 0; i < 50; i += 1) {
    const withServices = problemFor(WATERPROOFING.services, i);
    const without = problemFor([], i);
    assert.ok(withServices.length > 10 && withServices.startsWith('they'), `bad problem at ${i}`);
    assert.ok(without.length > 10 && without.startsWith('they'), `bad generic problem at ${i}`);
  }
});

test('no raw Make blueprint is tracked by git', () => {
  /*
   * A raw blueprint carries live connection ids, the datastore id and the
   * Instagram business account id. One was staged during this migration and
   * caught only on a second look: the scan pattern expected a backtick before
   * the colon, and JSON writes a quote, so `"__IMTCONN__": 14172355` slipped
   * through a check that was looking for exactly that.
   *
   * The redacted extractions are the reviewable form. This asserts on what git
   * actually tracks rather than on what is present on disk, because the working
   * copy legitimately holds the raw file.
   */
  const tracked = execSync('git ls-files design-references', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);

  for (const file of tracked) {
    assert.ok(!/blueprint.*\.json$/i.test(file), `raw blueprint is tracked: ${file}`);
  }

  // And every tracked text file there is free of connection and account ids.
  for (const file of tracked) {
    if (/\.(png|jpe?g|gif|webp)$/i.test(file)) continue;
    const body = readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!/__IMTCONN__["`]?\s*[:=]\s*["`]?[A-Za-z0-9]/.test(body),
      `${file} carries a Make connection id`);
    assert.ok(!/"(page|board|account|datastore|instagram|spreadsheet)[A-Za-z]*"\s*:\s*"?[0-9]{6,}/.test(body),
      `${file} carries a private account id`);
  }
});
