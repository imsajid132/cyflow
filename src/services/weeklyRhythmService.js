/**
 * Weekly content rhythm — resolves WHICH strategy each calendar weekday carries.
 *
 * This is the layer the previous planner did not have. The old brief builder
 * dealt formats by position, so a Thursday-to-Saturday plan started with
 * whatever came first in the deal, and every short plan looked the same. A
 * rhythm ties strategy to the actual weekday: Thursday is Problem and Solution
 * because it is Thursday, not because it is the fourth slot.
 *
 * Everything here is pure. Given a preset and a saved custom rhythm it produces
 * a resolved snapshot, and given a snapshot and an ISO weekday it names the
 * pillar. No dates, no I/O, no model — so the mapping is directly testable and
 * the snapshot can be frozen onto a run and never drift.
 */

import {
  CONTENT_PILLARS,
  CONTENT_PILLAR_LABELS,
  CONTENT_PILLAR_PURPOSE,
  PILLAR_FORMATS,
  PILLAR_VISUAL_FAMILIES,
  VISUAL_FAMILIES,
  COMPLEMENTARY_PILLARS,
  RHYTHM_PRESETS,
  RHYTHM_PRESET_PILLARS,
  RHYTHM_CTA_MODES,
  PLANNER_FORMATS,
} from '../config/constants.js';

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_PRESET = 'balanced';

function validPillar(value) {
  return typeof value === 'string' && CONTENT_PILLARS.includes(value) ? value : null;
}

function validFormat(value) {
  return typeof value === 'string' && PLANNER_FORMATS.includes(value) ? value : null;
}

function validFamily(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VISUAL_FAMILIES, value)
    ? value
    : null;
}

function validCtaMode(value) {
  return typeof value === 'string' && RHYTHM_CTA_MODES.includes(value) ? value : null;
}

export function isPreset(value) {
  return typeof value === 'string' && RHYTHM_PRESETS.includes(value);
}

/**
 * Resolve a preset plus per-weekday overrides into a frozen 7-day snapshot.
 *
 * The snapshot is what a run stores. Each weekday is fully specified so nothing
 * downstream has to re-derive a default, and a later change to the user's saved
 * rhythm can never rewrite a plan that already resolved.
 *
 * @param {{ preset?: string, customRhythm?: object }} input
 *        customRhythm is keyed by ISO weekday (1..7); each entry may set
 *        { enabled, pillar, format, ctaMode, visualFamily, locked }.
 * @returns {{ preset, weekdays: Record<number, object> }}
 */
export function resolveRhythm({ preset, customRhythm } = {}) {
  const resolvedPreset = isPreset(preset) ? preset : DEFAULT_PRESET;
  const base = RHYTHM_PRESET_PILLARS[resolvedPreset] || RHYTHM_PRESET_PILLARS[DEFAULT_PRESET];
  const overrides = customRhythm && typeof customRhythm === 'object' ? customRhythm : {};

  const weekdays = {};
  for (const weekday of ISO_WEEKDAYS) {
    const override = overrides[weekday] || overrides[String(weekday)] || {};
    const pillar = validPillar(override.pillar) || base[weekday] || 'educational_insight';
    weekdays[weekday] = Object.freeze({
      weekday,
      enabled: override.enabled === false ? false : true,
      pillar,
      // A preferred format/family is optional. Null means "let the planner pick
      // from the pillar's eligible set", which is what keeps week-to-week
      // variation alive.
      format: validFormat(override.format),
      visualFamily: validFamily(override.visualFamily),
      ctaMode: validCtaMode(override.ctaMode) || 'automatic',
      locked: override.locked === true,
    });
  }

  return Object.freeze({ preset: resolvedPreset, weekdays: Object.freeze(weekdays) });
}

/** The resolved config for one ISO weekday, from a snapshot. */
export function weekdayConfig(snapshot, isoWeekday) {
  if (!snapshot || !snapshot.weekdays) return null;
  return snapshot.weekdays[isoWeekday] || snapshot.weekdays[String(isoWeekday)] || null;
}

/**
 * The pillar sequence for one day's posts.
 *
 * The first post carries the weekday's own pillar; each additional post steps
 * through that pillar's complements, skipping any already used, so a two- or
 * three-post day spreads across purposes instead of repeating one.
 */
export function pillarSequenceForDay(primaryPillar, count) {
  const pillar = validPillar(primaryPillar) || 'educational_insight';
  const out = [pillar];
  const complements = COMPLEMENTARY_PILLARS[pillar] || [];
  let ci = 0;
  while (out.length < Math.max(1, count)) {
    const next = complements[ci % complements.length];
    ci += 1;
    if (next && !out.includes(next)) out.push(next);
    else if (ci > complements.length + count) {
      // Exhausted distinct complements; fall back to any unused pillar so we
      // never loop forever, and never silently drop a requested post.
      const spare = CONTENT_PILLARS.find((p) => !out.includes(p));
      out.push(spare || pillar);
    }
  }
  return out.slice(0, Math.max(1, count));
}

/** The formats a pillar admits, first being the most natural. */
export function formatsForPillar(pillar) {
  return PILLAR_FORMATS[validPillar(pillar) || 'educational_insight'] || ['educational_insight'];
}

/** The visual families a pillar admits, first being the most natural. */
export function visualFamiliesForPillar(pillar) {
  return PILLAR_VISUAL_FAMILIES[validPillar(pillar) || 'educational_insight'] || ['editorial_insight'];
}

/**
 * Resolve a visual family key to a concrete layout id.
 *
 * A family that needs a verified figure (verified_stat) falls back to a safe
 * default when none was supplied, because a stat layout with no stat is the
 * "fake statistic" failure the creative rules forbid.
 */
export function familyLayout(familyKey, { hasStat = false, fallback = 'editorial-insight' } = {}) {
  const family = VISUAL_FAMILIES[familyKey];
  if (!family) return fallback;
  if (family.requiresStat && !hasStat) return fallback;
  return family.layout;
}

/** Human labels, for the wizard's rhythm preview and the review board. */
export function describeRhythm(snapshot) {
  if (!snapshot || !snapshot.weekdays) return [];
  return ISO_WEEKDAYS.map((weekday) => {
    const config = snapshot.weekdays[weekday];
    return {
      weekday,
      enabled: config?.enabled !== false,
      pillar: config?.pillar || null,
      pillarLabel: config ? CONTENT_PILLAR_LABELS[config.pillar] || null : null,
      purpose: config ? CONTENT_PILLAR_PURPOSE[config.pillar] || null : null,
    };
  });
}

export default {
  resolveRhythm,
  weekdayConfig,
  pillarSequenceForDay,
  formatsForPillar,
  visualFamiliesForPillar,
  familyLayout,
  describeRhythm,
  isPreset,
};
