/**
 * The writer's target must never be the validator's edge.
 *
 * This is the file that would have prevented planner item 31. The prompt asked
 * Threads for "45 to 100 words" because POST_COPY_RULES.threads.MIN_WORDS was
 * 45, so the model aimed at 45 and delivered 44 — rejected by the very number
 * the instruction had quoted at it. regeneration_count reached 9, with
 * duplication_score 0.157 confirming nothing else was wrong with the post.
 *
 * So these tests assert a RELATIONSHIP rather than a set of magic numbers: every
 * target band sits strictly inside its hard band with real margin at both ends.
 * Anyone may retune a target; nobody may quietly push one back onto the edge.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POST_COPY_RULES,
  POST_COPY_TARGETS,
  POST_COPY_TARGET_MIN_MARGIN,
  PLATFORM_VALUES,
  PLANNER_LIMITS,
} from '../src/config/constants.js';
import { targetBandFor, postCopyIssues } from '../src/services/contentStyleGuard.js';
import { buildPlannerSchema } from '../src/services/openaiContentService.js';

test('every supported platform has both a hard band and a target band', () => {
  for (const platform of PLATFORM_VALUES) {
    assert.ok(POST_COPY_RULES[platform], `${platform} has no validator band`);
    assert.ok(POST_COPY_TARGETS[platform], `${platform} has no target band`);
  }
});

test('no target ever touches the validator edge it is meant to clear', () => {
  for (const platform of PLATFORM_VALUES) {
    const hard = POST_COPY_RULES[platform];
    const target = POST_COPY_TARGETS[platform];

    const floorMargin = target.MIN_WORDS - hard.MIN_WORDS;
    const ceilingMargin = hard.MAX_WORDS - target.MAX_WORDS;

    assert.ok(
      floorMargin >= POST_COPY_TARGET_MIN_MARGIN,
      `${platform}: aiming at ${target.MIN_WORDS} against a ${hard.MIN_WORDS} floor leaves `
      + `${floorMargin} words of room, and a normal miss lands outside the band`,
    );
    assert.ok(
      ceilingMargin >= POST_COPY_TARGET_MIN_MARGIN,
      `${platform}: aiming at ${target.MAX_WORDS} against a ${hard.MAX_WORDS} ceiling leaves `
      + `${ceilingMargin} words of room`,
    );
  }
});

test('the narrow band used on a last attempt is inside the target band', () => {
  for (const platform of PLATFORM_VALUES) {
    const t = POST_COPY_TARGETS[platform];
    assert.ok(t.NARROW_MIN >= t.MIN_WORDS, `${platform}: narrow floor escapes the target band`);
    assert.ok(t.NARROW_MAX <= t.MAX_WORDS, `${platform}: narrow ceiling escapes the target band`);
    assert.ok(t.NARROW_MIN < t.NARROW_MAX, `${platform}: narrow band is inverted or empty`);
  }
});

test('a target band is a real range, not a single number dressed up as one', () => {
  for (const platform of PLATFORM_VALUES) {
    const t = POST_COPY_TARGETS[platform];
    assert.ok(t.MIN_WORDS < t.MAX_WORDS, `${platform}: inverted target band`);
    assert.ok(t.MAX_WORDS - t.MIN_WORDS >= 20, `${platform}: a band this tight is an instruction to miss`);
  }
});

// --- the hard rules are NOT relaxed -----------------------------------------

test('the hard validation ranges are exactly the ones the product promises', () => {
  // Pinned deliberately. The fix for a boundary problem is to move the TARGET;
  // moving the validator instead would be the shortcut this test exists to stop.
  assert.deepEqual(POST_COPY_RULES.facebook, {
    MIN_WORDS: 130, MAX_WORDS: 220, MIN_PARAGRAPHS: 2, MAX_PARAGRAPHS: 4,
  });
  assert.deepEqual(POST_COPY_RULES.instagram, {
    MIN_WORDS: 120, MAX_WORDS: 200, MIN_PARAGRAPHS: 2, MAX_PARAGRAPHS: 4,
  });
  assert.deepEqual(POST_COPY_RULES.threads, {
    MIN_WORDS: 45, MAX_WORDS: 100, MIN_PARAGRAPHS: 1, MAX_PARAGRAPHS: 3,
  });
});

test('a post inside the hard band but outside the target band is still perfectly valid', () => {
  // The target moves where the writer AIMS. It must never become a second,
  // stricter validator: 46 words is a fine Threads post and is not rejected
  // merely for missing the 55-word target.
  const copy = `${'word '.repeat(46).trim()}`;
  assert.deepEqual(postCopyIssues(copy, 'threads'), []);
});

// --- the target reaches the model -------------------------------------------

test('the prompt schema tells the writer the target band, never the hard floor', () => {
  for (const platform of PLATFORM_VALUES) {
    const { description } = buildPlannerSchema(platform, 'educational_insight').properties.caption;
    const target = POST_COPY_TARGETS[platform];
    const hard = POST_COPY_RULES[platform];

    assert.ok(description.includes(`${target.MIN_WORDS} to ${target.MAX_WORDS} words`), `${platform}: ${description}`);
    assert.ok(
      !description.includes(`${hard.MIN_WORDS} to ${hard.MAX_WORDS} words`),
      `${platform}: the schema is quoting the validator's band at the writer again`,
    );
  }
});

test('a caller may narrow the band for a late attempt', () => {
  const { description } = buildPlannerSchema('threads', 'educational_insight', { min: 78, max: 85 }).properties.caption;
  assert.ok(description.includes('78 to 85 words'), description);
});

// --- which band each attempt aims at ----------------------------------------

test('the first two attempts aim at the plain target band', () => {
  for (const attempt of [0, 1]) {
    assert.deepEqual(targetBandFor('threads', attempt), { min: 55, max: 85 });
  }
});

test('a third attempt is pushed AWAY from the edge it actually missed', () => {
  // Short twice: aim high. Aiming a repeatedly-short writer at the same midpoint
  // that already failed twice is not a different instruction.
  const afterShort = targetBandFor('threads', 2, { words: 44 });
  assert.ok(afterShort.min > POST_COPY_TARGETS.threads.MIN_WORDS, JSON.stringify(afterShort));
  assert.ok(afterShort.min >= POST_COPY_TARGETS.threads.NARROW_MAX, JSON.stringify(afterShort));

  // Long: aim low.
  const afterLong = targetBandFor('threads', 2, { words: 140 });
  assert.ok(afterLong.max < POST_COPY_TARGETS.threads.MAX_WORDS, JSON.stringify(afterLong));

  // Every band handed to a writer stays inside what the validator accepts,
  // whichever way the miss went.
  for (const band of [afterShort, afterLong]) {
    assert.ok(band.min >= POST_COPY_RULES.threads.MIN_WORDS, JSON.stringify(band));
    assert.ok(band.max <= POST_COPY_RULES.threads.MAX_WORDS, JSON.stringify(band));
  }
});

test('a third attempt with nothing measured falls back to the narrow centre', () => {
  assert.deepEqual(targetBandFor('threads', 2, null), {
    min: POST_COPY_TARGETS.threads.NARROW_MIN,
    max: POST_COPY_TARGETS.threads.NARROW_MAX,
  });
});

test('an unknown platform gets no invented target', () => {
  assert.equal(targetBandFor('mastodon', 0), null);
});

// --- the attempt budget ------------------------------------------------------

test('post copy is attempted three times per platform, and no more', () => {
  // Bounded on purpose: a fourth attempt at the same prompt is not a strategy,
  // it is spend. Item 31 reached regeneration_count 9.
  assert.equal(PLANNER_LIMITS.MAX_COPY_ATTEMPTS, 3);
});
