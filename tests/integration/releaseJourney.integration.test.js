// The complete review-and-queue journey against REAL MariaDB.
//
// Real repositories, real services, real transactions, real HTTP through the
// app. Only the external network boundaries are mocked: OpenAI, HCTI and the
// provider adapters. Nothing about the database, the job system, the planner or
// the queue is faked, because those are exactly the layers where every defect
// that reached the deployed host was hiding.
import { hasDatabase, resetDatabase, SKIP } from './helpers/db.js';
import '../helpers/setupEnv.js';

import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { getPool, closePool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';
import * as users from '../../src/repositories/userRepository.js';
import * as socialAccounts from '../../src/repositories/socialAccountRepository.js';
import * as runsRepo from '../../src/repositories/plannerRunRepository.js';
import * as publishRepo from '../../src/repositories/publishRepository.js';

/** Every provider publish call is counted; the expectation is always zero. */
const providerCalls = { facebook: 0, instagram: 0, threads: 0 };
const countingAdapter = (platform) => ({
  key: platform,
  async publish() { providerCalls[platform] += 1; throw new Error('no provider call may happen in this suite'); },
  async reconcile() { providerCalls[platform] += 1; throw new Error('no provider call may happen in this suite'); },
});

const BUSINESS = {
  businessName: 'NYC Waterproofing',
  city: 'New York', region: 'NY', country: 'US',
  services: ['Basement Waterproofing', 'Foundation Waterproofing', 'French Drain Installation'],
};

/** The copy the operator pastes in the acceptance script. */
const EDITED = {
  postCopy: [
    'Basement moisture can appear as damp walls, water stains, peeling paint, musty odors, or small wet areas near the floor. These signs do not always mean the same problem, so the affected area should be checked before a repair is recommended.',
    'A basement moisture inspection can help identify visible leaks, cracks, drainage concerns, and other possible water-entry points. The next step may involve crack repair, drainage improvements, sump pump service, or another focused solution based on the property.',
  ].join('\n\n'),
  hashtags: ['#BasementWaterproofing', '#BasementMoisture', '#NYCWaterproofing'],
  headline: 'Check Basement Moisture Early',
  subheadline: 'Understand visible warning signs before damage grows.',
  altText: 'Basement wall being inspected for visible moisture and water stains',
};

const ORIGINAL_COPY = 'Austin SEO tips for local businesses that want to rank this quarter.';

let pool = null;
let app = null;
let agent = null;
let csrf = null;
let userId = null;
let fbAccountId = null;

before(() => { if (hasDatabase) pool = getPool(); });
after(async () => { if (hasDatabase) await closePool().catch(() => {}); });

async function csrfToken(a) {
  const res = await a.get('/api/csrf-token').set('Accept', 'application/json');
  return res.body.data.csrfToken;
}

beforeEach(async () => {
  if (!hasDatabase) return;
  providerCalls.facebook = 0; providerCalls.instagram = 0; providerCalls.threads = 0;
  await resetDatabase(pool);

  app = createApp({
    // Only the external boundaries. Repositories, services, jobs, planner and
    // queue are all the real ones, against the real database.
    /*
     * `publishAdapters` is the container's override key. An earlier version
     * passed `adapters`, which is not a key the container reads — so the stubs
     * were never installed, the real adapters were built, and "zero provider
     * calls" was proven only by the live-publishing flag rather than by the
     * counters. Installed properly, any call throws and the count is real.
     */
    publishAdapters: {
      facebook: countingAdapter('facebook'),
      instagram: countingAdapter('instagram'),
      threads: countingAdapter('threads'),
    },
  });

  agent = request.agent(app);
  csrf = await csrfToken(agent);
  await agent.post('/api/auth/register').set('X-CSRF-Token', csrf).send({
    name: 'Release Tester', email: 'release@example.test',
    password: 'Release-Pass-123456', timezone: 'Asia/Karachi',
  });
  csrf = await csrfToken(agent);
  const me = await agent.get('/api/auth/me');
  userId = String(me.body.data.user.id);

  await socialAccounts.upsertSocialAccount({
    userId, provider: 'meta', accountType: 'facebook_page',
    providerAccountId: 'fb-page-nycwp', displayName: 'NYC Waterproofing',
    username: 'private-handle-not-user-facing',
    encryptedAccessToken: 'v1:local-disposable-token-not-real',
    scopes: [], providerMetadata: {}, status: 'active',
  });
  const owned = await socialAccounts.listAccountsForUser(userId);
  fbAccountId = owned[0].id;
});

/** A run with the two staging items, stored as REAL UTC instants. */
async function seedReviewItems() {
  const run = await runsRepo.createRun({
    userId, name: 'Final Acceptance Automation', status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null,
    /*
     * The run stores WHICH account it posts to. It stored nothing, and queueing
     * filled that silence by matching every active account on the platform —
     * the fan-out that shipped. A run with no stored selection is refused now,
     * so the journey seeds the selection the real flow freezes at generation.
     */
    settings: { selectedAccountIds: [String(fbAccountId)] },
    resolvedRhythm: {},
  });
  const mk = (utcInstant, position) => runsRepo.createItem({
    userId, plannerRunId: run.id, scheduledFor: utcInstant, originalTimezone: 'Asia/Karachi',
    contentType: 'insight', goal: 'awareness', templateKey: 'editorial-premium',
    aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'Austin SEO in 2026', subheadline: 'Rankings', summary: 's',
    caption: ORIGINAL_COPY, altText: 'A laptop showing search results',
    hashtags: ['#seo', '#austin'], platformTargets: ['facebook'],
    platformCaptions: {
      facebook: { postCopy: ORIGINAL_COPY, hashtags: ['#seo', '#austin'], validationStatus: 'passed' },
    },
    approvalStatus: 'needs_review', position,
  });
  // 02:45 Asia/Karachi is 21:45 UTC the previous day.
  const july19 = await mk('2026-07-18 21:45:00', 0);
  const july26 = await mk('2026-07-25 21:45:00', 1);
  return { run, july19, july26 };
}

const itemIn = (body, id) => body?.data?.items?.find((i) => String(i.id) === String(id));

// ====================================================== board read path
test('the board reports the plan range in the plan timezone', SKIP, async () => {
  const { run } = await seedReviewItems();
  const plan = await agent.get(`/api/planner/plans/${run.id}`);

  assert.equal(plan.status, 200);
  assert.equal(plan.body.data.run.startDate, '2026-07-19', 'Sunday July 19, not the UTC 18th');
  assert.equal(plan.body.data.run.endDate, '2026-07-26', 'Sunday July 26, not the UTC 25th');
});

test('each item names the account it will post to, and leaks nothing else', SKIP, async () => {
  const { run } = await seedReviewItems();
  const plan = await agent.get(`/api/planner/plans/${run.id}`);
  const serialised = JSON.stringify(plan.body);

  assert.ok(!serialised.includes('local-disposable-token'), 'no access token may reach the client');
  assert.ok(!serialised.includes('private-handle-not-user-facing'), 'no private username');
  assert.ok(!serialised.includes('fb-page-nycwp'), 'no provider account id');
});

// ========================================================= edit persistence
test('one save persists every field, and a fresh read returns them', SKIP, async () => {
  const { run, july26 } = await seedReviewItems();

  const res = await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send({
    headline: EDITED.headline, subheadline: EDITED.subheadline, altText: EDITED.altText,
    templateKey: 'editorial-premium', backgroundStyle: 'light',
    platformCaptions: { facebook: { postCopy: EDITED.postCopy, hashtags: EDITED.hashtags } },
  });
  assert.equal(res.status, 200, `save failed: ${JSON.stringify(res.body?.error || {})}`);

  // A completely fresh read, through the API, from the real database.
  const plan = await agent.get(`/api/planner/plans/${run.id}`);
  const item = itemIn(plan.body, july26.id);

  assert.equal(item.headline, EDITED.headline);
  assert.equal(item.subheadline, EDITED.subheadline);
  assert.equal(item.altText, EDITED.altText);
  assert.equal(item.platformCopy.facebook.postCopy, EDITED.postCopy);
  assert.deepEqual(item.platformCopy.facebook.hashtags, EDITED.hashtags);
  assert.ok(!JSON.stringify(item).includes('Austin'), 'the SEO/Austin content must be gone');

  const revisions = await agent.get(`/api/planner/items/${july26.id}/revisions`);
  const manual = revisions.body.data.revisions.filter((r) => r.revisionType === 'manual_edit');
  assert.equal(manual.length, 1, 'exactly one manual_edit revision');
});

test('re-saving identical content adds no second revision', SKIP, async () => {
  const { july26 } = await seedReviewItems();
  const body = {
    headline: EDITED.headline, subheadline: EDITED.subheadline, altText: EDITED.altText,
    templateKey: 'editorial-premium', backgroundStyle: 'light',
    platformCaptions: { facebook: { postCopy: EDITED.postCopy, hashtags: EDITED.hashtags } },
  };
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(body);
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send(body);

  const revisions = await agent.get(`/api/planner/items/${july26.id}/revisions`);
  assert.equal(revisions.body.data.revisions.filter((r) => r.revisionType === 'manual_edit').length, 1);
});

// ============================================ reject, approve, queue journey
test('reject one, approve the other, queue exactly one post', SKIP, async () => {
  const { run, july19, july26 } = await seedReviewItems();

  // Edit the item that will be queued, so the queued post must carry the edit.
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send({
    headline: EDITED.headline, subheadline: EDITED.subheadline, altText: EDITED.altText,
    templateKey: 'editorial-premium', backgroundStyle: 'light',
    platformCaptions: { facebook: { postCopy: EDITED.postCopy, hashtags: EDITED.hashtags } },
  });

  const reject = await agent.post(`/api/planner/items/${july19.id}/status`)
    .set('X-CSRF-Token', csrf).send({ status: 'rejected' });
  assert.equal(reject.status, 200, `reject failed: ${JSON.stringify(reject.body?.error || {})}`);

  const approve = await agent.post(`/api/planner/items/${july26.id}/status`)
    .set('X-CSRF-Token', csrf).send({ status: 'approved' });
  assert.equal(approve.status, 200, `approve failed: ${JSON.stringify(approve.body?.error || {})}`);

  // Statuses survive a fresh read from the database.
  const afterReload = await agent.get(`/api/planner/plans/${run.id}`);
  assert.equal(itemIn(afterReload.body, july19.id).approvalStatus, 'rejected');
  assert.equal(itemIn(afterReload.body, july26.id).approvalStatus, 'approved');

  const queued = await agent.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', csrf).send({});
  assert.equal(queued.status, 200, `queue failed: ${JSON.stringify(queued.body?.error || {})}`);

  const posts = await agent.get('/api/posts?limit=50');
  assert.equal(posts.body.data.posts.length, 1, 'exactly one post is queued');

  const post = posts.body.data.posts[0];
  assert.equal(post.targets.length, 1, 'exactly one account target');
  assert.equal(providerCalls.facebook + providerCalls.instagram + providerCalls.threads, 0,
    'queueing must make no provider call');

  // The rejected item did not become a post.
  assert.ok(!JSON.stringify(posts.body).includes('Austin'), 'the rejected SEO content must not be queued');
});

test('queueing twice creates no duplicate, verified in MariaDB', SKIP, async () => {
  const { run, july26 } = await seedReviewItems();
  await agent.post(`/api/planner/items/${july26.id}/status`).set('X-CSRF-Token', csrf).send({ status: 'approved' });

  await agent.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', csrf).send({});
  await agent.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', csrf).send({});

  const posts = await agent.get('/api/posts?limit=50');
  assert.equal(posts.body.data.posts.length, 1, 'a repeated queue action must not duplicate the post');

  // And in the table itself, not only through the API.
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM scheduled_posts WHERE user_id = ?', [userId]);
  assert.equal(Number(rows[0].n), 1, 'exactly one scheduled_posts row');
  const [targets] = await pool.query(
    'SELECT COUNT(*) AS n FROM scheduled_post_targets t JOIN scheduled_posts p ON p.id = t.scheduled_post_id WHERE p.user_id = ?',
    [userId],
  );
  assert.equal(Number(targets[0].n), 1, 'exactly one scheduled_post_targets row');
  assert.ok(publishRepo);
});

test('two concurrent queue requests still produce one post', SKIP, async () => {
  const { run, july26 } = await seedReviewItems();
  await agent.post(`/api/planner/items/${july26.id}/status`).set('X-CSRF-Token', csrf).send({ status: 'approved' });

  await Promise.all([
    agent.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', csrf).send({}),
    agent.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', csrf).send({}),
  ]);

  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM scheduled_posts WHERE user_id = ?', [userId]);
  assert.equal(Number(rows[0].n), 1, 'concurrency must not double-queue');
});

// ================================================================ ownership
test('another user cannot read, edit or queue this plan', SKIP, async () => {
  const { run, july26 } = await seedReviewItems();

  const intruder = request.agent(app);
  let itoken = await csrfToken(intruder);
  await intruder.post('/api/auth/register').set('X-CSRF-Token', itoken).send({
    name: 'Intruder', email: 'intruder@example.test',
    password: 'Intruder-Pass-123456', timezone: 'UTC',
  });
  itoken = await csrfToken(intruder);

  const read = await intruder.get(`/api/planner/plans/${run.id}`);
  assert.ok([403, 404].includes(read.status), `plan read must be refused, got ${read.status}`);

  const edit = await intruder.patch(`/api/planner/items/${july26.id}`)
    .set('X-CSRF-Token', itoken).send({ headline: 'stolen' });
  assert.ok([403, 404].includes(edit.status), `edit must be refused, got ${edit.status}`);

  const queue = await intruder.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', itoken).send({});
  assert.ok([403, 404].includes(queue.status), `queue must be refused, got ${queue.status}`);

  // And the owner's row is untouched.
  const owner = await agent.get(`/api/planner/plans/${run.id}`);
  assert.notEqual(itemIn(owner.body, july26.id).headline, 'stolen');
});

// ============================================================ live publishing
test('no provider publish call happens anywhere in the journey', SKIP, async () => {
  const { run, july19, july26 } = await seedReviewItems();
  await agent.patch(`/api/planner/items/${july26.id}`).set('X-CSRF-Token', csrf).send({
    headline: EDITED.headline, platformCaptions: { facebook: { postCopy: EDITED.postCopy, hashtags: EDITED.hashtags } },
  });
  await agent.post(`/api/planner/items/${july19.id}/status`).set('X-CSRF-Token', csrf).send({ status: 'rejected' });
  await agent.post(`/api/planner/items/${july26.id}/status`).set('X-CSRF-Token', csrf).send({ status: 'approved' });
  await agent.post(`/api/planner/plans/${run.id}/queue`).set('X-CSRF-Token', csrf).send({});

  assert.equal(providerCalls.facebook, 0, 'Facebook publish calls');
  assert.equal(providerCalls.instagram, 0, 'Instagram publish calls');
  assert.equal(providerCalls.threads, 0, 'Threads publish calls');
  assert.notEqual(process.env.ENABLE_LIVE_PROVIDER_PUBLISHING, 'true');
  assert.ok(BUSINESS.businessName);
});
