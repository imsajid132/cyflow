/**
 * Milestone B — a checklist is its checks.
 *
 * "Prevent: reordered duplicate checklists" was in the brief and could not be
 * implemented before Milestone A, because until analyzeStructure existed the
 * planner could not tell a list item from a paragraph, and there was nothing to
 * compare.
 *
 * Measured before the fix: two posts carrying the SAME five checks in a
 * different order, with fresh prose around them, scored 0.512 and went to
 * "review" — a human asked to make a judgement about two identical checklists.
 * That is not a judgement, it is a chore. And the score came from incidental
 * token overlap; the decisive fact (same checks) was invisible to every axis,
 * because they all compare sequences.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { contentUniquenessService as uniqueness } from '../src/services/contentUniquenessService.js';
import { HARD_DUPLICATE_SCORE, DUPLICATION_THRESHOLDS } from '../src/config/constants.js';

const CHECKS = [
  'Does every service page say what the job involves?',
  'Can a visitor find your phone number without scrolling?',
  'Does the homepage name the town you work in?',
  'Do your images carry alt text?',
  'Does any page take longer than three seconds?',
];

const post = (intro, order, close) =>
  [intro, ...order.map((i) => `- ${CHECKS[i]}`), close].join('\n');

const MONDAY = post(
  'Before you pay for another SEO audit, run these checks yourself. Ten minutes, and no technical knowledge needed at all.',
  [0, 1, 2, 3, 4],
  'If most of them fail, the audit will only tell you what you just read.',
);

/** The same five checks, shuffled, wrapped in genuinely different prose. */
const THURSDAY_SHUFFLED = post(
  'Wondering whether your site is in decent shape? Here is a short list you can work through over a coffee.',
  [3, 0, 4, 2, 1],
  'Anything you cannot answer is worth raising with whoever looks after the site.',
);

const fp = (caption, extra = {}) => uniqueness.fingerprint({
  caption, headline: 'A specific headline', hashtags: ['#seo'],
  contentType: 'checklist', format: 'checklist', ...extra,
});

const judge = (caption, against, extra = {}) => uniqueness.evaluate(
  {
    caption, headline: 'A different headline entirely', hashtags: ['#seo'],
    contentType: 'checklist', format: 'checklist', ...extra,
  },
  { batch: [fp(against)], recent: [] },
);

// --- the reported case -------------------------------------------------------

test('the same checklist reordered is a duplicate, not review work', () => {
  const ev = judge(THURSDAY_SHUFFLED, MONDAY);

  assert.equal(ev.axes.listItems, DUPLICATION_THRESHOLDS.EXACT, 'the item sets are identical');
  assert.ok(ev.score >= HARD_DUPLICATE_SCORE, `scored ${ev.score}, needs >= ${HARD_DUPLICATE_SCORE}`);
  assert.equal(ev.verdict, 'duplicate');
  assert.ok(ev.reasons.includes('the same checklist, reordered'), JSON.stringify(ev.reasons));
});

test('shuffling is not a disguise: order does not change the verdict', () => {
  // Every rotation of the same five checks is the same post.
  for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 2, 3, 4, 0]]) {
    const shuffled = post('An entirely different opening sentence for this one.', order, 'And a different close.');
    assert.equal(judge(shuffled, MONDAY).verdict, 'duplicate', `order ${order.join('')} slipped through`);
  }
});

test('the fingerprint stores the items as a set, not as an ordered list', () => {
  const a = fp(MONDAY).listItems;
  const b = fp(THURSDAY_SHUFFLED).listItems;
  assert.deepEqual([...a].sort(), [...b].sort(), 'the same checks must normalize to the same set');
  assert.equal(a.length, 5);
});

test('casing and punctuation do not make a check a different check', () => {
  const shouty = post(
    'A different intro entirely, saying something else about the subject.',
    [],
    'A different close.',
  ).split('\n');
  const loud = [shouty[0], ...CHECKS.map((c) => `- ${c.toUpperCase()}`), shouty[shouty.length - 1]].join('\n');
  assert.equal(judge(loud, MONDAY).verdict, 'duplicate');
});

// --- and it does not over-fire ----------------------------------------------

test('sharing SOME checks is not a duplicate', () => {
  // Two posts can legitimately both mention alt text. Only the whole set damns.
  const partial = [
    'A genuinely different post about a different corner of the same subject.',
    `- ${CHECKS[0]}`,
    `- ${CHECKS[1]}`,
    '- Does your sitemap actually list your service pages?',
    '- Is there a single H1 on each page?',
    '- Does the contact form send anywhere you monitor?',
    'A different closing thought to end on.',
  ].join('\n');
  const ev = judge(partial, MONDAY);
  assert.ok(ev.axes.listItems < 0.6, `${ev.axes.listItems} is too high for 2 of 5`);
  assert.notEqual(ev.verdict, 'duplicate');
});

test('two posts with no lists at all are unaffected by this axis', () => {
  const prose = 'A perfectly ordinary post with two paragraphs.\n\nAnd a second one that says something else.';
  const other = 'A different ordinary post.\n\nWith its own second paragraph saying another thing.';
  const ev = judge(other, prose);
  assert.equal(ev.axes.listItems, 0, 'a post with no list must not be compared on its list');
});

test('a one-item list is too short to compare, and says nothing either way', () => {
  // One shared item between two tiny lists is a coincidence. The axis stays
  // silent rather than inventing a signal from it.
  const one = 'An intro that stands alone here.\n- the only check\nA close.';
  const alsoOne = 'A different intro entirely here.\n- the only check\nA different close.';
  assert.equal(judge(alsoOne, one).axes.listItems, 0);
});

test('the axis scales with overlap rather than jumping', () => {
  const A = ['- alpha check here', '- bravo check here', '- charlie check here', '- delta check here', '- echo check here'];
  const base = ['An intro paragraph that says something specific.', ...A].join('\n');
  const scoreFor = (items) => uniqueness.evaluate(
    { caption: ['A completely different introduction entirely.', ...items].join('\n'), headline: 'x', hashtags: [], contentType: 'checklist', format: 'checklist' },
    { batch: [fp(base)], recent: [] },
  ).axes.listItems;

  assert.equal(scoreFor(A), DUPLICATION_THRESHOLDS.EXACT, '5 of 5');
  const three = scoreFor([A[0], A[1], A[2], '- foxtrot new', '- golf new']);
  const two = scoreFor([A[0], A[1], '- hotel new', '- india new', '- juliet new']);
  const zero = scoreFor(['- kilo new', '- lima new', '- mike new', '- november new', '- oscar new']);
  assert.ok(three > two && two > zero, `expected a slope: ${three} > ${two} > ${zero}`);
  assert.equal(zero, 0);
});

// --- the axis cannot be used to condemn honest reuse -------------------------

test('adding a strong axis did not rebalance the soft group', () => {
  /*
   * The soft group's balance is load-bearing: a business is SUPPOSED to reuse
   * its hashtags and its CTA, and that must not warn on its own. A new strong
   * axis must not disturb that, and the way to show it is that a pair with no
   * lists scores exactly as it did before — listItems contributes nothing.
   *
   * Two posts from a real Balanced week: same brand furniture, different pillar
   * and format, which is what the rhythm engine actually produces.
   */
  const a = 'A post about local search that makes one specific point.\n\nAnd develops it in a second paragraph properly.';
  const b = 'A different post about technical work with its own point.\n\nDeveloped differently in its own second paragraph.';
  const ev = uniqueness.evaluate(
    { caption: b, headline: 'Different', hashtags: ['#seo', '#localseo'], cta: 'Ask us', contentType: 'faq_answer', format: 'faq_answer' },
    {
      batch: [uniqueness.fingerprint({
        caption: a, headline: 'Another', hashtags: ['#seo', '#localseo'], cta: 'Ask us',
        contentType: 'educational_insight', format: 'educational_insight',
      })],
      recent: [],
    },
  );
  assert.equal(ev.axes.listItems, 0, 'no lists, so the new axis must be silent');
  assert.notEqual(ev.verdict, 'duplicate', JSON.stringify(ev.axes));
});

test('a checklist week is still allowed to BE a checklist week', () => {
  // The Balanced rhythm can land two checklist posts in one week. Different
  // checks, different subject: that is a plan with a shape, not a repeat.
  const monday = MONDAY;
  const friday = [
    'Getting a new site built? These are the questions worth asking before you sign anything at all.',
    '- Who owns the domain when the work is finished?',
    '- Will you get access to the hosting account?',
    '- Is the content yours to take elsewhere?',
    '- What happens if you want to change developer?',
    '- Is there a written scope, or just a conversation?',
    'None of these are rude to ask. A good answer takes ten seconds.',
  ].join('\n');
  const ev = judge(friday, monday);
  assert.equal(ev.axes.listItems, 0, 'different checks share nothing');
  assert.notEqual(ev.verdict, 'duplicate', JSON.stringify(ev.axes));
});
