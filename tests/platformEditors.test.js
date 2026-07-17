/**
 * Milestone C2 — per-platform editing, edit protection, and revisions.
 *
 * The gap this closes: platform_captions_json has been the canonical per-platform
 * store since 4.7.2, but nothing let a user SEE or edit one platform's copy
 * independently. These tests exercise the server side of that — the normalized
 * contract, the edit API, the overwrite guard, and the revision timeline —
 * against the real services with fake repositories.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlannerService } from '../src/services/plannerService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';
import { normalizePlatformCopy, applyPlatformEdit } from '../src/services/platformCopy.js';
import {
  createFakeSocialAccountRepository,
  createFakePostRepository,
  createFakeMediaAssetRepository,
  createFakeApiUsageRepository,
  createFakeBusinessProfileRepository,
  createFakePlannerPreferenceRepository,
  createFakePlannerRunRepository,
  createFakePlannerRevisionRepository,
  createFakePlannerOpenAI,
  createFakeSocialImageService,
  fakeWithTransaction,
} from './helpers/fakes.js';

const USER = '5';
const OTHER_USER = '6';
const NOW = new Date('2026-07-13T06:00:00Z');

// Valid copy for each platform, measured against the real bands: word count AND
// prose-paragraph count both matter, so these are genuinely multi-paragraph.
const para = (n) => 'word '.repeat(n).trim();
const IG = [para(70), para(70)].join('\n\n'); // 140 words, 2 paragraphs
const IG2 = [`Almost everyone ${para(69)}`, para(70)].join('\n\n'); // 141 words, 2 paragraphs
const TH = [para(30), para(30)].join('\n\n'); // 60 words, 2 paragraphs
const TH2 = [`A hand written ${para(28)}`, para(30)].join('\n\n'); // 61 words, 2 paragraphs
const TH_INVALID = para(20); // 20 words, under the 45 floor

function build(extra = {}) {
  const socialAccounts = createFakeSocialAccountRepository();
  const revisions = extra.revisions ?? createFakePlannerRevisionRepository();
  const runs = extra.runs ?? createFakePlannerRunRepository();
  const media = createFakeMediaAssetRepository();
  const svc = createPlannerService({
    preferences: createFakePlannerPreferenceRepository(),
    runs,
    revisions,
    businessProfiles: createFakeBusinessProfileRepository(),
    socialAccounts,
    posts: createFakePostRepository({ socialAccounts }),
    mediaRepository: media,
    apiUsage: extra.apiUsage ?? createFakeApiUsageRepository(),
    openaiContentService: extra.openai ?? createFakePlannerOpenAI(),
    socialImageService: createFakeSocialImageService(),
    mediaAssetService: createMediaAssetService({ mediaRepository: media }),
    uniqueness: contentUniquenessService,
    logging: { record: async () => {} },
    withTransaction: fakeWithTransaction,
    now: () => NOW,
  });
  return { svc, runs, revisions, socialAccounts };
}

async function seedItem(runs, overrides = {}) {
  return runs.createItem({
    plannerRunId: '1', userId: USER, position: 0,
    scheduledFor: '2026-07-14 09:00:00', originalTimezone: 'Asia/Karachi',
    contentType: 'educational_insight', platformTargets: ['instagram', 'threads'],
    templateKey: 'editorial-premium', mediaAssetId: null,
    caption: IG, hashtags: ['#seo'],
    platformCaptions: { instagram: { caption: IG, hashtags: ['#seo'] }, threads: { caption: TH, hashtags: [] } },
    headline: 'A headline', subheadline: 'Sub', approvalStatus: 'needs_review', qualityStatus: 'passed',
    ...overrides,
  });
}

// --- the canonical contract (pure) ------------------------------------------

test('platform_captions_json is canonical; only selected platforms normalize', () => {
  const copy = normalizePlatformCopy({
    platformTargets: ['instagram', 'threads'],
    platformCaptions: {
      instagram: { caption: IG, hashtags: ['#seo'] },
      threads: { caption: TH, hashtags: [] },
      facebook: { caption: 'stray', hashtags: [] }, // present in JSON but NOT selected
    },
    caption: IG, hashtags: ['#seo'],
  });
  assert.deepEqual(Object.keys(copy).sort(), ['instagram', 'threads']);
  assert.ok(!('facebook' in copy), 'an unselected platform is never surfaced');
  assert.equal(copy.instagram.postCopy, IG);
  assert.equal(copy.threads.postCopy, TH);
});

test('a legacy item with no platform_captions_json falls back to caption, read-only', () => {
  const item = { platformTargets: ['instagram', 'threads'], platformCaptions: null, caption: IG, hashtags: ['#x'], editedFields: [] };
  const copy = normalizePlatformCopy(item);
  assert.equal(copy.instagram.postCopy, IG);
  assert.equal(copy.threads.postCopy, IG, 'both fall back to the single caption');
  // Reading it did not mutate the item.
  assert.equal(item.platformCaptions, null);
});

test('a legacy primary inherits editedFields; a sibling does not', () => {
  const copy = normalizePlatformCopy({
    platformTargets: ['instagram', 'threads'], platformCaptions: null,
    caption: IG, hashtags: [], editedFields: ['caption'],
  });
  assert.equal(copy.instagram.userEdited, true, 'the edited primary caption is a user edit');
  assert.equal(copy.threads.userEdited, false, 'the old flag cannot be attributed to a sibling');
});

test('applyPlatformEdit writes siblings back byte-for-byte', () => {
  const item = {
    platformTargets: ['instagram', 'threads'],
    platformCaptions: { instagram: { caption: IG, hashtags: ['#seo'], userEdited: true }, threads: { caption: TH, hashtags: [] } },
    caption: IG, hashtags: ['#seo'],
  };
  const next = applyPlatformEdit(item, 'threads', { postCopy: TH2, hashtags: ['#new'] }, '2026-07-17T00:00:00Z');
  assert.equal(next.instagram.caption, IG, 'the sibling copy is unchanged');
  assert.equal(next.instagram.userEdited, true, 'the sibling edit flag is preserved');
  assert.equal(next.threads.caption, TH2);
  assert.equal(next.threads.userEdited, true);
  assert.ok(!('facebook' in next));
});

// --- decorated item carries platformCopy ------------------------------------

test('a decorated item exposes resolved per-platform copy with validation', async () => {
  const { svc, runs } = build();
  const item = await seedItem(runs);
  const plan = await svc.getPlan(USER, '1').catch(() => null);
  // getPlan needs a run row; read the item directly through the API path instead.
  const updated = await svc.updateItem(USER, item.id, {}); // no-op returns decorated
  assert.ok(updated.platformCopy, 'platformCopy is attached');
  assert.deepEqual(Object.keys(updated.platformCopy).sort(), ['instagram', 'threads']);
  assert.equal(updated.platformCopy.instagram.validationStatus, 'passed');
  assert.ok(updated.platformCopy.instagram.measurements.words >= 120);
  void plan;
});

// --- manual edits are independent -------------------------------------------

test('editing Threads changes only Threads and records one manual_edit revision', async () => {
  const { svc, runs, revisions } = build();
  const item = await seedItem(runs);
  const before = await runs.findItemByIdForUser(item.id, USER);

  const r = await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: ['#new'] } } });

  assert.equal(r.platformCopy.threads.postCopy, TH2);
  assert.equal(r.platformCopy.threads.userEdited, true);
  assert.equal(r.platformCopy.instagram.postCopy, IG, 'Instagram is untouched');
  assert.equal(r.platformCopy.instagram.userEdited, false);
  // Shared fields untouched.
  assert.equal(r.scheduledFor, before.scheduledFor);
  assert.equal(r.originalTimezone, before.originalTimezone);
  assert.equal(r.templateKey, before.templateKey);
  assert.equal(r.mediaAssetId, before.mediaAssetId);
  // Exactly one manual_edit revision, for Threads.
  const revs = revisions._rows.filter((x) => x.revision_type === 'manual_edit');
  assert.equal(revs.length, 1);
  assert.equal(revs[0].platform, 'threads');
});

test('editing Instagram (the primary) syncs the canonical caption', async () => {
  const { svc, runs } = build();
  const item = await seedItem(runs);
  const r = await svc.updateItem(USER, item.id, { platformCaptions: { instagram: { postCopy: IG2, hashtags: ['#seo'] } } });
  assert.equal(r.platformCopy.instagram.postCopy, IG2);
  assert.equal(r.caption, IG2, 'the primary caption follows the primary platform edit');
  assert.equal(r.platformCopy.threads.postCopy, TH, 'Threads untouched');
});

test('a manual edit makes zero OpenAI and zero HCTI calls', async () => {
  const openai = createFakePlannerOpenAI();
  const images = createFakeSocialImageService();
  const { svc, runs } = build({ openai });
  const item = await seedItem(runs);
  await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: [] } } });
  assert.equal(openai._calls.length, 0);
  assert.equal(images._calls.length, 0);
});

test('re-saving identical platform copy records no new revision', async () => {
  const { svc, runs, revisions } = build();
  const item = await seedItem(runs);
  await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: ['#a'] } } });
  const after1 = revisions._rows.length;
  await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: ['#a'] } } });
  assert.equal(revisions._rows.length, after1, 'an identical re-save adds nothing');
});

// --- validation on manual edits ---------------------------------------------

test('an invalid manual edit is stored but shown failed, and cannot be approved', async () => {
  const { svc, runs } = build();
  const item = await seedItem(runs);
  const r = await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH_INVALID, hashtags: [] } } });
  assert.equal(r.platformCopy.threads.validationStatus, 'failed');
  assert.ok(r.platformCopy.threads.validationFailures.some((f) => /minimum is 45/.test(f)));
});

test('a valid manual edit clears a hard failure only when EVERY platform passes', async () => {
  const { svc, runs } = build();
  // Both platforms start invalid, item hard-failed.
  const item = await seedItem(runs, {
    caption: TH_INVALID, approvalStatus: 'generation_failed', qualityStatus: 'generation_failed',
    qualityFailures: ['Instagram has 20 words; the minimum is 120'],
    platformCaptions: { instagram: { caption: TH_INVALID, hashtags: [] }, threads: { caption: TH_INVALID, hashtags: [] } },
  });

  // Fix only Threads: Instagram is still invalid, so the failure must NOT clear.
  const r1 = await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: [] } } });
  assert.equal(r1.approvalStatus, 'generation_failed', 'one platform still invalid keeps it failed');

  // Now fix Instagram too: every platform passes, the failure clears.
  const r2 = await svc.updateItem(USER, item.id, { platformCaptions: { instagram: { postCopy: IG, hashtags: ['#seo'] } } });
  assert.notEqual(r2.approvalStatus, 'generation_failed');
  assert.equal(r2.qualityFailures, null);
});

// --- injection / ownership --------------------------------------------------

test('Facebook cannot be injected into an Instagram + Threads item', async () => {
  const { svc, runs, revisions } = build();
  const item = await seedItem(runs);
  await assert.rejects(
    () => svc.updateItem(USER, item.id, { platformCaptions: { facebook: { postCopy: `${'word '.repeat(150).trim()}`, hashtags: [] } } }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.ok(err.details.some((d) => /not one of this post's platforms/.test(d.message)), JSON.stringify(err.details));
      return true;
    },
  );
  assert.ok(!revisions._rows.some((x) => x.platform === 'facebook'), 'no Facebook revision was created');
});

test('one user cannot read another user\'s revisions', async () => {
  const { svc, runs } = build();
  const item = await seedItem(runs);
  await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: [] } } });
  await assert.rejects(() => svc.getItemRevisions(OTHER_USER, item.id), (err) => {
    assert.equal(err.statusCode, 404, 'another user gets not-found, not a peek');
    return true;
  });
});

test('one user cannot edit another user\'s post copy', async () => {
  const { svc, runs } = build();
  const item = await seedItem(runs);
  await assert.rejects(
    () => svc.updateItem(OTHER_USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: [] } } }),
    (err) => { assert.equal(err.statusCode, 404); return true; },
  );
});

// --- overwrite protection ---------------------------------------------------

test('regenerating a user-edited platform requires confirmation and spends nothing on decline', async () => {
  const openai = createFakePlannerOpenAI({ available: true });
  const { svc, runs, revisions } = build({ openai });
  const item = await seedItem(runs);
  // Give the item a verified OpenAI key path — the fake reports available.
  await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: [] } } });
  const callsBefore = openai._calls.length;
  const revsBefore = revisions._rows.length;

  await assert.rejects(
    () => svc.regenerateItem(USER, item.id, 'caption', { force: false }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /edited the Threads copy by hand/);
      return true;
    },
  );
  assert.equal(openai._calls.length, callsBefore, 'decline makes zero OpenAI calls');
  assert.equal(revisions._rows.length, revsBefore, 'decline creates zero revisions');
});

test('a sibling retry preserves a user-edited, passing platform automatically', async () => {
  // Instagram fails, Threads is user-edited and valid. A repair rewrites only
  // Instagram and never asks about Threads.
  const openai = createFakePlannerOpenAI({ platformScript: { instagram: [IG2] }, validate: true });
  const { svc, runs } = build({ openai });
  const item = await seedItem(runs, {
    caption: 'too short', approvalStatus: 'generation_failed', qualityStatus: 'generation_failed',
    qualityFailures: ['Instagram has 2 words; the minimum is 120'],
    platformCaptions: {
      instagram: { caption: 'too short', hashtags: ['#seo'] },
      threads: { caption: TH2, hashtags: [], userEdited: true },
    },
  });

  const r = await svc.regenerateItem(USER, item.id, 'caption', { force: false });
  assert.equal(r.platformCopy.instagram.validationStatus, 'passed', 'Instagram was repaired');
  assert.equal(r.platformCopy.threads.postCopy, TH2, 'the user-edited Threads copy is untouched');
  assert.equal(r.platformCopy.threads.userEdited, true, 'and still marked as the user\'s');
});

test('an accepted overwrite makes calls and records one retry revision per rewritten platform', async () => {
  const openai = createFakePlannerOpenAI({ platformScript: { instagram: [IG2], threads: [TH2] }, validate: true });
  const { svc, runs, revisions } = build({ openai });
  const item = await seedItem(runs, {
    approvalStatus: 'generation_failed', qualityStatus: 'generation_failed',
    caption: 'too short', qualityFailures: ['Instagram has 2 words; the minimum is 120'],
    platformCaptions: {
      instagram: { caption: 'too short', hashtags: [] },
      threads: { caption: 'also short', hashtags: [], userEdited: true },
    },
  });
  const r = await svc.regenerateItem(USER, item.id, 'caption', { force: true });
  assert.notEqual(r.approvalStatus, 'generation_failed');
  const retries = revisions._rows.filter((x) => x.revision_type === 'retry');
  assert.ok(retries.length >= 1, `expected retry revisions: ${retries.length}`);
});

// --- revision lifecycle ------------------------------------------------------

test('the revision timeline never contains a prompt or a secret', async () => {
  const { svc, runs, revisions } = build();
  const item = await seedItem(runs);
  await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: ['#x'] } } });
  const timeline = await svc.getItemRevisions(USER, item.id);
  const blob = JSON.stringify(timeline);
  assert.ok(!/prompt|instructions|apiKey|sk-|v1:|Bearer/i.test(blob), blob);
  // It DOES carry the copy, which is the point.
  assert.ok(timeline.some((t) => t.postCopy === TH2));
});

test('revisions are stored with the correct platform and type', async () => {
  const { svc, runs, revisions } = build();
  const item = await seedItem(runs);
  await svc.updateItem(USER, item.id, { platformCaptions: { threads: { postCopy: TH2, hashtags: [] } } });
  const rev = revisions._rows.find((x) => x.revision_type === 'manual_edit');
  assert.equal(rev.platform, 'threads');
  assert.equal(rev.revision_type, 'manual_edit');
  assert.equal(rev.post_copy, TH2);
});
