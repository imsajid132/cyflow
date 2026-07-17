/**
 * The one place that turns a stored planner item into per-platform copy.
 *
 * WHY THIS EXISTS. platform_captions_json has been the canonical per-platform
 * store since 4.7.2, but the drawer never read it — it showed item.caption, one
 * value, for every platform. So a Threads-only repair changed the stored Threads
 * copy and the drawer showed no difference, and a user could not see, let alone
 * edit, the Instagram and Threads copy independently. This module resolves the
 * canonical store into exactly what the editor needs, for the SELECTED platforms
 * only, and nothing derives from item.caption any more except the legacy
 * fallback below.
 *
 * It is deliberately pure: an item in, a plain object out, no database, no
 * clock. That makes it the same answer on the server (decorateItem), in a test,
 * and — through the decorated item — in the browser.
 *
 * THE SHAPE STORED in platform_captions_json[platform]:
 *   { caption, hashtags, userEdited?, updatedAt? }
 * userEdited and updatedAt are new in C2 and OPTIONAL: an item written before
 * C2 simply has neither, which reads as "not user-edited", the honest default.
 */

import { PLATFORM_VALUES } from '../config/constants.js';
import { postCopyIssues, measurePostCopy } from './contentStyleGuard.js';

/**
 * Resolve ONE platform's stored entry, falling back to the legacy caption.
 *
 * The fallback is read-only and never written back: opening a legacy item must
 * not rewrite it. A pre-C2 item with no platform_captions_json shows its single
 * caption under each selected platform until the next real save/generation,
 * exactly as the queue has always resolved it.
 */
function resolveEntry(item, platform, isPrimary) {
  const stored = item.platformCaptions?.[platform];
  const hasStored = stored && typeof stored.caption === 'string' && stored.caption.trim();
  if (hasStored) {
    return {
      postCopy: stored.caption,
      hashtags: Array.isArray(stored.hashtags) ? stored.hashtags : [],
      userEdited: stored.userEdited === true,
      updatedAt: stored.updatedAt ?? null,
      legacy: false,
    };
  }
  /*
   * No per-platform entry. Fall back to the item's canonical caption — but only
   * for the PRIMARY platform, whose copy `item.caption` actually is. A sibling
   * with no stored entry falls back too (an old single-platform item, or one
   * generated before per-platform copy existed), because showing the shared
   * caption is better than showing an empty box, and it matches how the queue
   * has always published these.
   */
  return {
    postCopy: typeof item.caption === 'string' ? item.caption : '',
    hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
    // A legacy fallback is not a user edit. Only an explicit stored flag is.
    userEdited: false,
    updatedAt: null,
    legacy: true,
    // Marked so the primary can carry the item-level editedFields signal below.
    isPrimary,
  };
}

/**
 * Normalize a stored item into per-platform copy for the SELECTED platforms.
 *
 * @param {object} item a decorated planner item (platformTargets, platformCaptions,
 *        caption, hashtags, editedFields)
 * @returns {{ [platform]: { postCopy, hashtags, userEdited, updatedAt,
 *             validationStatus, validationFailures, measurements } }}
 *          Only selected, supported platforms appear. An unselected platform is
 *          never invented; a bogus platform in the stored JSON is ignored.
 */
export function normalizePlatformCopy(item) {
  const out = {};
  const targets = Array.isArray(item.platformTargets) ? item.platformTargets : [];
  const primary = targets[0] ?? null;

  for (const platform of targets) {
    // Only real, supported platforms. This is the read-side half of "an
    // unselected platform is never shown": even if the stored JSON somehow holds
    // a facebook entry, an instagram+threads item never surfaces it.
    if (!PLATFORM_VALUES.includes(platform)) continue;

    const entry = resolveEntry(item, platform, platform === primary);

    /*
     * The legacy PRIMARY inherits the item-level editedFields signal.
     *
     * Before C2, a manual caption edit set editedFields=['caption'] on the item
     * and wrote item.caption. That edit was real and belongs to the primary
     * platform, so a legacy item whose caption the user edited shows the primary
     * as user-edited. Siblings never inherit it: the old flag could not
     * distinguish platforms, so attributing it to a sibling would be a guess.
     */
    if (entry.legacy && entry.isPrimary && Array.isArray(item.editedFields) && item.editedFields.includes('caption')) {
      entry.userEdited = true;
    }

    const issues = postCopyIssues(entry.postCopy, platform);
    const m = measurePostCopy(entry.postCopy, platform);

    out[platform] = {
      postCopy: entry.postCopy,
      hashtags: entry.hashtags,
      userEdited: entry.userEdited,
      updatedAt: entry.updatedAt,
      validationStatus: issues.length === 0 ? 'passed' : 'failed',
      validationFailures: issues,
      // Live measurements so the editor shows counts without re-deriving rules.
      measurements: m
        ? {
          words: m.words,
          proseParagraphs: m.paragraphs,
          listItems: m.listItems ?? 0,
          longestParagraph: m.longestParagraph,
          minWords: m.rules.MIN_WORDS,
          maxWords: m.rules.MAX_WORDS,
          minParagraphs: m.rules.MIN_PARAGRAPHS,
          maxParagraphs: m.rules.MAX_PARAGRAPHS,
        }
        : null,
    };
  }
  return out;
}

/**
 * Merge one platform's edit into the stored platform_captions_json shape.
 *
 * Returns the FULL platformCaptions object to persist: the edited platform
 * updated, every sibling copied through byte-for-byte. This is the guarantee
 * that "editing Threads changes only Threads" is enforced in data, not just
 * hoped for in the UI — a sibling is written back exactly as it was read.
 *
 * @param {object} item the current item
 * @param {string} platform the platform being edited
 * @param {{ postCopy, hashtags }} edit the new copy
 * @param {string|null} nowIso timestamp for updatedAt (caller supplies; this
 *        module has no clock)
 */
export function applyPlatformEdit(item, platform, edit, nowIso = null) {
  const current = normalizePlatformCopy(item);
  const next = {};
  for (const p of Object.keys(current)) {
    if (p === platform) {
      next[p] = {
        caption: edit.postCopy,
        hashtags: Array.isArray(edit.hashtags) ? edit.hashtags : [],
        userEdited: true,
        updatedAt: nowIso,
      };
    } else {
      // Copied through unchanged, INCLUDING its userEdited flag. A sibling is
      // never touched by an edit to another platform.
      next[p] = {
        caption: current[p].postCopy,
        hashtags: current[p].hashtags,
        userEdited: current[p].userEdited,
        updatedAt: current[p].updatedAt,
      };
    }
  }
  return next;
}

export default { normalizePlatformCopy, applyPlatformEdit };
