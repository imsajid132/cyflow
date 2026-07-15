// Phase 4.7.1: the copy style guard — dash ban, phrase ban, headline shape.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStyleGuard,
  stripDashes,
  hasBannedDash,
  findBannedPhrases,
  headlineIssues,
  wordCount,
} from '../src/services/contentStyleGuard.js';
import { BANNED_DASHES } from '../src/config/constants.js';

const DASH_RE = /[—–‒―]/;

test('every banned dash character is detected', () => {
  for (const dash of BANNED_DASHES) {
    assert.equal(hasBannedDash(`before ${dash} after`), true, `${dash} must be detected`);
  }
  assert.equal(hasBannedDash('a normal - hyphen is fine'), false);
  assert.equal(hasBannedDash('no dashes here'), false);
  assert.equal(hasBannedDash(null), false);
});

test('a spaced em dash between clauses becomes a sentence break', () => {
  assert.equal(
    stripDashes('Local SEO takes time — most results show after three months.'),
    'Local SEO takes time. Most results show after three months.',
  );
  // Before a capital, the clause still stands alone.
  assert.equal(
    stripDashes('We audit first — Google rewards structure.'),
    'We audit first. Google rewards structure.',
  );
});

test('an unspaced dash between words or numbers becomes a hyphen', () => {
  assert.equal(stripDashes('a cost–benefit call'), 'a cost-benefit call');
  assert.equal(stripDashes('open 9–5 on weekdays'), 'open 9-5 on weekdays');
});

test('stray dashes are removed without wrecking the sentence', () => {
  const out = stripDashes('— Leading dash');
  assert.equal(DASH_RE.test(out), false);
  assert.equal(out, 'Leading dash');
  assert.equal(DASH_RE.test(stripDashes('Trailing dash —')), false);
  assert.equal(stripDashes(''), '');
  assert.equal(stripDashes(null), '');
});

test('the repair never leaves double spaces or stacked punctuation', () => {
  const out = stripDashes('One thing — another thing — a third thing.');
  assert.equal(DASH_RE.test(out), false);
  assert.equal(/\s{2,}/.test(out), false, `double space in: ${out}`);
  assert.equal(/\.\s*\./.test(out), false, `stacked periods in: ${out}`);
  assert.equal(/\s[.,]/.test(out), false, `space before punctuation in: ${out}`);
});

test('a hyphen is left alone', () => {
  const text = 'on-page SEO and e-commerce work are well-understood';
  assert.equal(stripDashes(text), text);
});

test('banned marketing phrases are found case-insensitively', () => {
  assert.deepEqual(findBannedPhrases('In Today’s Digital World, SEO matters'), ['in today’s digital world']);
  assert.ok(findBannedPhrases('We will take your business to the next level').length > 0);
  assert.ok(findBannedPhrases('Ready to grow?').length > 0);
  assert.ok(findBannedPhrases('Look no further').length > 0);
  assert.ok(findBannedPhrases('This is a game changer').length > 0);
  assert.deepEqual(findBannedPhrases('A specific point about internal linking depth'), []);
  assert.deepEqual(findBannedPhrases(null), []);
});

test('headline shape is judged by words and length', () => {
  assert.equal(wordCount('Local SEO mistakes that cost visibility'), 6);
  assert.deepEqual(headlineIssues('Local SEO mistakes that cost visibility'), []);
  assert.deepEqual(headlineIssues('A practical technical SEO checklist'), []);
  // Too short to say anything.
  assert.ok(headlineIssues('SEO').length > 0);
  // Too long for a visual.
  assert.ok(headlineIssues('This headline goes on and on and will never fit on two lines at all').length > 0);
  assert.ok(headlineIssues('').length > 0);
});

test('the guard repairs dashes across every copy field', () => {
  const { content, repaired } = applyStyleGuard({
    caption: 'Search intent matters — it decides what you write. This is a long enough caption to be useful to a reader.',
    headline: 'Search intent — start here',
    subheadline: 'A short note — worth reading.',
    summary: 'Summary — internal',
    imageAltText: 'Alt — text',
    bullets: ['Check titles — carefully', 'Fix headings'],
    stat: { value: '3x', label: 'faster — really' },
    comparison: { leftTitle: 'DIY — slow', rightTitle: 'Managed', leftItems: ['a — b'], rightItems: ['c'] },
  });

  for (const field of ['caption', 'headline', 'subheadline', 'summary', 'imageAltText']) {
    assert.equal(DASH_RE.test(content[field]), false, `${field} still has a dash: ${content[field]}`);
  }
  assert.equal(DASH_RE.test(JSON.stringify(content.bullets)), false);
  assert.equal(DASH_RE.test(JSON.stringify(content.stat)), false);
  assert.equal(DASH_RE.test(JSON.stringify(content.comparison)), false);
  assert.ok(repaired.includes('caption'));
  assert.ok(repaired.includes('bullets'));
  assert.ok(repaired.includes('comparison'));
});

test('a dash is repaired, not rejected', () => {
  // The sentence around a dash is usually fine; burning a generation over
  // punctuation would be waste.
  const { rejections } = applyStyleGuard({
    caption: 'Search intent matters — it decides what you write, and that changes the whole brief you hand a writer.',
    headline: 'Search intent decides the brief',
  });
  assert.deepEqual(rejections, []);
});

test('a banned phrase is rejected, because it cannot be repaired', () => {
  const { rejections } = applyStyleGuard({
    caption: 'In today’s digital world, every business needs a website that works hard for them around the clock.',
    headline: 'Why your website matters',
  });
  assert.ok(rejections.some((r) => /generic marketing phrasing/.test(r)), JSON.stringify(rejections));
});

test('a thin caption or a bad headline is rejected', () => {
  assert.ok(applyStyleGuard({ caption: 'Too short.', headline: 'A fine headline here' })
    .rejections.some((r) => /too thin/.test(r)));
  assert.ok(applyStyleGuard({
    caption: 'A perfectly reasonable caption that carries a real point about technical SEO and internal links.',
    headline: 'SEO',
  }).rejections.some((r) => /too short/.test(r)));
});

test('clean copy passes untouched', () => {
  const input = {
    caption: 'Most local rankings move when your service pages match how people actually search. Check the wording on your top three pages first.',
    headline: 'Local signals decide local rankings',
    subheadline: 'Start with your top three service pages.',
    summary: 'Local ranking basics',
    imageAltText: 'A note about local search',
  };
  const { content, repaired, rejections } = applyStyleGuard(input);
  assert.deepEqual(repaired, []);
  assert.deepEqual(rejections, []);
  assert.equal(content.caption, input.caption);
  assert.equal(content.headline, input.headline);
});
