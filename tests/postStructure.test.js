/**
 * A checklist item is not a paragraph.
 *
 * THE LIVE DEFECT. A Friday "Actionable Tips" post, format Checklist, for
 * Instagram Professional and Threads:
 *
 *   Threads had 6 paragraphs; allowed 1 to 3
 *   Instagram had 100 words; minimum 120
 *   Instagram had 11 paragraphs; allowed 2 to 4
 *
 * After one targeted retry:
 *
 *   Threads had 5 paragraphs; allowed 1 to 3
 *   Instagram word count became valid
 *   Instagram had 14 paragraphs; allowed 2 to 4
 *
 * The retry fixed the word count and made the structure WORSE. That is not a
 * bad model; it is an impossible instruction. paragraphsOf() split on newlines,
 * so every checklist item counted as a prose paragraph. A checklist post could
 * never pass, and the repair was told "add 40 words" AND "cut to 2 to 4
 * paragraphs" in the same breath — for a checklist, the only way to add words
 * is more items, and every item counted as a paragraph. The two instructions
 * contradicted each other, so the count went 11 -> 14.
 *
 * These tests assert the distinction the validator now makes:
 *
 *   prose paragraph | list block | list item | hashtag block
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeStructure,
  normalizeCopy,
  measurePostCopy,
  postCopyIssues,
  repairGuidance,
  wordCount,
} from '../src/services/contentStyleGuard.js';

/** The good Threads checklist that used to be impossible to publish. */
const THREADS_CHECKLIST = [
  'Before you pay for another SEO audit, check these yourself. It takes ten minutes and it tells you whether the audit is worth buying.',
  '- Does every service page say what the job involves?',
  '- Can you find your phone number without scrolling?',
  '- Does the homepage name the town you work in?',
  '- Do your images have alt text?',
  '- Does anything load slower than three seconds?',
].join('\n');

/** Instagram: two prose paragraphs wrapped around six items. */
const IG_CHECKLIST = [
  'Most people paying for search work cannot say what they got for it last month. That is not a failure of attention on their part. It is what happens when a report is built to look busy rather than to be read.',
  'Before you buy another audit, run these checks yourself. Each one takes a minute and none of them needs any technical knowledge at all:',
  '- Does every service page say what the job actually involves?',
  '- Can a visitor find your phone number without scrolling?',
  '- Does the homepage name the town you actually work in?',
  '- Do your images carry alt text that describes them?',
  '- Does any page take longer than three seconds to load?',
  '- Is the same phone number on every single page?',
  'If most of those fail, an audit will only tell you what you have just read for yourself, and it will charge you for the privilege of hearing it again.',
].join('\n');

// --- the required cases ------------------------------------------------------

test('one intro plus five bullets passes Threads', () => {
  const s = analyzeStructure(THREADS_CHECKLIST);
  assert.equal(s.proseParagraphs, 1);
  assert.equal(s.listBlocks, 1, 'five contiguous bullets are ONE list block');
  assert.equal(s.listItems, 5);
  assert.ok(s.words >= 45 && s.words <= 100, `${s.words} words`);

  // The whole point: this used to be "Threads has 6 paragraphs; it needs 1 to 3".
  assert.deepEqual(postCopyIssues(THREADS_CHECKLIST, 'threads'), []);
});

test('two prose paragraphs plus six bullets pass Instagram', () => {
  const s = analyzeStructure(IG_CHECKLIST);
  assert.equal(s.proseParagraphs, 3, 'intro, lead-in and close');
  assert.equal(s.listItems, 6);
  assert.deepEqual(postCopyIssues(IG_CHECKLIST, 'instagram'), []);
});

test('five ACTUAL prose paragraphs still fail Threads', () => {
  // The rule is not weakened. Five real paragraphs is still five paragraphs.
  const wall = Array.from({ length: 5 }, (_, i) => `Real prose paragraph number ${i + 1} with enough words in it to read as one.`).join('\n\n');
  assert.ok(
    postCopyIssues(wall, 'threads').includes('Threads has 5 prose paragraphs; it needs 1 to 3'),
    JSON.stringify(postCopyIssues(wall, 'threads')),
  );
});

test('fourteen ACTUAL prose paragraphs still fail Instagram', () => {
  const wall = Array.from({ length: 14 }, (_, i) => `Real prose paragraph ${i + 1} carrying a genuine sentence of its own.`).join('\n\n');
  assert.ok(
    postCopyIssues(wall, 'instagram').includes('Instagram has 14 prose paragraphs; it needs 2 to 4'),
    JSON.stringify(postCopyIssues(wall, 'instagram')),
  );
});

test('bullet items are not prose paragraphs, in every marker a model emits', () => {
  // The model is told not to add markers and adds them anyway, in whichever
  // glyph it feels like. Each of these is a list, not five paragraphs.
  for (const marker of ['-', '*', '•', '·', '‣', '▪', '◦']) {
    const copy = ['An intro line that carries the point.', ...Array.from({ length: 5 }, (_, i) => `${marker} item ${i + 1}`)].join('\n');
    const s = analyzeStructure(copy);
    assert.equal(s.proseParagraphs, 1, `${marker}: counted list items as prose`);
    assert.equal(s.listItems, 5, `${marker}: did not see five items`);
  }
});

test('numbered items are not prose paragraphs', () => {
  for (const fmt of [(i) => `${i}. step`, (i) => `${i}) step`, (i) => `(${i}) step`]) {
    const copy = ['An intro line that carries the point.', ...[1, 2, 3].map(fmt)].join('\n');
    const s = analyzeStructure(copy);
    assert.equal(s.proseParagraphs, 1, `${fmt(1)}: counted numbered items as prose`);
    assert.equal(s.listItems, 3);
  }
});

test('a dash-marked list is a list, even though dashes are banned in copy', () => {
  // The dash ban is about punctuation inside sentences. A line that OPENS with
  // one is a bullet the model emitted, and calling it a paragraph would restore
  // the exact defect for anything that slipped past the dash repair.
  const copy = ['Intro line here.', '– first', '– second', '– third'].join('\n');
  assert.equal(analyzeStructure(copy).proseParagraphs, 1);
  assert.equal(analyzeStructure(copy).listItems, 3);
});

test('two lists separated by prose are two blocks', () => {
  const copy = ['Intro.', '- a', '- b', 'A paragraph between them.', '- c', '- d'].join('\n');
  const s = analyzeStructure(copy);
  assert.equal(s.listBlocks, 2);
  assert.equal(s.listItems, 4);
  assert.equal(s.proseParagraphs, 2);
});

test('hashtags stay separate and are counted, not mistaken for prose', () => {
  const copy = [...THREADS_CHECKLIST.split('\n'), '#seo #localseo'].join('\n');
  const s = analyzeStructure(copy);
  assert.equal(s.proseParagraphs, 1, 'a hashtag line is not a paragraph');
  assert.equal(s.hashtagsInCopy, 2);
  assert.ok(
    postCopyIssues(copy, 'threads').includes('Threads has 2 hashtags inside the post copy; they belong in the hashtags field'),
    JSON.stringify(postCopyIssues(copy, 'threads')),
  );
});

// --- normalization is deterministic -----------------------------------------

test('normalization is deterministic across the junk a model actually returns', () => {
  const canonical = 'First paragraph.\n\nSecond paragraph.';
  const variants = [
    'First paragraph.\r\n\r\nSecond paragraph.',      // CRLF
    'First paragraph.\r\rSecond paragraph.',          // lone CR
    'First paragraph.   \n\n   \nSecond paragraph.',  // whitespace-only "blank" line
    'First paragraph.\n\n\n\n\nSecond paragraph.',    // a pile of blank lines
    '\n\nFirst paragraph.\n\nSecond paragraph.\n\n',  // leading/trailing
    'First paragraph.\t\n\nSecond paragraph.  ',      // trailing tabs and spaces
  ];
  for (const v of variants) {
    assert.equal(normalizeCopy(v), canonical, JSON.stringify(v));
  }
  // Idempotent: normalizing twice changes nothing.
  assert.equal(normalizeCopy(normalizeCopy(variants[0])), canonical);
});

test('a whitespace-only line does not become a paragraph', () => {
  const copy = 'First real paragraph.\n   \nSecond real paragraph.';
  assert.equal(analyzeStructure(copy).proseParagraphs, 2);
});

test('normalization does not change the word count', () => {
  assert.equal(wordCount(normalizeCopy(IG_CHECKLIST)), wordCount(IG_CHECKLIST));
});

// --- what the validator now measures ----------------------------------------

test('the measurement reports prose, lists and hashtags separately', () => {
  const m = measurePostCopy(IG_CHECKLIST, 'instagram');
  assert.equal(m.paragraphs, 3, 'paragraphs means PROSE paragraphs');
  assert.equal(m.listBlocks, 1);
  assert.equal(m.listItems, 6);
  assert.equal(m.hashtagsInCopy, 0);
  // The wall-of-text rule reads prose only: a list is meant to be scanned.
  assert.ok(m.longestParagraph > 0 && m.longestParagraph < 75);
});

test('a long prose paragraph is still caught, and a long LIST is not punished for it', () => {
  const longProse = ['x '.repeat(90).trim(), 'A second paragraph.'].join('\n\n');
  assert.ok(postCopyIssues(longProse, 'facebook').some((i) => /prose paragraph of 90 words/.test(i)));

  // The same 90 words as list items: the word band governs it, not the
  // wall-of-text rule, because nobody reads a checklist as a block of prose.
  const asList = ['An intro paragraph.', 'A second paragraph.', ...Array.from({ length: 9 }, (_, i) => `- item ${i} with several words in it here`)].join('\n');
  assert.ok(!postCopyIssues(asList, 'facebook').some((i) => /prose paragraph of/.test(i)), JSON.stringify(postCopyIssues(asList, 'facebook')));
});

// --- the repair is no longer given contradictory instructions ----------------

test('a short checklist is told to grow the LIST, not to add paragraphs', () => {
  /*
   * The heart of it. The old guidance said "add 40 words" and "cut to 2 to 4
   * paragraphs" to a post whose paragraphs WERE its checklist items. Those are
   * opposite instructions and the model resolved them by adding items — driving
   * the count 11 -> 14 and failing again.
   */
  const short = ['Intro paragraph here.', 'Second paragraph here.', '- a check', '- b check', '- c check'].join('\n');
  const guidance = repairGuidance(short, 'instagram', 1).join(' | ');

  assert.match(guidance, /3 list items/, guidance);
  assert.match(guidance, /2 prose paragraphs/, guidance);
  assert.match(guidance, /add ONE more genuinely useful check/, guidance);
  assert.match(guidance, /Do NOT add prose paragraphs/, guidance);
  // And it must NOT tell a post with a valid prose count to change it.
  assert.ok(!/use 2 to 4 PROSE paragraphs/.test(guidance), `it should leave the valid prose count alone: ${guidance}`);
});

test('a too-long checklist is told to drop an item, not to gut the intro', () => {
  const long = ['Intro.', 'Second.', ...Array.from({ length: 30 }, (_, i) => `- a reasonably wordy checklist item number ${i}`)].join('\n');
  const guidance = repairGuidance(long, 'threads', 1).join(' | ');
  assert.match(guidance, /drop a whole list item/, guidance);
  assert.match(guidance, /Do not delete the intro/, guidance);
});

test('a post with too many real paragraphs is still told to cut them', () => {
  const wall = Array.from({ length: 8 }, (_, i) => `Real paragraph ${i} with words.`).join('\n\n');
  const guidance = repairGuidance(wall, 'threads', 1).join(' | ');
  assert.match(guidance, /use 1 to 3 PROSE paragraphs/, guidance);
});

test('a checklist told to cut paragraphs is told to KEEP the list', () => {
  const copy = [...Array.from({ length: 6 }, (_, i) => `Real prose paragraph ${i} here.`), '- an item', '- another item'].join('\n');
  const guidance = repairGuidance(copy, 'instagram', 1).join(' | ');
  assert.match(guidance, /are not paragraphs and do not count towards this: keep the list/, guidance);
});

test('the guidance names the hashtags to remove', () => {
  const copy = [...THREADS_CHECKLIST.split('\n'), '#seo #localseo'].join('\n');
  const guidance = repairGuidance(copy, 'threads', 1).join(' | ');
  assert.match(guidance, /remove the 2 hashtags from the post copy/, guidance);
});

// --- the hard rules are untouched -------------------------------------------

test('a one-line advert is still rejected on every platform', () => {
  for (const platform of ['facebook', 'instagram', 'threads']) {
    assert.ok(postCopyIssues('We build websites, call today!', platform).length > 0, platform);
  }
});

test('a list cannot be used to smuggle a post under its word floor', () => {
  // Structure awareness is not a way to pass with less content.
  const tiny = ['Intro.', '- a', '- b'].join('\n');
  assert.ok(postCopyIssues(tiny, 'instagram').some((i) => /the minimum is 120/.test(i)));
});

test('a post that is ONLY a list still needs its prose', () => {
  const listOnly = Array.from({ length: 20 }, (_, i) => `- checklist item number ${i} with a few words`).join('\n');
  const issues = postCopyIssues(listOnly, 'instagram');
  assert.ok(
    issues.includes('Instagram has 0 prose paragraphs; it needs 2 to 4 (its 20 list items are not counted)'),
    JSON.stringify(issues),
  );
});
