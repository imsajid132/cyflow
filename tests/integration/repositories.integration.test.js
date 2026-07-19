// Repository behaviour against a REAL MariaDB.
//
// Every defect that reached the deployed host in this project was invisible to
// the in-memory fakes and obvious to a real database: MySQL-only `CAST(? AS
// JSON)` that MariaDB rejects at parse time, an UPDATE whose affectedRows
// nobody checked, a transaction that was never a transaction. These tests
// exercise the actual SQL.
import { hasDatabase, resetDatabase, SKIP } from './helpers/db.js';
import '../helpers/setupEnv.js';

import test, { before, beforeEach, after } from 'node:test';   // eslint-disable-line import/first
import assert from 'node:assert/strict';                        // eslint-disable-line import/first

import { getPool, closePool } from '../../src/db/pool.js';       // eslint-disable-line import/first
import { withTransaction } from '../../src/db/transactions.js';  // eslint-disable-line import/first
import * as users from '../../src/repositories/userRepository.js';           // eslint-disable-line import/first
import * as socialAccounts from '../../src/repositories/socialAccountRepository.js'; // eslint-disable-line import/first
import * as automations from '../../src/repositories/automationRepository.js';       // eslint-disable-line import/first
import * as runs from '../../src/repositories/plannerRunRepository.js';              // eslint-disable-line import/first
import * as revisions from '../../src/repositories/plannerRevisionRepository.js';    // eslint-disable-line import/first
import * as jobs from '../../src/repositories/backgroundJobRepository.js';           // eslint-disable-line import/first

let pool = null;
let userId = null;
let otherUserId = null;

before(async () => {
  if (!hasDatabase) return;
  pool = getPool();
});
after(async () => { if (hasDatabase) await closePool().catch(() => {}); });

beforeEach(async () => {
  if (!hasDatabase) return;
  await resetDatabase(pool);
  const a = await users.createUser({
    name: 'Release Tester', email: 'release@example.test',
    passwordHash: 'x'.repeat(60), timezone: 'Asia/Karachi',
  });
  const b = await users.createUser({
    name: 'Other Tester', email: 'other@example.test',
    passwordHash: 'x'.repeat(60), timezone: 'UTC',
  });
  userId = String(a.id);
  otherUserId = String(b.id);
});

const fbAccount = async (owner = userId, displayName = 'NYC Waterproofing') => {
  await socialAccounts.upsertSocialAccount({
    userId: owner, provider: 'meta', accountType: 'facebook_page',
    providerAccountId: `fb-${owner}-${displayName.replace(/\W/g, '')}`,
    displayName, username: 'private-handle',
    encryptedAccessToken: 'v1:local-test-token-not-real', scopes: [],
    providerMetadata: { note: 'disposable test fixture' }, status: 'active',
  });
  const owned = await socialAccounts.listAccountsForUser(owner);
  return owned.find((x) => x.displayName === displayName);
};

// ===================================================================== JSON
test('automation JSON columns round-trip through MariaDB', SKIP, async () => {
  const account = await fbAccount();
  const created = await automations.createAutomation({
    userId, name: 'Final Acceptance Automation', status: 'draft', mode: 'review',
    timezone: 'Asia/Karachi', selectedWeekdays: [7], postingTimes: ['02:45'],
    postsPerDay: 1, rhythmKey: 'balanced', selectedPlatforms: ['facebook'],
    selectedAccountIds: [String(account.id)],
    startDate: null, endDate: null,
    generationHorizonDays: 3, minimumReadyDays: 2, lowBufferDays: 1,
    missedPostPolicy: 'skip', failurePolicy: 'pause',
    configSnapshot: { platforms: ['facebook'], accountIds: [String(account.id)], timezone: 'Asia/Karachi' },
  });

  // This is the statement that failed on the deployed host. MariaDB stores JSON
  // as LONGTEXT and returns a STRING where MySQL returns a parsed object, so a
  // repository that only ever ran against fakes could be wrong in both
  // directions at once.
  assert.ok(created?.id, 'the automation must be created');
  assert.deepEqual(created.selectedWeekdays, [7], 'array survives the round trip');
  assert.deepEqual(created.postingTimes, ['02:45']);
  assert.deepEqual(created.selectedPlatforms, ['facebook']);
  assert.deepEqual(created.selectedAccountIds, [String(account.id)]);
  assert.equal(typeof created.selectedWeekdays, 'object', 'must be parsed, not a raw string');

  const reread = await automations.findAutomationByIdForUser(created.id, userId);
  assert.deepEqual(reread.selectedAccountIds, [String(account.id)], 'and again on a fresh read');
  assert.equal(reread.timezone, 'Asia/Karachi');
  assert.equal(reread.generationHorizonDays, 3);
  assert.equal(reread.minimumReadyDays, 2);
  assert.equal(reread.lowBufferDays, 1);
});

test('planner item JSON columns round-trip, including nested platform copy', SKIP, async () => {
  const run = await runs.createRun({
    userId, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: { a: 1 }, resolvedRhythm: { b: 2 },
  });
  const item = await runs.createItem({
    userId, plannerRunId: run.id, scheduledFor: '2026-07-18 21:45:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'Check Basement Moisture Early', subheadline: 'Warning signs',
    summary: 's', caption: 'original', altText: 'alt',
    hashtags: ['#one', '#two'], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'original', hashtags: ['#one'], validationStatus: 'passed' } },
    approvalStatus: 'needs_review', position: 0,
  });
  const back = await runs.findItemByIdForUser(item.id, userId);
  assert.deepEqual(back.platformTargets, ['facebook']);
  assert.deepEqual(back.hashtags, ['#one', '#two']);
  assert.equal(back.platformCaptions.facebook.postCopy, 'original', 'nested JSON must parse');
  assert.equal(back.headline, 'Check Basement Moisture Early');
});

// ============================================================ affectedRows
test('an UPDATE that matches no row does not silently look like a save', SKIP, async () => {
  const run = await runs.createRun({
    userId, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  const item = await runs.createItem({
    userId, plannerRunId: run.id, scheduledFor: '2026-07-18 21:45:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'h', subheadline: 's', summary: 's', caption: 'c', altText: 'a',
    hashtags: [], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'c', hashtags: [], validationStatus: 'passed' } },
    approvalStatus: 'needs_review', position: 0,
  });

  // Another user's id: the row exists, but not for them.
  const foreign = await runs.updateItem(item.id, otherUserId, { headline: 'stolen' });
  assert.equal(foreign, null, "another user's update must return nothing");

  const untouched = await runs.findItemByIdForUser(item.id, userId);
  assert.equal(untouched.headline, 'h', 'and must not have changed the row');
});

// ============================================================== transactions
test('a transaction rolls back for real, not through a fake helper', SKIP, async () => {
  const run = await runs.createRun({
    userId, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  const item = await runs.createItem({
    userId, plannerRunId: run.id, scheduledFor: '2026-07-18 21:45:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'before', subheadline: 's', summary: 's', caption: 'original copy', altText: 'a',
    hashtags: [], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'original copy', hashtags: [], validationStatus: 'passed' } },
    approvalStatus: 'needs_review', position: 0,
  });

  await assert.rejects(
    withTransaction(async (conn) => {
      await runs.updateItem(item.id, userId, { headline: 'after', caption: 'new copy' }, conn);
      await revisions.recordRevision({
        userId, plannerRunItemId: item.id, platform: 'facebook',
        revisionType: 'manual_edit', postCopy: 'new copy', hashtags: [], validationStatus: 'passed',
      }, conn);
      // Fail AFTER both writes, exactly like a revision failure would.
      throw new Error('deliberate failure inside the transaction');
    }),
    /deliberate failure/,
  );

  // The real proof: MariaDB discarded both statements.
  const after = await runs.findItemByIdForUser(item.id, userId);
  assert.equal(after.headline, 'before', 'the row update must be rolled back');
  assert.equal(after.caption, 'original copy', 'the copy must be rolled back');
  const history = await revisions.listRevisionsForItem(item.id, userId, { limit: 50 });
  assert.equal(history.length, 0, 'the revision must be rolled back with it');
});

test('a committed transaction keeps both the row and its revision', SKIP, async () => {
  const run = await runs.createRun({
    userId, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  const item = await runs.createItem({
    userId, plannerRunId: run.id, scheduledFor: '2026-07-18 21:45:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'before', subheadline: 's', summary: 's', caption: 'original', altText: 'a',
    hashtags: [], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'original', hashtags: [], validationStatus: 'passed' } },
    approvalStatus: 'needs_review', position: 0,
  });

  await withTransaction(async (conn) => {
    await runs.updateItem(item.id, userId, { headline: 'after' }, conn);
    await revisions.recordRevision({
      userId, plannerRunItemId: item.id, platform: 'facebook',
      revisionType: 'manual_edit', postCopy: 'new', hashtags: [], validationStatus: 'passed',
    }, conn);
  });

  assert.equal((await runs.findItemByIdForUser(item.id, userId)).headline, 'after');
  assert.equal((await revisions.listRevisionsForItem(item.id, userId, { limit: 50 })).length, 1);
});

// ================================================================ ownership
test('every read is scoped to its owner', SKIP, async () => {
  const account = await fbAccount();
  const automation = await automations.createAutomation({
    userId, name: 'Mine', status: 'draft', mode: 'review', timezone: 'Asia/Karachi',
    selectedWeekdays: [7], postingTimes: ['02:45'], postsPerDay: 1, rhythmKey: 'balanced',
    selectedPlatforms: ['facebook'], selectedAccountIds: [String(account.id)],
    startDate: null, endDate: null, generationHorizonDays: 3, minimumReadyDays: 2,
    lowBufferDays: 1, missedPostPolicy: 'skip', failurePolicy: 'pause', configSnapshot: {},
  });
  const run = await runs.createRun({
    userId, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });

  assert.equal(await automations.findAutomationByIdForUser(automation.id, otherUserId), null);
  assert.equal(await runs.findRunByIdForUser(run.id, otherUserId), null);
  const theirAccounts = await socialAccounts.listAccountsForUser(otherUserId);
  assert.equal(theirAccounts.length, 0, "another user's account list must be empty");
});

// ============================================================== idempotency
test('enqueue is idempotent on its key, enforced by MariaDB', SKIP, async () => {
  const key = 'automation_refill:1:2026-07-19';
  const first = await jobs.enqueueJob({
    userId, jobType: 'automation_refill', idempotencyKey: key, payload: { n: 1 }, maxAttempts: 5,
  });
  const second = await jobs.enqueueJob({
    userId, jobType: 'automation_refill', idempotencyKey: key, payload: { n: 2 }, maxAttempts: 5,
  });
  assert.equal(first.created, true, 'the first enqueue creates a job');
  assert.equal(second.created, false, 'the second must not');
  assert.equal(String(first.job.id), String(second.job.id), 'and must return the same job');
});

test('two workers cannot claim the same job', SKIP, async () => {
  await jobs.enqueueJob({
    userId, jobType: 'automation_refill', idempotencyKey: 'claim-race', payload: {}, maxAttempts: 5,
  });
  // Genuinely concurrent against one database.
  const [a, b] = await Promise.all([
    jobs.claimNextJob({ workerId: 'worker-a', leaseMs: 60000 }),
    jobs.claimNextJob({ workerId: 'worker-b', leaseMs: 60000 }),
  ]);
  const claimed = [a, b].filter(Boolean);
  assert.equal(claimed.length, 1, 'exactly one worker may win the row');
});

// =================================================================== leases
test('the scheduler lease serialises two instances against MariaDB', SKIP, async () => {
  const lockName = 'hostinger-single-process-scheduler';
  const [first, second] = await Promise.all([
    jobs.acquireLeaseDbTime({ lockName, owner: 'web-instance-a', ttlSeconds: 90 }),
    jobs.acquireLeaseDbTime({ lockName, owner: 'web-instance-b', ttlSeconds: 90 }),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1, 'exactly one instance may lead');

  // The holder renews its own lease; the follower is still refused.
  const owner = first ? 'web-instance-a' : 'web-instance-b';
  const follower = first ? 'web-instance-b' : 'web-instance-a';
  assert.equal(await jobs.acquireLeaseDbTime({ lockName, owner, ttlSeconds: 90 }), true);
  assert.equal(await jobs.acquireLeaseDbTime({ lockName, owner: follower, ttlSeconds: 90 }), false);

  // A released lease is immediately available, as on a clean shutdown.
  await jobs.releaseLease({ lockName, owner });
  assert.equal(await jobs.acquireLeaseDbTime({ lockName, owner: follower, ttlSeconds: 90 }), true);
});

test('an expired lease is reclaimable, so a crashed leader unblocks itself', SKIP, async () => {
  const lockName = 'expiry-probe';
  /*
   * A three-second TTL, not one. With a one-second lease the "still held"
   * assertion raced the expiry itself: on a cold container a round trip can
   * take a good fraction of a second, and the lease could lapse between the two
   * calls. The margin is about test stability, not about the behaviour — what
   * is being proved is that expiry alone makes the row reclaimable.
   */
  assert.equal(await jobs.acquireLeaseDbTime({ lockName, owner: 'dead-leader', ttlSeconds: 3 }), true);
  assert.equal(await jobs.acquireLeaseDbTime({ lockName, owner: 'survivor', ttlSeconds: 60 }), false);
  await new Promise((r) => { setTimeout(r, 4000); });
  assert.equal(await jobs.acquireLeaseDbTime({ lockName, owner: 'survivor', ttlSeconds: 60 }), true,
    'past the TTL the row must be reclaimable with nothing having noticed the crash');
});

// ================================================================ date/time
test('a UTC instant is stored and read back without drifting', SKIP, async () => {
  const run = await runs.createRun({
    userId, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  // 02:45 on 2026-07-19 in Asia/Karachi is 21:45 on 2026-07-18 UTC.
  const item = await runs.createItem({
    userId, plannerRunId: run.id, scheduledFor: '2026-07-18 21:45:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'h', subheadline: 's', summary: 's', caption: 'c', altText: 'a',
    hashtags: [], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'c', hashtags: [], validationStatus: 'passed' } },
    approvalStatus: 'needs_review', position: 0,
  });
  const back = await runs.findItemByIdForUser(item.id, userId);
  // dateStrings: true, so the driver hands back exactly what was stored and the
  // connection timezone cannot quietly shift it.
  assert.match(String(back.scheduledFor), /^2026-07-18[ T]21:45/,
    'the stored instant must not be re-interpreted on the way out');
});
