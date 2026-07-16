/**
 * Phase 4.7.2 — the post copy standard.
 *
 * These assert the rules that separate a POST from a caption: per-platform
 * length and paragraph bands, paragraph breaks surviving the dash repair,
 * hashtags staying out of the prose, and platform versions not being copies of
 * each other.
 *
 * The sample plan is used as the worked example of the standard, so a change
 * that quietly lowers the bar fails here rather than shipping.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStyleGuard,
  postCopyIssues,
  paragraphsOf,
  stripDashes,
  hasBannedDash,
  wordCount,
} from '../src/services/contentStyleGuard.js';
import { contentUniquenessService as uniqueness } from '../src/services/contentUniquenessService.js';
import { POST_COPY_RULES, PARAGRAPH_MAX_WORDS, BANNED_DASHES } from '../src/config/constants.js';
import { PLAN } from './helpers/samplePlan.mjs';

const PLATFORMS = ['facebook', 'instagram', 'threads'];

/** A valid post for a platform, built to that platform's band. */
function postFor(platform, paragraphs) {
  return { caption: paragraphs.join('\n\n'), headline: 'A specific and useful headline here' };
}

// --- paragraph breaks survive the dash repair -------------------------------

test('the dash repair preserves paragraph breaks', () => {
  const original = 'Flashing fails before shingles do — most leaks start there.\n\n'
    + 'Check the joints each spring. It takes ten minutes.\n\n'
    + 'If you are not sure what to look for, ask.';
  assert.equal(paragraphsOf(original).length, 3);

  const repaired = stripDashes(original);
  assert.equal(hasBannedDash(repaired), false, 'the dash must be gone');
  assert.equal(
    paragraphsOf(repaired).length,
    3,
    `the repair flattened the post into: ${JSON.stringify(repaired)}`,
  );
  assert.match(repaired, /there\.\n\nCheck/, 'the blank line between paragraphs must survive verbatim');
});

test('every banned dash character is repaired without touching newlines', () => {
  for (const dash of BANNED_DASHES) {
    const text = `First clause ${dash} second clause.\n\nSecond paragraph.`;
    const out = stripDashes(text);
    assert.equal(hasBannedDash(out), false, `${dash} survived`);
    assert.equal(paragraphsOf(out).length, 2, `${dash} destroyed the paragraph break`);
  }
});

test('the dash repair still collapses runs of spaces inside a line', () => {
  assert.equal(stripDashes('a  —  b.'), 'a. B.');
});

test('a hyphenated compound keeps its hyphen and does not become a sentence break', () => {
  assert.equal(stripDashes('We do on–page work.'), 'We do on-page work.');
});

// --- per-platform length + paragraphs ---------------------------------------

test('a one-sentence advert is rejected for every platform', () => {
  const advert = { caption: 'We build great websites for local businesses, get in touch today!' };
  for (const platform of PLATFORMS) {
    const issues = postCopyIssues(advert.caption, platform);
    assert.ok(issues.length > 0, `${platform} accepted a one-line advert`);
  }
});

// Phase 4.8 widened the long-form bands (was 100-180 for both). The wider room
// is what stops Facebook and Instagram copy reading as clipped.
test('facebook requires 130 to 220 words in 2 to 4 paragraphs', () => {
  const rules = POST_COPY_RULES.facebook;
  assert.equal(rules.MIN_WORDS, 130);
  assert.equal(rules.MAX_WORDS, 220);
  assert.equal(rules.MIN_PARAGRAPHS, 2);
  assert.equal(rules.MAX_PARAGRAPHS, 4);
});

test('instagram requires 120 to 200 words in 2 to 4 paragraphs', () => {
  const rules = POST_COPY_RULES.instagram;
  assert.equal(rules.MIN_WORDS, 120);
  assert.equal(rules.MAX_WORDS, 200);
  assert.equal(rules.MIN_PARAGRAPHS, 2);
  assert.equal(rules.MAX_PARAGRAPHS, 4);
});

test('threads requires 45 to 100 words in 1 to 3 paragraphs', () => {
  const rules = POST_COPY_RULES.threads;
  assert.equal(rules.MIN_WORDS, 45);
  assert.equal(rules.MAX_WORDS, 100);
  assert.equal(rules.MIN_PARAGRAPHS, 1);
  assert.equal(rules.MAX_PARAGRAPHS, 3);
});

test("threads' band does not overlap facebook's as a range", () => {
  /*
   * The two bands meet at exactly 100 words and share only that point. A single
   * length can therefore satisfy both only by landing on it exactly; there is no
   * RANGE where a Threads post is also a valid Facebook post, which is what
   * stops "trim the Facebook post" from being a way to produce Threads copy.
   */
  assert.ok(
    POST_COPY_RULES.threads.MAX_WORDS <= POST_COPY_RULES.facebook.MIN_WORDS,
    `Threads (max ${POST_COPY_RULES.threads.MAX_WORDS}) overlaps Facebook (min ${POST_COPY_RULES.facebook.MIN_WORDS})`,
  );
});

/*
 * Every message below is asserted for its NUMBERS, not for a phrase.
 *
 * These reasons are shown to users and fed back to the writer on a repair, so
 * the thing that matters is that each one carries the real count next to the
 * required one. A generic "too short" would satisfy a /too short/ regex and
 * tell nobody anything — which is precisely how planner item 31 came to store
 * "the instagram post could not be written to a valid length or shape" nine
 * times over.
 */

test('post copy that is too short for its platform is rejected, with the real count', () => {
  const short = postFor('facebook', ['Forty words is fine for Threads and nowhere near enough for Facebook.', 'So this fails.']);
  const issues = postCopyIssues(short.caption, 'facebook');
  const words = wordCount(short.caption);
  assert.ok(
    issues.includes(`Facebook has ${words} words; the minimum is ${POST_COPY_RULES.facebook.MIN_WORDS}`),
    JSON.stringify(issues),
  );
});

test('post copy that is too long for its platform is rejected, with the real count', () => {
  // Four 60-word paragraphs = 240 words, over Facebook's 220 ceiling, and each
  // paragraph stays under the wall-of-text limit so it is length that fails.
  const para = 'roof '.repeat(60).trim();
  const long = [para, para, para, para].join('\n\n');
  const issues = postCopyIssues(long, 'facebook');
  assert.ok(
    issues.includes(`Facebook has 240 words; the maximum is ${POST_COPY_RULES.facebook.MAX_WORDS}`),
    JSON.stringify(issues),
  );
});

test('a single block that meets the word count is still rejected as one paragraph', () => {
  const oneBlock = 'word '.repeat(120).trim();
  const issues = postCopyIssues(oneBlock, 'facebook');
  assert.ok(
    issues.includes('Facebook has 1 paragraph; it needs 2 to 4'),
    `a 120-word wall of text must not pass: ${JSON.stringify(issues)}`,
  );
});

test('too many paragraphs is rejected, and says how many there are', () => {
  const many = Array.from({ length: 6 }, () => 'word '.repeat(20).trim()).join('\n\n');
  const issues = postCopyIssues(many, 'facebook');
  assert.ok(issues.includes('Facebook has 6 paragraphs; it needs 2 to 4'), JSON.stringify(issues));
});

test('one enormous paragraph is rejected even when the paragraph count passes', () => {
  const lopsided = [`${'word '.repeat(PARAGRAPH_MAX_WORDS + 10).trim()}`, 'A short second paragraph here.'].join('\n\n');
  const issues = postCopyIssues(lopsided, 'facebook');
  assert.ok(
    issues.includes(
      `Facebook has a paragraph of ${PARAGRAPH_MAX_WORDS + 10} words; `
      + `the maximum for one paragraph is ${PARAGRAPH_MAX_WORDS}`,
    ),
    JSON.stringify(issues),
  );
});

test('hashtags inside the post copy are rejected', () => {
  const withTags = `${PLAN[0].facebook}\n\nFollow along #seo #localseo`;
  const issues = postCopyIssues(withTags, 'facebook');
  assert.ok(
    issues.includes('Facebook has hashtags inside the post copy; they belong at the end'),
    JSON.stringify(issues),
  );
});

test('a singular count reads as a sentence, not as a row in a table', () => {
  // "1 words" is the tell that a message was assembled rather than written, and
  // these are read by users now.
  assert.ok(postCopyIssues('word', 'threads').includes('Threads has 1 word; the minimum is 45'));
  assert.ok(postCopyIssues('word '.repeat(120).trim(), 'facebook')
    .includes('Facebook has 1 paragraph; it needs 2 to 4'));
});

test('empty post copy names the platform rather than saying "empty post copy"', () => {
  assert.deepEqual(postCopyIssues('', 'instagram'), ['Instagram has no post copy']);
});

test('an unknown platform gets no invented length verdict', () => {
  assert.deepEqual(postCopyIssues('anything at all', 'mastodon'), []);
});

// --- the guard applies the platform rules ------------------------------------

test('applyStyleGuard rejects a thin post when it knows the platform', () => {
  const guarded = applyStyleGuard(
    { caption: 'We build websites. Call us today for a quote.', headline: 'We build websites for you' },
    { platform: 'facebook' },
  );
  assert.ok(
    guarded.rejections.includes(`Facebook has 9 words; the minimum is ${POST_COPY_RULES.facebook.MIN_WORDS}`),
    JSON.stringify(guarded.rejections),
  );
});

test('applyStyleGuard without a platform falls back to the old floor and never throws', () => {
  const guarded = applyStyleGuard({ caption: 'short', headline: 'A perfectly reasonable headline' });
  assert.ok(guarded.rejections.some((r) => /too thin/.test(r)));
});

test('a banned phrase forces a rejection, not a repair', () => {
  const guarded = applyStyleGuard(
    { caption: `In today's digital world, ${PLAN[0].facebook}`, headline: 'A specific useful headline here' },
    { platform: 'facebook' },
  );
  assert.ok(
    guarded.rejections.some((r) => /generic marketing phrasing/.test(r)),
    JSON.stringify(guarded.rejections),
  );
});

test('the guard repairs dashes in the caption while keeping its paragraphs', () => {
  const caption = PLAN[1].facebook.replace('. ', ' — ');
  const guarded = applyStyleGuard({ caption, headline: 'A specific useful headline here' }, { platform: 'facebook' });
  assert.equal(hasBannedDash(guarded.content.caption), false);
  assert.ok(guarded.repaired.includes('caption'));
  assert.ok(paragraphsOf(guarded.content.caption).length >= 2, 'paragraphs must survive the repair');
});

// --- platform versions are not copies ----------------------------------------

test('identical copy across platforms is detected', () => {
  const same = PLAN[0].facebook;
  assert.equal(uniqueness.platformCopyTooSimilar(same, same), true);
});

test('a trimmed copy of another platform is detected', () => {
  const full = PLAN[2].facebook;
  const trimmed = paragraphsOf(full).slice(0, 2).join('\n\n');
  assert.equal(
    uniqueness.platformCopyTooSimilar(full, trimmed),
    true,
    'a Threads post that is just the first half of the Facebook post must be caught',
  );
});

test('two genuinely different posts on the same subject are allowed', () => {
  for (const post of PLAN) {
    assert.equal(
      uniqueness.platformCopyTooSimilar(post.facebook, post.threads),
      false,
      `day ${post.day}: the Threads post reads as a copy of the Facebook post`,
    );
  }
});

test('a shared opening is caught even when the rest of the post diverges', () => {
  /*
   * The defect this was written for: a whole-post score averages over the post,
   * so two versions that reuse their opening verbatim and then genuinely differ
   * scored as merely "similar" and passed. The opening is what a reader sees in
   * the feed, so it gets its own, tighter check.
   */
  const shared = 'A template is not the cheap option and a custom build is not the serious one.';
  const a = `${shared}\n\nOne of them gets you live this week. That matters when the site is a brochure and the brochure is late.`;
  const b = `${shared}\n\nThe other earns its cost in year two, when the business has changed and the theme has not. Different question entirely, different answer.`;

  assert.equal(
    uniqueness.platformCopyTooSimilar(a, b),
    true,
    'two posts that open with the same paragraph must be flagged even though the bodies differ',
  );
});

test('every platform pair in the sample plan opens differently', () => {
  const failures = [];
  for (const post of PLAN) {
    const pairs = [
      ['facebook', 'instagram'],
      ['facebook', 'threads'],
      ['instagram', 'threads'],
    ];
    for (const [x, y] of pairs) {
      if (uniqueness.platformCopyTooSimilar(post[x], post[y])) {
        failures.push(`day ${post.day}: ${x} and ${y} are the same post`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('the week does not run one paragraph rhythm on every post', () => {
  /*
   * Seven posts that are each individually fine and all 4 paragraphs long read
   * as a template. This is a pattern failure, invisible one post at a time,
   * which is why it is asserted over the whole plan.
   */
  for (const platform of ['facebook', 'instagram']) {
    const shapes = new Set(PLAN.map((p) => paragraphsOf(p[platform]).length));
    assert.ok(
      shapes.size >= 2,
      `every ${platform} post in the week has the same paragraph count (${[...shapes]})`,
    );
  }
});

test('platform similarity never throws on empty or malformed input', () => {
  assert.equal(uniqueness.platformCopyTooSimilar('', 'abc'), false);
  assert.equal(uniqueness.platformCopyTooSimilar(null, undefined), false);
  assert.equal(uniqueness.platformCopyTooSimilar('abc', 42), false);
});

// --- the sample plan meets the standard it documents --------------------------

test('every post in the sample plan meets its platform standard', () => {
  const failures = [];
  for (const post of PLAN) {
    for (const platform of PLATFORMS) {
      for (const issue of postCopyIssues(post[platform], platform)) {
        failures.push(`day ${post.day} ${platform}: ${issue} (${wordCount(post[platform])} words)`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('no post in the sample plan contains an em or en dash', () => {
  for (const post of PLAN) {
    for (const platform of PLATFORMS) {
      assert.equal(hasBannedDash(post[platform]), false, `day ${post.day} ${platform} contains a banned dash`);
    }
    assert.equal(hasBannedDash(post.headline), false, `day ${post.day} headline contains a banned dash`);
  }
});

test('no post in the sample plan uses a banned phrase', () => {
  for (const post of PLAN) {
    for (const platform of PLATFORMS) {
      const guarded = applyStyleGuard({ caption: post[platform], headline: post.headline }, { platform });
      const generic = guarded.rejections.filter((r) => /generic marketing phrasing/.test(r));
      assert.deepEqual(generic, [], `day ${post.day} ${platform}: ${generic.join('; ')}`);
    }
  }
});

test('the sample plan opens every post differently', () => {
  const openings = new Map();
  for (const post of PLAN) {
    for (const platform of PLATFORMS) {
      const opening = paragraphsOf(post[platform])[0];
      const key = `${platform}:${opening.slice(0, 40).toLowerCase()}`;
      assert.ok(!openings.has(key), `day ${post.day} ${platform} repeats an opening from day ${openings.get(key)}`);
      openings.set(key, post.day);
    }
  }
});

test('the sample plan uses at least four writing formats over seven days', () => {
  const formats = new Set(PLAN.map((p) => p.format));
  assert.ok(formats.size >= 4, `only ${formats.size} formats: ${[...formats].join(', ')}`);
});

test('the sample plan gives every day a different topic', () => {
  const headlines = new Set(PLAN.map((p) => p.headline.toLowerCase()));
  assert.equal(headlines.size, PLAN.length, 'two days share a headline');
});
