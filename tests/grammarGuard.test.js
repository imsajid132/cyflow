/**
 * Deterministic article checking: "a agency", "a SEO audit", "an website".
 *
 * The live defect was a generated post reading "If a agency can answer these…".
 * Nothing caught it, because the guard checked length, phrasing and claims but
 * never grammar.
 *
 * The hard part is that English picks the article by SOUND, not spelling. A
 * naive "starts with a vowel letter" test is wrong in BOTH directions: it
 * rejects the correct "a user" and accepts the incorrect "a SEO audit". Half of
 * this file is about not producing false accusations.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { findArticleErrors, expectedArticle, applyStyleGuard } from '../src/services/contentStyleGuard.js';

test('the reported defect is caught', () => {
  const hits = findArticleErrors('If a agency can answer these questions, they are worth talking to.');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].found, 'a agency');
  assert.equal(hits[0].expected, 'an agency');
});

test('the obvious a/an mistakes are all caught', () => {
  const cases = [
    ['a agency', 'an agency'],
    ['a SEO audit is worth it', 'an SEO'],
    ['an website is slow', 'a website'],
    ['an user asked', 'a user'],
    ['a hour of work', 'an hour'],
    ['a FAQ page', 'an FAQ'],
    ['an business owner', 'a business'],
    ['a audit', 'an audit'],
  ];
  for (const [bad, expectedFix] of cases) {
    const hits = findArticleErrors(`Text with ${bad} inside.`);
    assert.ok(hits.length > 0, `missed: ${bad}`);
    assert.ok(hits[0].expected.startsWith(expectedFix.split(' ')[0]), `${bad} -> ${hits[0].expected}`);
  }
});

test('correct writing is never accused', () => {
  /*
   * Every one of these is right, and a spelling-based check would flag several.
   * A false accusation burns a generation and teaches nobody anything.
   */
  const fine = [
    'an agency worth paying',
    'a user asked about an SEO audit',
    'a unique angle on a universal problem',
    'an hour of honest work',
    'a website, a blog and an app',
    'an FAQ page and a WordPress site',
    'a one-page site',
    'an email from a European client',
    'a link, an image and a heading',
    'an audit of a hundred pages',
  ];
  for (const text of fine) {
    assert.deepEqual(findArticleErrors(text), [], `false positive in: ${text}`);
  }
});

test('the article is chosen by sound, not by first letter', () => {
  // Vowel letter, consonant sound.
  assert.equal(expectedArticle('user'), 'a');
  assert.equal(expectedArticle('unique'), 'a');
  assert.equal(expectedArticle('one'), 'a');
  // Consonant letter, vowel sound.
  assert.equal(expectedArticle('hour'), 'an');
  assert.equal(expectedArticle('honest'), 'an');
  // Initialisms are spelled out: the article follows the letter's NAME.
  assert.equal(expectedArticle('SEO'), 'an');  // "an ess-ee-oh"
  assert.equal(expectedArticle('FAQ'), 'an');  // "an eff-ay-cue"
  assert.equal(expectedArticle('WordPress'), 'a');
  assert.equal(expectedArticle('CMS'), 'a');   // "a see-em-ess"
  // Ordinary words.
  assert.equal(expectedArticle('agency'), 'an');
  assert.equal(expectedArticle('website'), 'a');
});

test('sentence-initial capitals are handled', () => {
  assert.deepEqual(findArticleErrors('An website is slow.').length, 1);
  assert.deepEqual(findArticleErrors('A agency called.').length, 1);
  assert.deepEqual(findArticleErrors('An agency called.'), []);
});

test('the same mistake twice is reported once', () => {
  const hits = findArticleErrors('a agency here and a agency there');
  assert.equal(hits.length, 1);
});

test('a grammar error rejects the post and names the fix for the retry', () => {
  const guarded = applyStyleGuard({
    caption: 'If a agency can answer these questions, they are worth talking to. '.repeat(12),
    headline: 'What to ask before you hire',
  }, { platform: 'facebook' });

  const grammar = guarded.rejections.filter((r) => /grammar error/.test(r));
  assert.equal(grammar.length, 1, `expected a grammar rejection: ${JSON.stringify(guarded.rejections)}`);
  assert.match(grammar[0], /"a agency" should be "an agency"/);
  // The platform is named, because a failed item can carry reasons from more
  // than one platform at once and the user has to know which post to look at.
  assert.match(grammar[0], /^Facebook contains the grammar error/);

  // Rejected, never silently rewritten: the text is untouched so a human (and
  // the retry) can see exactly what the writer produced.
  assert.match(guarded.content.caption, /a agency/);
});

test('a grammar error still reports when the caller did not name a platform', () => {
  // The guard reports on what it can judge. Without a platform it cannot judge
  // length, but "a agency" is wrong on any platform.
  const guarded = applyStyleGuard({
    caption: 'If a agency can answer these questions, they are worth talking to. '.repeat(12),
    headline: 'What to ask before you hire',
  });
  assert.ok(
    guarded.rejections.some((r) => /^this post contains the grammar error/.test(r)),
    JSON.stringify(guarded.rejections),
  );
});

test('a headline grammar error is caught too', () => {
  const guarded = applyStyleGuard({
    caption: 'word '.repeat(150).trim(),
    headline: 'Hiring a SEO agency without regrets',
  }, { platform: 'facebook' });
  assert.ok(guarded.rejections.some((r) => /grammar/.test(r) && /a SEO/.test(r)));
});

test('clean copy produces no grammar rejection', () => {
  const guarded = applyStyleGuard({
    caption: [
      'An agency that cannot tell you what it changed this month is not doing much. That is the whole test, and it takes one question to run.',
      'Ask which pages were worked on and why those ones. Ask what an audit actually found. A vague answer is itself the answer, and you can stop there.',
      'None of this needs technical knowledge. It needs a straight reply, and a user of any site can judge one of those.',
    ].join('\n\n'),
    headline: 'One question worth asking your agency',
  }, { platform: 'threads' });
  assert.deepEqual(guarded.rejections.filter((r) => /grammar/.test(r)), []);
});
