/**
 * The weekly card and the edit drawer must never disagree.
 *
 * Live symptom: after a retry the card showed the new post copy while the open
 * drawer still showed the previous copy. The two were not reading different
 * FIELDS — both read `item.caption`. The drawer was reading a different ITEM: an
 * object captured by value when it opened, which nothing ever refreshed.
 *
 * These assert the shipped frontend, because that is what the browser loads.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (rel) => readFileSync(path.join(PUBLIC_DIR, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const WEEK = stripComments(read('assets/js/pages/plannerWeek.js'));
const CARD = stripComments(read('assets/js/components/plannerCard.js'));

test('the drawer tracks the open item by id, never by captured object', () => {
  assert.match(WEEK, /let openItemId/, 'the drawer must remember WHICH item, not which snapshot');
  assert.match(WEEK, /function refreshDrawer/, 'an open drawer must be re-renderable');
  assert.match(
    WEEK,
    /plan\?\.items\?\.find\(\(i\) => i\.id === openItemId\)/,
    'the drawer must re-read the item from the reloaded plan',
  );
});

test('every reload refreshes the drawer as well as the board', () => {
  const load = WEEK.slice(WEEK.indexOf('async function load()'));
  const body = load.slice(0, load.indexOf('\n  }'));
  assert.match(body, /renderBoard\(\)/, 'the board refreshes');
  assert.match(body, /refreshDrawer\(\)/, 'the drawer must refresh in the same breath as the board');
});

test('a regeneration leaves the drawer open so the result is visible', () => {
  // Sliced on the handler's own finally block, not on the first `});` — the
  // body nests a confirmModal({...}) call, so the naive boundary cut it short
  // and the test measured almost nothing.
  const start = WEEK.indexOf('regenCaptionBtn.addEventListener');
  const end = WEEK.indexOf('setLoading(regenCaptionBtn, false)', start);
  assert.ok(start > 0 && end > start, 'the regenerate handler should be findable');
  const body = WEEK.slice(start, end);

  assert.ok(!/closeDrawer\(\)/.test(body), 'closing the drawer hides the very result the user asked for');
  assert.match(body, /await load\(\)/, 'it must reload so the drawer re-renders with the new copy');
});

test('a deleted item closes the drawer rather than showing a ghost', () => {
  const refresh = WEEK.slice(WEEK.indexOf('function refreshDrawer'));
  const body = refresh.slice(0, refresh.indexOf('\n  }'));
  assert.match(body, /if \(!latest\) \{ closeDrawer\(\); return; \}/);
});

test('the card and the drawer read the same field', () => {
  // Both must render `item.caption`. If one ever moves to platformCaptions and
  // the other does not, they can disagree again.
  assert.match(CARD, /item\.caption/, 'the card renders item.caption');
  assert.match(WEEK, /value: item\.caption/, 'the drawer renders item.caption');
});

test('the retry handler reloads so both views update together', () => {
  const retry = WEEK.slice(WEEK.indexOf('async function retryGeneration'));
  const body = retry.slice(0, retry.indexOf('\n  }'));
  assert.match(body, /await load\(\)/, 'a retry must reload the plan, refreshing card and drawer at once');
  assert.match(body, /generation_failed/, 'a retry that still fails must say so rather than claim success');
});
