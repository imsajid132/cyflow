// Weekly Board: edits that reported success without persisting, posts that did
// not say which Page they target, and a plan header that printed "null to null".
//
// The reproduction item throughout is the one from staging: 2026-07-26 02:45,
// Facebook, NYC Waterproofing, SEO/Austin content, needs_review.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { makeApp, registerUser, defaultCreds } from './helpers/apiHarness.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const ORIGINAL_COPY = 'Austin SEO tips for local businesses that want to rank this quarter.';
const NEW_COPY = 'Basement leaking? Our crew waterproofs New York homes from the outside in.';

async function setup({ withAutomation = true } = {}) {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const userId = String(me.body.data.user.id);

  await overrides.socialAccountRepository.upsertSocialAccount({
    userId, provider: 'meta', accountType: 'facebook_page', providerAccountId: 'fb-page-99',
    displayName: 'NYC Waterproofing', username: 'nycwaterproofing-private-handle',
    encryptedAccessToken: 'v1:super-secret-page-token', scopes: [], providerMetadata: {}, status: 'active',
  });
  const accounts = await overrides.socialAccountRepository.listAccountsForUser(userId);
  const fbId = accounts[0].id;

  let automationId = null;
  if (withAutomation) {
    const created = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send({
      name: 'Staging Automation Test', mode: 'review', timezone: 'Asia/Karachi',
      selectedWeekdays: [7], postingTimes: ['02:45'], postsPerDay: 1, rhythmKey: 'balanced',
      selectedPlatforms: ['facebook'], selectedAccountIds: [fbId], missedPostPolicy: 'skip',
      generationHorizonDays: 3, minimumReadyDays: 2, lowBufferDays: 1,
    });
    automationId = created.body.data.automation.id;
  }

  const runs = overrides.plannerRunRepository;
  // An automation-backed run: created before any content exists, so its stored
  // start and end dates are null. That is exactly the "null to null" case.
  const run = await runs.createRun({
    userId, contentAutomationId: automationId, name: 'Staging Automation Test',
    status: 'review', timezone: 'Asia/Karachi', startDate: null, endDate: null,
    settings: {}, resolvedRhythm: {},
  });

  const mkItem = (scheduledFor, position) => runs.createItem({
    userId, plannerRunId: run.id, scheduledFor, originalTimezone: 'Asia/Karachi',
    contentType: 'insight', goal: 'awareness', templateKey: 'editorial-premium',
    aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'Austin SEO in 2026', subheadline: 'What actually moves rankings',
    summary: 'seo', caption: ORIGINAL_COPY, altText: 'A laptop showing search results',
    hashtags: ['#seo', '#austin'], platformTargets: ['facebook'],
    platformCaptions: {
      facebook: { postCopy: ORIGINAL_COPY, hashtags: ['#seo', '#austin'], validationStatus: 'passed' },
    },
    approvalStatus: 'needs_review', position,
  });

  const july19 = await mkItem('2026-07-19 02:45:00', 0);
  const july26 = await mkItem('2026-07-26 02:45:00', 1);
  return { app, agent, csrf, overrides, userId, fbId, run, july19, july26 };
}

const editPayload = (over = {}) => ({
  headline: 'Waterproofing that lasts',
  subheadline: 'Exterior excavation, done once',
  altText: 'A waterproofed foundation wall in Brooklyn',
  templateKey: 'editorial-premium',
  backgroundStyle: 'light',
  platformCaptions: {
    facebook: { postCopy: NEW_COPY, hashtags: ['#waterproofing', '#nyc'] },
  },
  ...over,
});

const itemFromPlan = (body, id) => body?.data?.items?.find((i) => String(i.id) === String(id));

// --------------------------------------------------------------- persistence
test('editing the July 26 item persists the new Facebook copy', async () => {
  const { agent, csrf, july26 } = await setup();
  const res = await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());

  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body?.error || {})}`);
  // The response must be the newly persisted state, not an echo of the request.
  assert.equal(res.body.data.item.platformCopy.facebook.postCopy, NEW_COPY);
  assert.equal(res.body.data.item.headline, 'Waterproofing that lasts');
});

test('reopening the item returns the new copy, not the original', async () => {
  const { agent, csrf, run, july26 } = await setup();
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());

  // Exactly what the drawer does on reopen: reload the plan and read the item.
  const plan = await agent.get(`/api/planner/plans/${run.id}`);
  const item = itemFromPlan(plan.body, july26.id);

  assert.equal(item.platformCopy.facebook.postCopy, NEW_COPY, 'the edit must survive a reload');
  assert.notEqual(item.platformCopy.facebook.postCopy, ORIGINAL_COPY, 'the SEO/Austin copy must be gone');
  assert.equal(item.caption, NEW_COPY, 'the canonical caption follows the primary platform');
});

test('hashtags, headline, subheadline and alt text all persist', async () => {
  const { agent, csrf, run, july26 } = await setup();
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());
  const item = itemFromPlan((await agent.get(`/api/planner/plans/${run.id}`)).body, july26.id);

  assert.deepEqual(item.platformCopy.facebook.hashtags, ['#waterproofing', '#nyc']);
  assert.equal(item.headline, 'Waterproofing that lasts');
  assert.equal(item.subheadline, 'Exterior excavation, done once');
  assert.equal(item.altText, 'A waterproofed foundation wall in Brooklyn');
});

test('editing one item does not touch its sibling', async () => {
  const { agent, csrf, run, july19, july26 } = await setup();
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());
  const sibling = itemFromPlan((await agent.get(`/api/planner/plans/${run.id}`)).body, july19.id);
  assert.equal(sibling.platformCopy.facebook.postCopy, ORIGINAL_COPY, 'July 19 must be untouched');
});

test('one manual_edit revision is created, and a repeat save adds none', async () => {
  const { agent, csrf, july26 } = await setup();
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());

  const first = await agent.get(`/api/planner/items/${july26.id}/revisions`);
  const manual = (first.body.data.revisions || []).filter((r) => r.revisionType === 'manual_edit');
  assert.equal(manual.length, 1, 'exactly one revision for one edit');
  assert.equal(manual[0].platform, 'facebook');

  // Saving the identical content again is a no-op, not a second revision.
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());
  const second = await agent.get(`/api/planner/items/${july26.id}/revisions`);
  assert.equal((second.body.data.revisions || []).filter((r) => r.revisionType === 'manual_edit').length, 1,
    'a duplicate save must not add a revision');
});

// ------------------------------------------------------- failure never "saved"
test('an update that persists nothing is not reported as success', async () => {
  const { agent, csrf, overrides, july26 } = await setup();
  const runs = overrides.plannerRunRepository;
  const original = runs.updateItem.bind(runs);
  // The exact silent-no-op shape: the statement matches no row, so the caller
  // gets the unchanged item back and used to report "Saved." over it.
  runs.updateItem = async (itemId, userId) => original(itemId, userId, {});
  try {
    const res = await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());
    assert.notEqual(res.status, 200, 'a write that changed nothing must not return success');
    assert.equal(res.body.success, false);
    assert.match(res.body.error.message, /nothing was changed|could not be saved/i);
    assert.ok(res.body.requestId, 'the request id must be preserved for reporting');
  } finally {
    runs.updateItem = original;
  }
});

test('a revision that cannot be recorded fails the whole save', async () => {
  const { agent, csrf, overrides, july26 } = await setup();
  const revisions = overrides.plannerRevisionRepository;
  const original = revisions.recordRevision.bind(revisions);
  revisions.recordRevision = async () => { throw new Error('revision store unavailable'); };
  try {
    const res = await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());
    assert.notEqual(res.status, 200, 'the request must fail, not half-succeed');
    assert.equal(res.body.success, false, 'the client must not be told it saved');

    /*
     * The database rollback itself is NOT asserted here, and that is deliberate.
     * The suite's `fakeWithTransaction` simply invokes its callback — in-memory
     * fakes have no rollback — so any assertion about the row reverting would be
     * testing the harness, not the product. What this proves is the half that
     * the harness can prove: the request fails and reports no success. That both
     * statements run on one connection is asserted from the source in
     * "update and revision are written in one transaction", and the actual
     * rollback is MySQL's, exercised on a real database.
     */
  } finally {
    revisions.recordRevision = original;
  }
});

test("another user's item cannot be edited", async () => {
  // A second user on the SAME app, so the real ownership check runs. A separate
  // app would only prove that a session from one server is not valid on another.
  const { app, csrf: ownerCsrf, july26 } = await setup();
  const { agent: intruder, csrf: intruderCsrf } = await registerUser(
    app, defaultCreds({ email: 'intruder@example.com', name: 'Intruder' }),
  );
  const res = await intruder.patch(`/api/planner/items/${july26.id}`)
    .set('X-CSRF-Token', intruderCsrf).send(editPayload());

  assert.ok([403, 404].includes(res.status), `ownership must be enforced, got ${res.status}`);
  // And nothing about the other user's post leaks in the refusal.
  assert.ok(!JSON.stringify(res.body).includes(ORIGINAL_COPY));
  assert.ok(ownerCsrf);
});

test('a copy edit does not mutate the account relation', async () => {
  const { agent, csrf, run, july26, fbId, overrides, userId } = await setup();
  const before = await overrides.socialAccountRepository.listAccountsForUser(userId);
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());
  const after = await overrides.socialAccountRepository.listAccountsForUser(userId);

  assert.deepEqual(after.map((a) => String(a.id)), before.map((a) => String(a.id)),
    'editing copy must not add, remove or change a connected account');
  const item = itemFromPlan((await agent.get(`/api/planner/plans/${run.id}`)).body, july26.id);
  assert.deepEqual(item.platformTargets, ['facebook'], 'the platform set is immutable during a copy edit');
  assert.equal(item.targetAccounts.length, 1, 'still exactly one account');
  assert.equal(item.targetAccounts[0].accountName, 'NYC Waterproofing');
  assert.ok(fbId);
});

// ------------------------------------------------------------ account identity
test('the plan exposes the target account name for each item', async () => {
  const { agent, run } = await setup();
  const plan = await agent.get(`/api/planner/plans/${run.id}`);
  for (const item of plan.body.data.items) {
    assert.deepEqual(item.targetAccounts, [{ platform: 'facebook', accountName: 'NYC Waterproofing' }],
      'every card must know the Page it is aimed at');
  }
});

test('the account payload carries no id, token, username or provider id', async () => {
  const { agent, run } = await setup();
  const plan = await agent.get(`/api/planner/plans/${run.id}`);
  const serialised = JSON.stringify(plan.body.data.items.map((i) => i.targetAccounts));

  assert.ok(!serialised.includes('super-secret-page-token'), 'no access token');
  assert.ok(!serialised.includes('nycwaterproofing-private-handle'), 'no non-user-facing username');
  assert.ok(!serialised.includes('fb-page-99'), 'no provider account id');
  for (const entry of plan.body.data.items.flatMap((i) => i.targetAccounts)) {
    assert.deepEqual(Object.keys(entry).sort(), ['accountName', 'platform'],
      'the shape is fixed: platform and display name only');
  }
});

test('another user cannot see this account through a plan', async () => {
  const { july26 } = await setup();
  const { app: otherApp } = makeApp();
  const { agent: other } = await registerUser(otherApp, defaultCreds({ email: 'other@example.com', name: 'Other' }));
  const plans = await other.get('/api/planner/plans');
  const serialised = JSON.stringify(plans.body);
  assert.ok(!serialised.includes('NYC Waterproofing'), "another user's account must not leak");
  assert.ok(july26);
});

test('the board and the drawer render platform and account the same way', () => {
  const card = read('public', 'assets', 'js', 'components', 'plannerCard.js');
  const week = read('public', 'assets', 'js', 'pages', 'plannerWeek.js');

  assert.match(card, /export function platformTargetLabel/);
  assert.match(card, /\$\{label\} · \$\{match\.accountName\}/,
    'the label must join platform and account with a separator');
  assert.match(card, /const platforms = platformTargetLabel\(item\)/, 'the card uses it');
  assert.match(week, /platformTargetLabel\(item\)/, 'the drawer uses the same one');
  // Falls back to the platform alone rather than inventing a name.
  assert.match(card, /return match \? .* : label;/);
});

// ------------------------------------------------------------------ plan range
test('the plan range is derived from the item dates, not the null columns', async () => {
  const { agent, run } = await setup();
  const plan = await agent.get(`/api/planner/plans/${run.id}`);

  // The run was stored with null start/end — an automation creates it before any
  // content exists. The range must come from the items themselves.
  assert.equal(plan.body.data.run.startDate, '2026-07-19');
  assert.equal(plan.body.data.run.endDate, '2026-07-26');
});

test('a plan with no items reports null dates, never the string null', async () => {
  const { app, overrides } = makeApp();
  const { agent } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const run = await overrides.plannerRunRepository.createRun({
    userId: String(me.body.data.user.id), status: 'review', timezone: 'UTC',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  const plan = await agent.get(`/api/planner/plans/${run.id}`);
  assert.equal(plan.body.data.run.startDate, null, 'null, not "null"');
  assert.equal(plan.body.data.run.endDate, null);
  assert.notEqual(plan.body.data.run.startDate, 'null');
});

test('the header never renders a literal null', () => {
  const week = read('public', 'assets', 'js', 'pages', 'plannerWeek.js');
  // The old line interpolated run.startDate and run.endDate straight into the
  // string, which is how "null to null" reached the screen.
  assert.doesNotMatch(week, /\$\{plan\.run\.startDate\} to \$\{plan\.run\.endDate\}/,
    'dates must not be interpolated raw');
  assert.match(week, /function planRangeLabel\(plan\)/);
  assert.match(week, /return 'Schedule not prepared';/,
    'a plan with no dates needs a sentence, not an empty gap');
  assert.match(week, /planRangeLabel\(plan\)/, 'the header must use the guard');
});

// ------------------------------------------------------------------ invariants
test('editing makes zero provider calls and live publishing stays off', async () => {
  const { agent, csrf, july26, overrides } = await setup();
  let providerCalls = 0;
  for (const value of Object.values(overrides)) {
    if (value && typeof value.publish === 'function') {
      const original = value.publish.bind(value);
      value.publish = async (...args) => { providerCalls += 1; return original(...args); };
    }
  }
  const res = await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());
  assert.equal(res.status, 200);
  assert.equal(providerCalls, 0, 'editing copy must never contact a provider');
  assert.notEqual(process.env.ENABLE_LIVE_PROVIDER_PUBLISHING, 'true');
});

test('no post copy, hashtag or token is written to the error log', async () => {
  const { agent, csrf, overrides, july26 } = await setup();
  const runs = overrides.plannerRunRepository;
  const original = runs.updateItem.bind(runs);
  const lines = [];
  const realWarn = console.warn; const realError = console.error;
  console.warn = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  runs.updateItem = async (itemId, userId) => original(itemId, userId, {});
  try {
    await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(editPayload());
    const text = lines.join('\n');
    assert.ok(!text.includes(NEW_COPY), 'post copy must never be logged');
    assert.ok(!text.includes('#waterproofing'), 'hashtags must never be logged');
    assert.ok(!text.includes('super-secret-page-token'), 'a token must never be logged');
    assert.ok(!/at .*plannerService\.js:\d+/.test(text), 'no stack trace');
  } finally {
    runs.updateItem = original;
    console.warn = realWarn; console.error = realError;
  }
});

test('update and revision are written in one transaction', () => {
  const service = read('src', 'services', 'plannerService.js');
  const body = service.slice(service.indexOf('async function updateItem(userId, itemId'));
  const save = body.slice(0, body.indexOf('async function getItemRevisions'));

  assert.match(save, /const updated = await withTransaction\(async \(conn\) => \{/,
    'the row and its revisions must share a transaction');
  assert.match(save, /runsRepo\.updateItem\(itemId, userId, fields, conn\)/,
    'the update must run on the transaction connection');
  assert.match(save, /revisionsRepo\.recordRevision\([\s\S]*?\}, conn\)/,
    'the revision must run on the same connection');
  // It used to swallow revision failures entirely.
  assert.doesNotMatch(save, /recordRevision\([\s\S]{0,400}\)\.catch\(\(\) => \{\}\)/,
    'a revision failure must not be silently discarded');
  assert.match(save, /verifyPersisted\(saved, fields\)/,
    'success must be confirmed against persisted state');
});

test('no migration was added or modified', () => {
  const files = readdirSync(path.join(ROOT, 'database', 'migrations')).filter((f) => f.endsWith('.sql'));
  assert.equal(files.some((f) => f.startsWith('018')), false, 'no migration 018 may be introduced');
  assert.ok(files.includes('017_user_data_export_and_deletion.sql'), '017 must still be the last migration');
});
