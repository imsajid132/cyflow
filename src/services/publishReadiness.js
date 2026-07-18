/**
 * Publish readiness — the ONE evaluator of "can this target go out".
 *
 * Every surface that needs to decide whether a post/target is publishable
 * (Schedule Later, Publish Now, the /readiness endpoint the workspace renders,
 * and — indirectly — the worker preflight) resolves the answer here, so the UI
 * can never claim a post is ready that the server would reject, and vice-versa.
 *
 * It is deliberately pure: values in, a normalized verdict out. Media byte
 * availability and the live-publishing flag are passed in by the caller (which
 * has the repositories and config); this module has no database and no clock.
 *
 * Hard requirements — an active account, post copy, a required image, a caption
 * within the provider's hard limit, and an editable lifecycle — BLOCK schedule
 * and Publish Now. Style-band guidance (word/paragraph counts) is surfaced as a
 * non-blocking WARNING: a user may schedule their own hand-written copy, and the
 * editor already shows the bands. A draft may be saved regardless.
 */

import { ACCOUNT_TYPE_TO_PLATFORM, SOCIAL_ACCOUNT_STATUS } from '../config/constants.js';
import { capabilityForAccountType, checkPublishReadiness } from '../publishing/providerCapabilities.js';
import { postCopyIssues } from './contentStyleGuard.js';

export const READINESS = Object.freeze({
  READY: 'ready',
  DRAFT_INCOMPLETE: 'draft_incomplete',
  VALIDATION_FAILED: 'validation_failed',
  ACCOUNT_REQUIRED: 'account_required',
  RECONNECT_REQUIRED: 'reconnect_required',
  MEDIA_REQUIRED: 'media_required',
  MEDIA_UNAVAILABLE: 'media_unavailable',
  SCHEDULE_REQUIRED: 'schedule_required',
  LIVE_PUBLISHING_DISABLED: 'live_publishing_disabled',
  ALREADY_PUBLISHING: 'already_publishing',
  IMMUTABLE_AFTER_SUBMISSION: 'immutable_after_submission',
});

// Per-target publish states that mean the target is past the point of editing.
const IN_FLIGHT = new Set(['publishing', 'submitted', 'reconciling']);
const TERMINAL_PUBLISHED = new Set(['published']);

/**
 * Evaluate one target. Pure — the caller resolves `caption` (override or the
 * platform copy) and `hasMedia` / `mediaAvailable`.
 *
 * @returns {{ status, reason, blocking }} blocking=false only for READY.
 */
export function evaluateTargetReadiness({ accountType, accountStatus, publishStatus, caption, hasMedia, mediaAvailable }) {
  const cap = capabilityForAccountType(accountType);
  if (!cap) {
    return { status: READINESS.ACCOUNT_REQUIRED, reason: 'This account type cannot be published to.', blocking: true };
  }
  const platform = cap.platform;

  // Lifecycle first: a target that is already going out (or has gone out) must
  // not be re-queued or edited.
  if (TERMINAL_PUBLISHED.has(publishStatus)) {
    return { status: READINESS.IMMUTABLE_AFTER_SUBMISSION, reason: 'This account already published; it cannot be changed.', blocking: true };
  }
  if (IN_FLIGHT.has(publishStatus)) {
    return { status: READINESS.ALREADY_PUBLISHING, reason: 'This account is already publishing.', blocking: true };
  }

  if (accountStatus !== SOCIAL_ACCOUNT_STATUS.ACTIVE) {
    return { status: READINESS.RECONNECT_REQUIRED, reason: `Reconnect this ${platform} account to publish.`, blocking: true };
  }

  const text = typeof caption === 'string' ? caption.trim() : '';
  if (!text) {
    return { status: READINESS.DRAFT_INCOMPLETE, reason: 'This account needs post copy before it can go out.', blocking: true };
  }

  // Provider capability: media requirement + hard caption length.
  const r = checkPublishReadiness({ accountType, hasMedia, caption: text });
  if (!r.ok) {
    if (r.category === 'media_required') {
      // A post that references media whose bytes are gone is a different, honest
      // failure than one that never had an image.
      if (hasMedia && !mediaAvailable) {
        return { status: READINESS.MEDIA_UNAVAILABLE, reason: 'The selected image is unavailable. Choose or upload another.', blocking: true };
      }
      return { status: READINESS.MEDIA_REQUIRED, reason: r.reason, blocking: true };
    }
    // A caption over the provider's HARD limit is a real, blocking failure.
    return { status: READINESS.VALIDATION_FAILED, reason: r.reason, blocking: true };
  }

  // Ready. Style bands (word/paragraph guidance) are advisory warnings — shown,
  // never used to block a user from scheduling their own copy.
  const warnings = postCopyIssues(text, platform);
  return { status: READINESS.READY, reason: null, blocking: false, warnings };
}

/**
 * Evaluate a whole post's targets. Returns per-target verdicts plus an overall
 * `ready` (all targets ready and at least one target exists) and human blockers.
 *
 * @param {object} opts
 * @param {Array} opts.targets  post targets (from listPostTargets)
 * @param {object} opts.platformCopy  normalized per-platform copy (postCopy per platform)
 * @param {boolean} opts.hasMedia  whether the post references a media asset
 * @param {boolean} opts.mediaAvailable  whether that asset's bytes are servable
 * @param {boolean} opts.liveEnabled  the ENABLE_LIVE_PROVIDER_PUBLISHING flag
 */
export function evaluatePostReadiness({ targets = [], platformCopy = {}, hasMedia = false, mediaAvailable = true, liveEnabled = false }) {
  const perTarget = targets.map((t) => {
    const platform = ACCOUNT_TYPE_TO_PLATFORM[t.accountType] || null;
    const caption = t.captionOverride || (platform && platformCopy[platform]?.postCopy) || '';
    const verdict = evaluateTargetReadiness({
      accountType: t.accountType,
      accountStatus: t.accountStatus,
      publishStatus: t.publishStatus,
      caption,
      hasMedia,
      mediaAvailable,
    });
    return {
      targetId: t.id,
      platform,
      accountLabel: t.displayName || t.username || platform || 'Account',
      ...verdict,
    };
  });

  const ready = perTarget.length > 0 && perTarget.every((v) => v.status === READINESS.READY);
  const blockers = perTarget.filter((v) => v.blocking).map((v) => ({ targetId: v.targetId, accountLabel: v.accountLabel, status: v.status, reason: v.reason }));
  // Advisory style-band warnings (non-blocking) for ready targets.
  const warnings = perTarget
    .filter((v) => Array.isArray(v.warnings) && v.warnings.length)
    .map((v) => ({ targetId: v.targetId, accountLabel: v.accountLabel, reasons: v.warnings }));
  const notes = [];
  if (!liveEnabled) {
    // Informational, not a blocker: Publish Now still queues honestly; the jobs
    // hold as "attention needed — live publishing disabled" and call no provider.
    notes.push({ status: READINESS.LIVE_PUBLISHING_DISABLED, reason: 'Live publishing is turned off, so nothing is sent to a provider yet.' });
  }
  return { ready, targets: perTarget, blockers, notes, liveEnabled: Boolean(liveEnabled) };
}

export default { READINESS, evaluateTargetReadiness, evaluatePostReadiness };
