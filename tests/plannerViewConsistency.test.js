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
const NEW = stripComments(read('assets/js/pages/plannerNew.js'));
const ICONS = stripComments(read('assets/js/icons.js'));

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
  // Force-close: a deleted item has no edits worth warning about.
  assert.match(body, /if \(!latest\) \{ closeDrawer\(\{ force: true \}\); return; \}/);
});

test('the drawer edits per-platform copy, not one shared caption', () => {
  /*
   * C2: the drawer used to render `item.caption` in a single textarea, so a
   * Threads-only repair changed the stored copy and the drawer showed no
   * difference. It now renders the canonical `item.platformCopy` through the
   * shared platform editor, one tab per selected platform.
   */
  assert.match(WEEK, /platformEditor\(\{/, 'the drawer builds the per-platform editor');
  assert.match(WEEK, /platformCopy: item\.platformCopy/, 'the editor reads the canonical resolved copy');
  assert.ok(!/value: item\.caption/.test(WEEK), 'the single shared-caption field is gone');
  // The card still shows item.caption as the primary summary line — that is a
  // read-only preview and stays.
  assert.match(CARD, /item\.caption/, 'the card still previews the primary caption');
});

test('the editor submits only the platforms the user changed', () => {
  const save = WEEK.slice(WEEK.indexOf('saveBtn.addEventListener'));
  const body = save.slice(0, save.indexOf('setLoading(saveBtn, false)'));
  assert.match(body, /const platformCaptions = editor\.read\(\)/, 'reads the changed platforms');
  assert.match(body, /body\.platformCaptions = platformCaptions/, 'sends them as platformCaptions');
});

test('the retry handler reloads so both views update together', () => {
  const retry = WEEK.slice(WEEK.indexOf('async function retryGeneration'));
  const body = retry.slice(0, retry.indexOf('\n  }'));
  assert.match(body, /await load\(\)/, 'a retry must reload the plan, refreshing card and drawer at once');
  assert.match(body, /generation_failed/, 'a retry that still fails must say so rather than claim success');
});

// --- one click, one generation ----------------------------------------------

/*
 * A retry takes seconds and the button used to look identical throughout, so
 * people clicked it repeatedly. Each click was a full generation: real spend,
 * and two writes racing for one row. Both halves are asserted here — the button
 * that refuses, and the handler that tracks the item.
 */

test('the retry button refuses to fire while it is already running', () => {
  const start = CARD.indexOf("text: 'Retry generation'");
  const body = CARD.slice(start, CARD.indexOf('actions.appendChild(retryBtn)', start));
  assert.match(body, /if \(retryBtn\.disabled\) return/, 'a disabled retry button must not fire the handler');
  assert.match(body, /handlers\.onRetry\?\.\(item, retryBtn\)/, 'the handler needs the button to disable it');
});

test('the retry handler shows it is working and ignores clicks while in flight', () => {
  const start = WEEK.indexOf('async function retryGeneration');
  const body = WEEK.slice(start, WEEK.indexOf('\n  async function setStatus', start));

  assert.match(body, /if \(retrying\.has\(item\.id\)\) return/, 'a second click must be dropped, not sent');
  assert.match(body, /retrying\.add\(item\.id\)/);
  assert.match(body, /setLoading\(btn, true/, 'the button must show that something is happening');
  // Released in a finally, so a thrown request cannot lock the item forever.
  assert.match(body, /finally \{[\s\S]*retrying\.delete\(item\.id\)/, 'the guard must release even on failure');
});

test('one retry produces exactly one toast', () => {
  const start = WEEK.indexOf('async function retryGeneration');
  const body = WEEK.slice(start, WEEK.indexOf('\n  async function setStatus', start));
  // Three outcomes, mutually exclusive: request failed, still failing, worked.
  // The error path returns, so no call can ever reach a second toast.
  const toasts = body.match(/toast\(/g) ?? [];
  assert.equal(toasts.length, 3, `expected exactly three exclusive outcomes: ${toasts.length}`);
  assert.match(body, /toast\(api\.errorMessage[\s\S]*?return;/, 'the error path must return before the others');
});

// --- the user can see why it failed ------------------------------------------

test('a failed card renders the exact reasons, not just a status chip', () => {
  // The reasons were already stored and already precise. Nothing showed them,
  // so the only way to learn why a post would not generate was phpMyAdmin.
  assert.match(CARD, /function failureDetails/);
  assert.match(CARD, /item\.qualityFailures/, 'the card must read the stored reasons');
  assert.match(CARD, /needs? another rewrite/, 'a friendly summary leads');
  assert.match(CARD, /el\('details'/, 'the exact reasons are one click away, not the headline');
});

test('failure reasons reach the DOM as text, never as markup', () => {
  // Validator output includes quoted user-ish content ("a agency" should be
  // "an agency"). It goes in through textContent like everything else here.
  const start = CARD.indexOf('function failureDetails');
  const body = CARD.slice(start, CARD.indexOf('\n}', start));
  assert.ok(!/innerHTML/.test(body), 'never innerHTML');
  assert.match(body, /el\('li', \{ text: String\(r\) \}\)/);
});

test('the summary names the platforms by prefix match, against a fixed list', () => {
  // Not parsing: the server writes each reason with its platform first, and
  // this checks three known names. An unattributable reason is still shown.
  assert.match(CARD, /PLATFORM_NAMES = Object\.freeze\(\['Facebook', 'Instagram', 'Threads'\]\)/);
  assert.match(CARD, /startsWith\(name\)/);
});

// --- connected is not selected -----------------------------------------------

test('the wizard ticks a platform only because the user chose it', () => {
  /*
   * The live bug's UI half. This read
   *
   *   !prefs?.platforms?.length || prefs.platforms.includes(p)
   *
   * so a user with no saved default had every connected account pre-ticked.
   * Someone who wanted Instagram and Threads got Facebook posts, and two of
   * three failed because the unwanted Facebook copy missed its length band.
   */
  const start = NEW.indexOf('const platformHost');
  const body = NEW.slice(start, NEW.indexOf('const platformCard', start));

  assert.ok(!/!prefs\?\.platforms\?\.length \|\|/.test(body), 'connected accounts must not tick themselves');
  assert.match(body, /Boolean\(prefs\?\.platforms\?\.includes\(p\)\)/, 'a box is ticked only by a saved choice');
});

test('the wizard sends exactly the ticked boxes, and nothing else', () => {
  const start = NEW.indexOf('platforms: [...platformHost');
  const body = NEW.slice(start, start + 220);
  assert.match(body, /\.filter\(\(i\) => i\.checked\)/, 'only ticked boxes are sent');
});

// --- the pre-submit confirmation ---------------------------------------------

test('the wizard confirms what it is about to send, from the payload itself', () => {
  const start = NEW.indexOf('async function refreshSummary');
  const body = NEW.slice(start, NEW.indexOf('let summaryDebounce', start));

  // Rendered from `body` — the object about to be POSTed — not from the form,
  // not from saved preferences, not from what happens to be connected.
  assert.match(body, /const names = platformNames\(body\.platforms\)/);
  assert.match(body, /data-confirm-platforms/, 'the platform line must be findable, so it can be checked');

  for (const row of ['Platforms', 'Accounts', 'Dates', 'Times', 'Posts', 'Weekly rhythm']) {
    assert.ok(body.includes(`'${row}'`), `the confirmation must state ${row}`);
  }
});

test('a chosen but unconnected platform is explained, not silently dropped', () => {
  const start = NEW.indexOf('async function refreshSummary');
  const body = NEW.slice(start, NEW.indexOf('let summaryDebounce', start));
  assert.match(body, /summary\.selectedPlatforms \|\| \[\]\)\.filter\(\(p\) => !summary\.platforms\.includes\(p\)\)/);
});

// --- platform labels ---------------------------------------------------------

test('platform ids and provider ids have separate label maps', () => {
  // Two of three keys overlap, so PROVIDER_LABELS "worked" on platform ids for
  // Instagram and Threads and missed on Facebook — printing the raw lowercase
  // internal id to users on the weekly board.
  assert.match(ICONS, /PLATFORM_LABELS = Object\.freeze\(\{[\s\S]*?facebook: 'Facebook'/);
  assert.match(ICONS, /instagram: 'Instagram Professional'/);
  assert.match(ICONS, /PROVIDER_LABELS = Object\.freeze\(\{[\s\S]*?meta: 'Facebook Pages'/);
  // `meta` must NOT resolve through the platform map: a provider id arriving
  // there is a bug and should look like one.
  const platformMap = ICONS.slice(ICONS.indexOf('PLATFORM_LABELS = Object.freeze('));
  assert.ok(!/meta:/.test(platformMap.slice(0, platformMap.indexOf('})'))));
});

test('nothing renders a platform id through the provider label map', () => {
  // Each of these reads platform ids. Using PROVIDER_LABELS here is the bug.
  for (const [name, src] of [['plannerCard', CARD], ['plannerWeek', WEEK], ['plannerNew', NEW]]) {
    assert.ok(!/PROVIDER_LABELS\[/.test(src), `${name} looks up a platform id in the provider map`);
  }
  // The card resolves platform ids through platformNames. It now does so inside
  // platformTargetLabel, which also appends the target account name, so the
  // board and the drawer cannot disagree about what a post is aimed at.
  assert.match(CARD, /export function platformTargetLabel/,
    'the card must own one label renderer for platform + account');
  assert.match(CARD, /platformNames\(item\?\.platformTargets \|\| \[\]\)/,
    'platform ids must still resolve through platformNames');
  assert.match(CARD, /const platforms = platformTargetLabel\(item\)/,
    'the card must render through the shared helper');
  assert.match(WEEK, /platformTargetLabel\(item\)/,
    'the edit drawer must use the same helper as the card, not its own formatting');
});

// --- a failed plan cannot be approved wholesale ------------------------------

test('Approve all is disabled while a post could not be generated', () => {
  const start = WEEK.indexOf('function renderBulk');
  const body = WEEK.slice(start, WEEK.indexOf('async function bulkStatus', start));

  assert.match(body, /const failed = hardFailedItems\(\)/);
  assert.match(body, /approveSelected\.disabled = blocked/);
  // A selection containing a failure is blocked too, so the failure cannot be
  // smuggled through by ticking boxes.
  assert.match(body, /const selectionHasFailures = failed\.some\(\(i\) => selected\.has\(i\.id\)\)/);
  assert.match(body, /const blocked = count === 0 \? failed\.length > 0 : selectionHasFailures/);
  // And the click itself refuses, not just the styling.
  assert.match(body, /if \(approveSelected\.disabled\) return/);
});

test('a disabled Approve all says why, next to itself', () => {
  const start = WEEK.indexOf('function renderBulk');
  const body = WEEK.slice(start, WEEK.indexOf('async function bulkStatus', start));
  assert.match(body, /could not be generated, so this plan cannot be approved in one go/);
  assert.match(body, /can still be approved individually/, 'it must say what the user CAN do');
});

test('the failed count is grammatical in the singular', () => {
  const start = WEEK.indexOf('function renderBulk');
  const body = WEEK.slice(start, WEEK.indexOf('async function bulkStatus', start));
  assert.match(body, /failed\.length === 1 \? '' : 's'/, '"1 posts" is the tell that nobody read it');
});
