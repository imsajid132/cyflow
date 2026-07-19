// The release regression: an automation configured for ONE Facebook Page
// queued a post with SEVEN targets, one for every Page the user had connected.
//
// The reproduction is the operator's exactly: seven active Facebook accounts,
// an automation naming only "NYC Waterproofing", one approved item, one Queue
// click. The board showed the right Page throughout, which is what made the
// defect survive review — the surface that was supposed to reveal it agreed
// with the automation while queueing quietly did something else.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeApp, registerUser, defaultCreds } from './helpers/apiHarness.js';

// The operator's list, in their order. The first is the one that was chosen.
const PAGES = [
  'NYC Waterproofing',
  'Sidewalks Repair NYC',
  'Pioneer Construction NYC',
  'NYC Concrete Contractor',
  'Roofing Contractor NYC',
  'Brick Pointing NYC',
  'Brownstone Repair NYC',
];
const CHOSEN = PAGES[0];

async function sevenPages({ withAutomation = true, chosen = [CHOSEN] } = {}) {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const userId = String(me.body.data.user.id);

  for (const [i, displayName] of PAGES.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await overrides.socialAccountRepository.upsertSocialAccount({
      userId, provider: 'meta', accountType: 'facebook_page',
      providerAccountId: `fb-page-${i}`, displayName,
      username: `handle-${i}`, encryptedAccessToken: `v1:token-${i}`,
      scopes: [], providerMetadata: {}, status: 'active',
    });
  }
  const accounts = await overrides.socialAccountRepository.listAccountsForUser(userId);
  assert.equal(accounts.length, 7, 'the reproduction needs all seven active');
  const idOf = (name) => accounts.find((a) => a.displayName === name).id;
  const chosenIds = chosen.map(idOf);

  let automationId = null;
  if (withAutomation) {
    const created = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send({
      name: 'NYC Waterproofing Test', mode: 'review', timezone: 'Asia/Karachi',
      selectedWeekdays: [7], postingTimes: ['02:45'], postsPerDay: 1, rhythmKey: 'balanced',
      selectedPlatforms: ['facebook'], selectedAccountIds: chosenIds,
      missedPostPolicy: 'skip', generationHorizonDays: 3, minimumReadyDays: 2, lowBufferDays: 1,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body?.error || {}));
    automationId = created.body.data.automation.id;
  }

  const runs = overrides.plannerRunRepository;
  const run = await runs.createRun({
    userId, contentAutomationId: automationId, name: 'NYC Waterproofing Test',
    status: 'review', timezone: 'Asia/Karachi', startDate: null, endDate: null,
    settings: withAutomation ? {} : { selectedAccountIds: chosenIds.map(String) },
    resolvedRhythm: {},
  });

  const item = await runs.createItem({
    userId, plannerRunId: run.id, scheduledFor: '2027-03-14 02:45:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'Waterproofing that lasts', subheadline: 'Exterior excavation, done once',
    summary: 'waterproofing', caption: 'Basement leaking? Our crew waterproofs New York homes.',
    altText: 'A waterproofed foundation wall', hashtags: ['#waterproofing'],
    platformTargets: ['facebook'],
    platformCaptions: {
      facebook: { postCopy: 'Basement leaking? Our crew waterproofs New York homes.', hashtags: ['#waterproofing'], validationStatus: 'passed' },
    },
    approvalStatus: 'approved', position: 0,
  });

  return { app, agent, csrf, overrides, userId, run, item, accounts, chosenIds };
}

const queue = (agent, csrf, runId) =>
  agent.post(`/api/planner/plans/${runId}/queue`).set('X-CSRF-Token', csrf).send({ itemIds: [] });

const targetsOf = async (overrides, postId, userId) => {
  const rows = await overrides.postRepository.listPostTargets(postId, userId);
  return rows || [];
};

// ------------------------------------------------------------- the regression
test('one selected account produces exactly one scheduled target, not seven', async () => {
  const { agent, csrf, overrides, userId, run } = await sevenPages();

  const res = await queue(agent, csrf, run.id);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error || {}));
  assert.equal(res.body.data.queued.length, 1, 'exactly one scheduled post');

  const postId = res.body.data.queued[0].postId;
  const targets = await targetsOf(overrides, postId, userId);

  assert.equal(targets.length, 1, `expected 1 target, got ${targets.length}`);

  const accounts = await overrides.socialAccountRepository.listAccountsForUser(userId);
  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  assert.equal(byId.get(String(targets[0].socialAccountId)).displayName, CHOSEN);
});

test('not one of the six unselected Pages is attached', async () => {
  const { agent, csrf, overrides, userId, run } = await sevenPages();
  const res = await queue(agent, csrf, run.id);

  const targets = await targetsOf(overrides, res.body.data.queued[0].postId, userId);
  const accounts = await overrides.socialAccountRepository.listAccountsForUser(userId);
  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  const attached = targets.map((t) => byId.get(String(t.socialAccountId)).displayName);

  for (const page of PAGES.slice(1)) {
    assert.ok(!attached.includes(page), `${page} was never selected and must not be attached`);
  }
  assert.deepEqual(attached, [CHOSEN]);
});

test('two selected accounts produce exactly those two', async () => {
  // The fix must not collapse to "one target"; it must honour the selection.
  const chosen = [PAGES[0], PAGES[3]];
  const { agent, csrf, overrides, userId, run } = await sevenPages({ chosen });
  const res = await queue(agent, csrf, run.id);

  const targets = await targetsOf(overrides, res.body.data.queued[0].postId, userId);
  const accounts = await overrides.socialAccountRepository.listAccountsForUser(userId);
  const byId = new Map(accounts.map((a) => [String(a.id), a]));

  assert.deepEqual(targets.map((t) => byId.get(String(t.socialAccountId)).displayName).sort(), [...chosen].sort());
});

test('the board shows the same one account the queue attaches', async () => {
  /*
   * The two surfaces disagreeing is what let this ship. They are asserted
   * together, from one plan read and one queue call, so they cannot drift apart
   * again without this failing.
   */
  const { agent, csrf, overrides, userId, run } = await sevenPages();

  const plan = await agent.get(`/api/planner/plans/${run.id}`);
  const shown = plan.body.data.items[0].targetAccounts;
  assert.deepEqual(shown, [{ platform: 'facebook', accountName: CHOSEN }]);

  const res = await queue(agent, csrf, run.id);
  const targets = await targetsOf(overrides, res.body.data.queued[0].postId, userId);
  const accounts = await overrides.socialAccountRepository.listAccountsForUser(userId);
  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  const attached = targets.map((t) => byId.get(String(t.socialAccountId)).displayName);

  assert.deepEqual(attached, shown.map((s) => s.accountName), 'the board and the queue must agree');
});

// ------------------------------------------------------------------ idempotency
test('queueing twice creates no second post and no second target', async () => {
  const { agent, csrf, overrides, userId, run } = await sevenPages();

  const first = await queue(agent, csrf, run.id);
  assert.equal(first.body.data.queued.length, 1);
  const postId = first.body.data.queued[0].postId;

  const second = await queue(agent, csrf, run.id);
  // Nothing is left approved, so the second call has nothing to do.
  assert.ok(second.status === 400 || (second.body?.data?.queued || []).length === 0,
    'the second call must queue nothing');

  const targets = await targetsOf(overrides, postId, userId);
  assert.equal(targets.length, 1, 'still exactly one target after a repeat');
});

test('concurrent queue clicks still produce one post with one target', async () => {
  const { agent, csrf, overrides, userId, run } = await sevenPages();

  const [a, b] = await Promise.all([queue(agent, csrf, run.id), queue(agent, csrf, run.id)]);
  const queued = [...(a.body?.data?.queued || []), ...(b.body?.data?.queued || [])];
  assert.equal(queued.length, 1, 'exactly one of the two requests may win');

  const targets = await targetsOf(overrides, queued[0].postId, userId);
  assert.equal(targets.length, 1);
});

// ------------------------------------------------------- unavailable + blocked
test('a disconnected selected account blocks the queue rather than falling back', async () => {
  /*
   * The dangerous shape. The one chosen Page is revoked while six others stay
   * active — precisely the case where "just use what works" would have posted
   * to six businesses that never agreed to it.
   */
  const { agent, csrf, overrides, userId, run, chosenIds } = await sevenPages();
  await overrides.socialAccountRepository.markAccountRevoked(chosenIds[0], userId, { eraseTokens: false });

  const res = await queue(agent, csrf, run.id);
  const queued = res.body?.data?.queued || [];
  assert.equal(queued.length, 0, 'nothing may be queued');

  const skipped = res.body?.data?.skipped || [];
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /unavailable/i);

  const plan = await agent.get(`/api/planner/plans/${run.id}`);
  assert.equal(plan.body.data.items[0].targetsUnavailable, true, 'the board must say so too');
});

test('a manual plan with no stored selection is refused, not broadcast', async () => {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const userId = String(me.body.data.user.id);

  for (const [i, displayName] of PAGES.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await overrides.socialAccountRepository.upsertSocialAccount({
      userId, provider: 'meta', accountType: 'facebook_page',
      providerAccountId: `fb-legacy-${i}`, displayName, username: `h${i}`,
      encryptedAccessToken: 'v1:tok', scopes: [], providerMetadata: {}, status: 'active',
    });
  }

  const runs = overrides.plannerRunRepository;
  const run = await runs.createRun({
    userId, contentAutomationId: null, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  await runs.createItem({
    userId, plannerRunId: run.id, scheduledFor: '2027-03-14 02:45:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'h', subheadline: 's', summary: 's', caption: 'c', altText: 'a',
    hashtags: [], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'c', hashtags: [], validationStatus: 'passed' } },
    approvalStatus: 'approved', position: 0,
  });

  const res = await agent.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', csrf).send({ itemIds: [] });
  assert.equal((res.body?.data?.queued || []).length, 0, 'seven accounts, no selection, nothing queued');
  assert.match((res.body?.data?.skipped || [])[0].reason, /no saved account selection/i);
});

// -------------------------------------------------------------------- ownership
test('another user\'s account id in a selection resolves to nothing', async () => {
  const { app: appA, overrides } = makeApp();
  const { agent: agentA } = await registerUser(appA);
  const meA = await agentA.get('/api/auth/me');
  const userA = String(meA.body.data.user.id);

  const { app: appB } = makeApp({ overrides });
  const { agent: agentB, csrf: csrfB } = await registerUser(appB, defaultCreds({ email: 'b@example.com', name: 'B' }));
  const meB = await agentB.get('/api/auth/me');
  const userB = String(meB.body.data.user.id);

  await overrides.socialAccountRepository.upsertSocialAccount({
    userId: userA, provider: 'meta', accountType: 'facebook_page',
    providerAccountId: 'fb-owned-by-a', displayName: 'A Page', username: 'a',
    encryptedAccessToken: 'v1:tok', scopes: [], providerMetadata: {}, status: 'active',
  });
  const aAccounts = await overrides.socialAccountRepository.listAccountsForUser(userA);

  const runs = overrides.plannerRunRepository;
  // B's run naming A's account. A stored id is not a permission.
  const run = await runs.createRun({
    userId: userB, contentAutomationId: null, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null,
    settings: { selectedAccountIds: [String(aAccounts[0].id)] }, resolvedRhythm: {},
  });
  await runs.createItem({
    userId: userB, plannerRunId: run.id, scheduledFor: '2027-03-14 02:45:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'h', subheadline: 's', summary: 's', caption: 'c', altText: 'a',
    hashtags: [], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'c', hashtags: [], validationStatus: 'passed' } },
    approvalStatus: 'approved', position: 0,
  });

  const res = await agentB.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', csrfB).send({ itemIds: [] });
  assert.equal((res.body?.data?.queued || []).length, 0, 'B may not post to A\'s Page');
});

// ------------------------------------------------------- generation-time choice
test('generating with several accounts on a platform demands an explicit choice', async () => {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const userId = String(me.body.data.user.id);

  for (const [i, displayName] of PAGES.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await overrides.socialAccountRepository.upsertSocialAccount({
      userId, provider: 'meta', accountType: 'facebook_page',
      providerAccountId: `fb-gen-${i}`, displayName, username: `h${i}`,
      encryptedAccessToken: 'v1:tok', scopes: [], providerMetadata: {}, status: 'active',
    });
  }

  const res = await agent.post('/api/planner/plans').set('X-CSRF-Token', csrf).send({
    platforms: ['facebook'], planLength: 7, postsPerDay: 1, timezone: 'Asia/Karachi',
  });

  assert.equal(res.status, 400, 'ambiguity must be refused, not resolved by broadcasting');
  assert.match(JSON.stringify(res.body?.error || {}), /which/i);
});
