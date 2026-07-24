// The AI poster studio, wired into the daily automation slot path.
//
// These are pure unit tests: the AI engine and the media upload are injected as
// fakes, so no Claude call, no headless Chrome and no database are involved. They
// prove the WIRING — that an AI-mode slot produces a valid, reviewable Cyflow
// item, that an image failure is recorded safely (never a crash, never a silent
// "No image"), and that the OpenAI + HCTI "Make parity" engine is bypassed
// cleanly when AI mode is on. The whole rest of the planner suite runs with AI
// mode OFF (the default), so it doubles as the additive-no-regression proof.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlannerService } from '../src/services/plannerService.js';
import {
  PLANNER_ITEM_STATUS,
  PLANNER_QUALITY_STATUS,
  IMAGE_RENDER_STATUS,
  PROVIDER_NAMES,
} from '../src/config/constants.js';

const USER = '7';
const NOW = new Date('2026-07-24T06:00:00Z');

const PROFILE = {
  businessName: 'Lahore Fitness Club',
  businessCategory: 'Gym / fitness club',
  businessDescription: 'Personal training, group classes and 24/7 access in Lahore.',
  services: ['Personal training', 'Group classes', '24/7 access'],
  primaryColor: '#0EA5E9',
  secondaryColor: '#0F172A',
  accentColor: '#F59E0B',
  headingFont: 'Poppins',
  websiteUrl: 'https://lahorefitness.example',
  defaultCallToAction: 'Start your free trial',
};

const SLOT = { localDate: '2026-07-25', localTime: '09:00', scheduledForUtc: '2026-07-25 09:00:00' };

/** The copy an AI-studio post carries, as the real engine returns it. */
function fakeCopy() {
  return {
    headline: 'Stronger Every Single Day',
    subtext: 'Personal training, group classes and 24/7 access in the heart of Lahore.',
    cta: 'Start your free trial',
    captions: {
      facebook: 'Facebook post copy for the gym. Real, warm, specific.\n\nSecond paragraph.',
      instagram: 'Instagram post copy, written for Instagram, not a reused Facebook post.',
      threads: 'Threads copy, shorter and punchier.',
    },
    hashtags: ['#LahoreFitness', '#Gym', '#Fitness'],
  };
}

/**
 * Build a planner service whose automation slot path is fully faked. `aiPost`
 * controls what the injected AI engine returns; `onOpenAI` fires if the Make
 * engine is ever reached (it must not be, in AI mode).
 */
function build({ aiEnabled = true, aiPost, onOpenAI } = {}) {
  const items = [];
  const run = {
    id: 'run1',
    userId: USER,
    timezone: 'UTC',
    contentAutomationId: 'auto1',
    settings: {
      platforms: ['facebook', 'instagram'],
      rhythmPreset: 'balanced',
      tone: 'friendly',
      goals: ['awareness'],
      contentMix: {},
      ctaMode: 'some',
    },
  };

  const runs = {
    findRunByIdForUser: async (id) => (String(id) === 'run1' ? run : null),
    listItemsForRun: async () => items.slice(),
    listRecentFingerprintsForUser: async () => [],
    createItem: async (input) => {
      const item = { id: `item_${items.length + 1}`, ...input };
      items.push(item);
      return item;
    },
  };

  let uploadCount = 0;
  const mediaLibraryService = {
    uploadImage: async (userId, file) => {
      uploadCount += 1;
      assert.equal(userId, USER, 'upload is scoped to the acting user');
      assert.ok(Buffer.isBuffer(file.buffer), 'a PNG buffer is passed to the media library');
      return { id: 'media_1', publicToken: 'tok_1', url: '/media/tok_1' };
    },
  };

  const mediaRepository = {
    findMediaAssetByIdForUser: async (id) =>
      (String(id) === 'media_1' ? { id: 'media_1', publicToken: 'tok_1', status: 'ready' } : null),
  };

  let openaiCalls = 0;
  const openaiContentService = {
    isReadyForUser: async () => true,
    isAvailable: async () => true,
    generatePlannerPost: async (inp) => {
      openaiCalls += 1;
      if (onOpenAI) onOpenAI(inp);
      throw new Error('The Make (OpenAI) engine must not run while AI mode is on.');
    },
  };

  const aiStudio = {
    isAiStudioEnabled: () => aiEnabled,
    styleIdForPosition: () => 'showcase',
    generateAiPost: async () => aiPost(),
  };

  const svc = createPlannerService({
    runs,
    businessProfiles: { findByUserId: async () => PROFILE },
    socialAccounts: {},
    mediaRepository,
    mediaLibraryService,
    aiStudio,
    openaiContentService,
    socialImageService: { isReadyForUser: async () => false },
    revisions: { recordRevision: async () => {} },
    logging: { record: async () => {} },
    now: () => NOW,
  });

  return { svc, items, get uploadCount() { return uploadCount; }, get openaiCalls() { return openaiCalls; } };
}

test('AI mode: an automation slot becomes a valid, reviewable item with the Claude poster attached', async () => {
  const ctx = build({
    aiPost: () => ({ copy: fakeCopy(), html: '<!doctype html><html></html>', png: Buffer.from('89504e470d0a1a0a', 'hex'), imageError: null }),
  });

  const { item } = await ctx.svc.generateAutomationSlotItem({ userId: USER, runId: 'run1', slot: SLOT });

  assert.ok(item, 'an item is returned');
  // Copy: the primary platform is facebook (platforms[0]); its caption is the item caption.
  assert.equal(item.caption, fakeCopy().captions.facebook);
  assert.equal(item.headline, 'Stronger Every Single Day');
  assert.deepEqual(item.platformTargets, ['facebook', 'instagram']);
  // Per-platform copy is present for both selected platforms.
  assert.equal(item.platformCopy.facebook.postCopy, fakeCopy().captions.facebook);
  assert.equal(item.platformCopy.instagram.postCopy, fakeCopy().captions.instagram);
  // Image: the poster PNG was stored through the raw-bytes media path and is READY.
  assert.equal(ctx.uploadCount, 1, 'the poster was uploaded exactly once');
  assert.equal(item.mediaAssetId, 'media_1');
  assert.equal(item.image.status, IMAGE_RENDER_STATUS.READY);
  assert.ok(item.media && item.media.publicToken, 'the decorated item carries the media token');
  // Review discipline: AI posts are held for a human, never auto-approved.
  assert.equal(item.approvalStatus, PLANNER_ITEM_STATUS.NEEDS_REVIEW);
  assert.equal(item.qualityStatus, PLANNER_QUALITY_STATUS.PASSED);
  // The Make engine was never touched.
  assert.equal(ctx.openaiCalls, 0);
});

test('AI mode: a render/design failure yields a safe, retryable image state, not a lost post', async () => {
  const ctx = build({
    aiPost: () => ({ copy: fakeCopy(), html: null, png: null, imageError: new Error('render service unavailable') }),
  });

  const { item } = await ctx.svc.generateAutomationSlotItem({ userId: USER, runId: 'run1', slot: SLOT });

  assert.ok(item, 'the post is still created without an image');
  assert.equal(ctx.uploadCount, 0, 'nothing was uploaded when there was no PNG');
  assert.ok(!item.mediaAssetId, 'no media asset is attached');
  // The caption still shipped — the copy does not depend on the image.
  assert.equal(item.caption, fakeCopy().captions.facebook);
  // A specific, queryable, retryable failure state — never a silent null.
  assert.equal(item.image.status, IMAGE_RENDER_STATUS.FAILED);
  assert.equal(item.image.provider, PROVIDER_NAMES.AI_STUDIO);
  assert.ok(item.image.error, 'the failure carries a safe, categorized error');
});

test('AI mode: the copy failure path returns null so the worker retries, and never calls OpenAI', async () => {
  const ctx = build({
    aiPost: () => { throw new Error('AI request failed (504) after retries'); },
  });

  const result = await ctx.svc.generateAutomationSlotItem({ userId: USER, runId: 'run1', slot: SLOT });

  assert.deepEqual(result, { item: null }, 'a transient miss the worker retries');
  assert.equal(ctx.openaiCalls, 0, 'the Make engine is never used as a fallback');
});
