// The automation card presented a post from earlier that day as "Next post",
// and kept offering a rejected post as the next one.
//
// A slot is `ready` once its CONTENT exists; that says nothing about whether
// the moment has passed or whether the user approved it. The card was filtering
// by local DATE, so a 02:45 slot still matched "today" at 14:00, and it ignored
// approval entirely — even though rejecting is precisely how a user says "not
// this one".
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/services/automationService.js', import.meta.url), 'utf8');
const body = SOURCE.slice(SOURCE.indexOf('async function selectNextPost'));
const fn = body.slice(0, body.indexOf('async function toPublic'));

test('the next post is chosen by instant, not by calendar date', () => {
  assert.match(fn, /const nowMs = now\(\)\.getTime\(\)/,
    'the comparison must use the clock, not the date');
  assert.match(fn, /return Number\.isFinite\(at\) && at > nowMs;/,
    'only a slot whose moment is still ahead may be the next post');
  assert.doesNotMatch(fn, /fromLocalDate/,
    'a date filter cannot tell 02:45 from 14:00 on the same day');
});

test('a rejected post can never be the next post', () => {
  assert.match(fn, /it\.approvalStatus === 'rejected'/,
    'rejection must be read from the planner item');
  assert.match(fn, /!\(slot\.plannerRunItemId && rejected\.has\(String\(slot\.plannerRunItemId\)\)\)/,
    'a slot whose item was rejected must be excluded');
});

test('the rejected set is resolved once, not per slot', () => {
  // A per-slot lookup would issue one plan read per slot on every card render.
  const planReads = (fn.match(/planner\.getPlan\(/g) || []).length;
  assert.equal(planReads, 1, 'exactly one plan read per card');
});

test('no usable slot means no next post, rather than a stale one', () => {
  assert.match(fn, /if \(!future\.length\) return null;/,
    'every slot in the past means there is no next post');
  assert.match(fn, /if \(!usable\.length\) return null;/,
    'every remaining slot rejected means there is no next post');
});

test('the earliest future slot wins, regardless of query order', () => {
  assert.match(fn, /usable\.sort\(\(x, y\) => String\(x\.scheduledForUtc\)\.localeCompare\(String\(y\.scheduledForUtc\)\)\)/,
    'the next post must be the soonest one, not whichever the query returned first');
});

test('a plan read failure degrades to showing no next post, not to crashing the card', () => {
  assert.match(fn, /planner\.getPlan\(a\.userId, a\.plannerRunId\)\.catch\(\(\) => null\)/,
    'the summary must survive a failed plan read');
});
