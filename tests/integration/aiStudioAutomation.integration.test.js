// The AI poster studio, proven through the REAL automation + database path — not
// the engine in isolation. A fake AI engine (deterministic, no network) returns a
// real rendered PNG; everything else is real: the automation, the durable worker,
// the slot-generation handler, mediaLibraryService (validate -> store bytes ->
// media_assets row), and createItem into planner_run_items. This closes the gap
// the unit tests cannot: that an AI slot actually persists a valid item with a
// genuine media asset FK on MariaDB.
import { hasDatabase, resetDatabase, SKIP } from './helpers/db.js';
import '../helpers/setupEnv.js';

import test, { before, beforeEach, after } from 'node:test';   // eslint-disable-line import/first
import assert from 'node:assert/strict';                        // eslint-disable-line import/first

import { getPool, closePool } from '../../src/db/pool.js';                              // eslint-disable-line import/first
import * as users from '../../src/repositories/userRepository.js';                     // eslint-disable-line import/first
import * as social from '../../src/repositories/socialAccountRepository.js';           // eslint-disable-line import/first
import * as businessProfiles from '../../src/repositories/businessProfileRepository.js'; // eslint-disable-line import/first
import * as automationsRepo from '../../src/repositories/automationRepository.js';     // eslint-disable-line import/first
import * as runsRepo from '../../src/repositories/plannerRunRepository.js';            // eslint-disable-line import/first
import * as jobsRepo from '../../src/repositories/backgroundJobRepository.js';         // eslint-disable-line import/first
import * as mediaRepo from '../../src/repositories/mediaAssetRepository.js';           // eslint-disable-line import/first
import { createPlannerService } from '../../src/services/plannerService.js';           // eslint-disable-line import/first
import { createAutomationService } from '../../src/services/automationService.js';     // eslint-disable-line import/first
import { createDurableJobService } from '../../src/services/durableJobService.js';     // eslint-disable-line import/first
import { renderSvgToPng } from '../../src/services/aiStudio/posterRenderer.js';        // eslint-disable-line import/first

let pool;
before(() => { if (hasDatabase) pool = getPool(); });
after(async () => { if (hasDatabase) await closePool().catch(() => {}); });
beforeEach(async () => { if (hasDatabase) await resetDatabase(pool); });

const PROFILE = {
  businessName: 'Karachi Coffee Roasters', businessCategory: 'Specialty coffee cafe',
  businessDescription: 'Single-origin coffee, slow-steeped cold brew and a warm neighbourhood cafe.',
  city: 'Karachi', region: 'Sindh', websiteUrl: 'https://karachicoffee.example',
  services: ['Cold brew', 'Single-origin beans', 'Cafe seating'],
  primaryColor: '#6F4E37', secondaryColor: '#2B1B12', accentColor: '#E4B363', logoUrl: 'https://x.example/l.png',
};

/** Render a REAL, unique 1080x1080 PNG per call so each slot stores its own asset. */
function realPng(n) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <rect width="1080" height="1080" fill="#2B1B12"/>
    <text x="90" y="540" font-family="DejaVu Sans, sans-serif" font-size="120" fill="#E4B363">Post ${n}</text>
  </svg>`;
  return renderSvgToPng(svg);
}

/**
 * A fake AI engine: enabled, deterministic, NO network. It returns real poster
 * copy + a real unique PNG, so the REAL mediaLibraryService validates and stores
 * genuine bytes and the item ends up with a real media_assets FK.
 */
function fakeAiStudio() {
  let n = 0;
  return {
    calls: () => n,
    isAiStudioEnabled: () => true,
    styleIdForPosition: () => 'showcase',
    async generateAiPost() {
      n += 1;
      const png = await realPng(n);
      return {
        copy: {
          headline: `Cold Brew ${n}`,
          subtext: 'Single-origin, slow-steeped for a smooth finish.',
          cta: 'Try it this weekend',
          captions: {
            facebook: `Facebook post ${n}. Something new is waiting on our menu this weekend.\n\nCome and taste it.`,
            instagram: `Instagram post ${n}. New single-origin cold brew, slow-steeped and smooth.`,
            threads: `Threads post ${n}. New cold brew just landed. Come try a glass.`,
          },
          hashtags: ['#coldbrew', '#singleorigin', '#karachicoffee'],
        },
        markup: '<svg/>',
        png,
        imageError: null,
      };
    },
  };
}

async function seedWorkspace() {
  const u = await users.createUser({
    name: 'Operator', email: 'ai-operator@example.test', passwordHash: 'x'.repeat(60), timezone: 'Asia/Karachi',
  });
  const userId = String(u.id);
  await businessProfiles.createOrUpdateProfile(userId, PROFILE);
  await social.upsertSocialAccount({
    userId, provider: 'meta', accountType: 'facebook_page', providerAccountId: 'fb0',
    displayName: 'Karachi Coffee Roasters', username: 'kcr', encryptedAccessToken: 'v1:t',
    scopes: [], providerMetadata: {}, status: 'active',
  });
  const accts = await social.listAccountsForUser(userId);
  return { userId, chosenId: accts[0].id };
}

function stack(aiStudio) {
  // AI mode ON via the injected engine; the Make (OpenAI) engine is wired but must
  // never be reached, so it throws if called.
  const planner = createPlannerService({
    aiStudio,
    openaiContentService: {
      isReadyForUser: async () => true,
      isAvailable: async () => true,
      generatePlannerPost: async () => { throw new Error('OpenAI must not run in AI mode'); },
    },
    socialImageService: { isReadyForUser: async () => false },
  });
  const svc = createAutomationService({
    automations: automationsRepo, jobs: jobsRepo, runsRepo, socialAccounts: social, planner,
    aiStudio, // AI mode ON: the slot handler must NOT require OpenAI.
    images: { isReadyForUser: async () => false }, logging: { async record() {} },
    config: { worker: { maxAttempts: 3, refillIntervalHours: 6 } },
  });
  const worker = createDurableJobService({ jobs: jobsRepo, handlers: svc.handlers, options: { heartbeatMs: 0, leaseMs: 60000 } });
  return { planner, svc, worker };
}

test('an AI-mode automation persists real items with real media assets, never touching OpenAI', SKIP, async () => {
  const { userId, chosenId } = await seedWorkspace();
  const ai = fakeAiStudio();
  const { svc, worker } = stack(ai);

  const a = await svc.createAutomation(userId, {
    name: 'AI Studio Coffee', mode: 'review', timezone: 'Asia/Karachi',
    selectedWeekdays: [1, 2, 3, 4, 5, 6, 7], postingTimes: ['09:00'], postsPerDay: 1,
    selectedPlatforms: ['facebook'], selectedAccountIds: [String(chosenId)],
    missedPostPolicy: 'skip', generationHorizonDays: 3, minimumReadyDays: 3, lowBufferDays: 2,
  });
  await svc.activate(userId, a.id);
  await worker.runOne({ workerId: 'W' }); // refill enqueues slot jobs
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await worker.runOne({ workerId: 'W' });
    if (!r.ran) break;
  }

  const updated = await automationsRepo.findAutomationByIdForUser(a.id, userId);
  const items = await runsRepo.listItemsForRun(updated.plannerRunId, userId);

  assert.ok(items.length >= 1, `expected at least one AI item, got ${items.length}`);
  assert.ok(ai.calls() >= items.length, 'the AI engine produced every item');

  for (const item of items) {
    // The AI engine, not the Make engine, produced this.
    assert.equal(item.fingerprint?.engine, 'ai_studio', 'item is stamped as an AI-studio post');
    // Copy persisted (single platform -> caption carries it).
    assert.match(item.caption || '', /Facebook post \d/, 'the Facebook caption persisted');
    assert.deepEqual(item.platformTargets, ['facebook']);
    assert.equal(item.approvalStatus, 'needs_review', 'AI posts are held for review, never auto-approved');
    // A REAL media asset was stored and linked (validate -> store bytes -> row).
    assert.ok(item.mediaAssetId, 'the poster is attached');
    assert.equal(item.imageStatus, 'ready', 'the image state is READY');
    // eslint-disable-next-line no-await-in-loop
    const asset = await mediaRepo.findMediaAssetByIdForUser(item.mediaAssetId, userId);
    assert.ok(asset, 'the media_assets row exists on disk+DB');
    assert.equal(asset.status, 'ready');
    assert.equal(asset.sourceProvider, 'upload', 'stored via the raw-bytes upload path, not HCTI');
    assert.equal(asset.width, 1080);
    assert.equal(asset.height, 1080);
  }
});
