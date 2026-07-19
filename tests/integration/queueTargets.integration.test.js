// The account fan-out, against real MariaDB.
//
// The unit suite proves the resolution logic with in-memory repositories. This
// proves the rows: seven social_accounts, one automation naming one of them,
// and exactly ONE scheduled_post_targets row after queueing — counted with SQL,
// not with the objects the service handed back.
//
// It matters separately because the defect was a JOIN-shaped mistake. Anything
// that resolves the selection correctly in JavaScript and still writes seven
// rows would pass the unit tests and fail here.
import { hasDatabase, resetDatabase, SKIP } from './helpers/db.js';
import '../helpers/setupEnv.js';

import test, { before, beforeEach, after } from 'node:test';   // eslint-disable-line import/first
import assert from 'node:assert/strict';                        // eslint-disable-line import/first

import { getPool, closePool } from '../../src/db/pool.js';       // eslint-disable-line import/first
import * as users from '../../src/repositories/userRepository.js';                     // eslint-disable-line import/first
import * as socialAccounts from '../../src/repositories/socialAccountRepository.js';   // eslint-disable-line import/first
import * as automations from '../../src/repositories/automationRepository.js';         // eslint-disable-line import/first
import * as runs from '../../src/repositories/plannerRunRepository.js';                // eslint-disable-line import/first
import { createPlannerService } from '../../src/services/plannerService.js';           // eslint-disable-line import/first

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

let pool;
let planner;

before(async () => {
  if (!hasDatabase) return;
  pool = getPool();
  planner = createPlannerService();
});
beforeEach(async () => { if (hasDatabase) await resetDatabase(pool); });
after(async () => { if (hasDatabase) await closePool().catch(() => {}); });

async function seed({ withAutomation = true, chosen = [CHOSEN] } = {}) {
  const user = await users.createUser({
    name: 'Operator', email: 'operator@example.test', passwordHash: 'x'.repeat(60), timezone: 'Asia/Karachi',
  });
  const userId = String(user.id);

  for (const [i, displayName] of PAGES.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await socialAccounts.upsertSocialAccount({
      userId, provider: 'meta', accountType: 'facebook_page',
      providerAccountId: `fb-page-${i}`, displayName, username: `handle-${i}`,
      encryptedAccessToken: `v1:token-${i}`, scopes: [], providerMetadata: {}, status: 'active',
    });
  }
  const accounts = await socialAccounts.listAccountsForUser(userId);
  const chosenIds = chosen.map((name) => accounts.find((a) => a.displayName === name).id);

  let automationId = null;
  if (withAutomation) {
    const automation = await automations.createAutomation({
      userId, name: 'NYC Waterproofing Test', mode: 'review', timezone: 'Asia/Karachi',
      selectedWeekdays: [7], postingTimes: ['02:45'], postsPerDay: 1, rhythmKey: 'balanced',
      selectedPlatforms: ['facebook'], selectedAccountIds: chosenIds.map(String),
      missedPostPolicy: 'skip', generationHorizonDays: 3, minimumReadyDays: 2, lowBufferDays: 1,
      status: 'active',
    });
    automationId = automation.id;
  }

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
      facebook: {
        postCopy: 'Basement leaking? Our crew waterproofs New York homes.',
        hashtags: ['#waterproofing'], validationStatus: 'passed',
      },
    },
    approvalStatus: 'approved', position: 0,
  });

  return { userId, run, item, accounts, chosenIds };
}

// Counted in SQL. The service's own return value is not evidence about rows.
const countTargets = async (userId) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n
       FROM scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id
      WHERE p.user_id = ?`, [userId],
  );
  return Number(rows[0].n);
};

const targetNames = async (userId) => {
  const [rows] = await pool.query(
    `SELECT sa.display_name AS name
       FROM scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id
       JOIN social_accounts sa ON sa.id = t.social_account_id
      WHERE p.user_id = ?
      ORDER BY sa.display_name`, [userId],
  );
  return rows.map((r) => r.name);
};

const countPosts = async (userId) => {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM scheduled_posts WHERE user_id = ?', [userId]);
  return Number(rows[0].n);
};

test('seven active Pages, one selected: exactly one post and one target row', SKIP, async () => {
  const { userId, run } = await seed();

  const before7 = await socialAccounts.listAccountsForUser(userId);
  assert.equal(before7.filter((a) => a.status === 'active').length, 7, 'the reproduction needs seven active');

  const result = await planner.queueApproved(userId, run.id, []);
  assert.equal(result.queued.length, 1);

  assert.equal(await countPosts(userId), 1, 'exactly one scheduled post');
  assert.equal(await countTargets(userId), 1, 'exactly one target row in the database');
  assert.deepEqual(await targetNames(userId), [CHOSEN]);
});

test('none of the six unselected Pages has a target row', SKIP, async () => {
  const { userId, run } = await seed();
  await planner.queueApproved(userId, run.id, []);

  const names = await targetNames(userId);
  for (const page of PAGES.slice(1)) {
    assert.ok(!names.includes(page), `${page} must have no target row`);
  }
});

test('queueing twice writes no second post and no second target', SKIP, async () => {
  const { userId, run } = await seed();
  await planner.queueApproved(userId, run.id, []);

  // The item is claimed, so the second call finds nothing approved and throws.
  await planner.queueApproved(userId, run.id, []).catch(() => null);

  assert.equal(await countPosts(userId), 1, 'still one post');
  assert.equal(await countTargets(userId), 1, 'still one target');
});

test('concurrent queue calls write one post and one target', SKIP, async () => {
  const { userId, run } = await seed();

  await Promise.all([
    planner.queueApproved(userId, run.id, []).catch(() => null),
    planner.queueApproved(userId, run.id, []).catch(() => null),
  ]);

  assert.equal(await countPosts(userId), 1, 'the database decides the winner');
  assert.equal(await countTargets(userId), 1);
});

test('two selected accounts write exactly those two rows', SKIP, async () => {
  const chosen = [PAGES[0], PAGES[3]];
  const { userId, run } = await seed({ chosen });
  await planner.queueApproved(userId, run.id, []);

  assert.equal(await countTargets(userId), 2);
  assert.deepEqual(await targetNames(userId), [...chosen].sort());
});

test('a revoked selected account writes nothing at all', SKIP, async () => {
  /*
   * The chosen Page is revoked while the other six stay active. Falling back to
   * "whatever still works" would post to six businesses that never agreed.
   */
  const { userId, run, chosenIds } = await seed();
  await socialAccounts.markAccountRevoked(chosenIds[0], userId, { eraseTokens: false });

  const result = await planner.queueApproved(userId, run.id, []).catch((e) => ({ queued: [], error: e }));
  assert.equal((result.queued || []).length, 0);
  assert.equal(await countPosts(userId), 0, 'no post');
  assert.equal(await countTargets(userId), 0, 'no target');
});

test('a manual run with no stored selection writes nothing', SKIP, async () => {
  const { userId, run } = await seed({ withAutomation: false, chosen: [] });

  const result = await planner.queueApproved(userId, run.id, []).catch((e) => ({ queued: [], error: e }));
  assert.equal((result.queued || []).length, 0);
  assert.equal(await countTargets(userId), 0, 'seven active accounts, no selection, no rows');
});

test('a manual run with a stored selection writes exactly that one', SKIP, async () => {
  const { userId, run } = await seed({ withAutomation: false });
  await planner.queueApproved(userId, run.id, []);

  assert.equal(await countTargets(userId), 1);
  assert.deepEqual(await targetNames(userId), [CHOSEN]);
});
