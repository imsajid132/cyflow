/**
 * Planner brief builder — decides WHAT each post in a plan is about.
 *
 * This runs before any OpenAI call and is pure: given preferences, a business
 * profile and a slot list, it deterministically produces one brief per slot.
 * Keeping it pure means the variation rules (which is where repetitive plans
 * actually come from) are directly testable without spending a token.
 *
 * Variation is engineered, not hoped for. Rather than asking a model for
 * "7 different posts" and trusting it, the plan is dealt out in advance:
 *
 *   content type  — a weighted deal from the user's mix, spread so the same
 *                   type never lands twice in a row where avoidable
 *   goal          — rotated through the user's selected goals
 *   service       — rotated through the business's services, so week one does
 *                   not talk about gutters seven times
 *   tone          — rotated when the user picked "mixed"
 *   CTA           — placed per the CTA mode, not on every post
 *   template      — alternated within a content type so two tips posts do not
 *                   look identical
 *   angle         — a structural framing hint per content type
 *
 * The uniqueness engine is the safety net; this is the prevention.
 */

import {
  PLANNER_CONTENT_TYPES,
  PLANNER_GOALS,
  PLANNER_TONES,
  PLANNER_TONE_TO_CONTENT_TONE,
  PLANNER_CTA_MODES,
  CONTENT_TYPE_TEMPLATES,
  CONTENT_TYPE_TEMPLATE_ALTERNATES,
  CONTENT_TONES,
  PLANNER_LIMITS,
} from '../config/constants.js';

/** Default weights when a user has not customised their mix. */
export const DEFAULT_CONTENT_MIX = Object.freeze({
  educational: 3,
  tips: 2,
  authority: 2,
  promotional: 2,
  cta: 2,
  proof: 1,
  local: 1,
  comparison: 1,
});

export const DEFAULT_GOALS = Object.freeze(['awareness', 'engagement', 'education']);

/**
 * Structural framing per content type. These shape HOW the copy is built so two
 * posts of the same type still differ; they are guidance for the writer, never
 * claims about the business.
 */
const ANGLES = Object.freeze({
  educational: [
    'explain how something works in plain language',
    'answer a question customers often ask',
    'explain what a warning sign means',
  ],
  tips: [
    'a short numbered checklist the reader can act on',
    'a seasonal maintenance list',
    'common mistakes to avoid',
  ],
  authority: [
    'what experience has taught the team',
    'why the team does it a particular way',
    'a standard the trade should meet',
  ],
  promotional: [
    'introduce a service and who it suits',
    'describe what a job actually involves',
    'explain what is included',
  ],
  cta: [
    'invite the reader to take one clear next step',
    'make it easy to get in touch',
  ],
  proof: [
    'lead with one concrete figure the business supplied',
    'describe a completed job without naming a client',
  ],
  local: [
    'why the local area affects this service',
    'what local properties commonly need',
  ],
  comparison: [
    'compare two honest options side by side',
    'contrast the cheap route with the durable route',
  ],
});

/** Deal `count` content types from weights, avoiding immediate repeats. */
export function dealContentTypes(mix, count) {
  const weights = {};
  for (const type of PLANNER_CONTENT_TYPES) {
    const raw = Number(mix?.[type]);
    if (Number.isFinite(raw) && raw > 0) weights[type] = raw;
  }
  const active = Object.keys(weights);
  if (active.length === 0) return dealContentTypes(DEFAULT_CONTENT_MIX, count);

  /*
   * Largest-remainder allocation: give each type its share of the plan, then
   * hand any rounding leftovers to the types that were rounded down hardest.
   * This keeps a 3:1 mix actually 3:1 across seven posts instead of drifting.
   */
  const total = active.reduce((sum, t) => sum + weights[t], 0);
  const exact = active.map((type) => ({ type, share: (weights[type] / total) * count }));
  const allocation = exact.map((e) => ({ type: e.type, n: Math.floor(e.share), rem: e.share % 1 }));
  let assigned = allocation.reduce((sum, a) => sum + a.n, 0);
  allocation.sort((a, b) => b.rem - a.rem);
  let i = 0;
  while (assigned < count && allocation.length > 0) {
    allocation[i % allocation.length].n += 1;
    assigned += 1;
    i += 1;
  }

  // Build the pool, then spread it so the same type does not run consecutively.
  const pool = [];
  for (const { type, n } of allocation) for (let k = 0; k < n; k += 1) pool.push(type);
  return spread(pool).slice(0, count);
}

/**
 * Re-order a multiset so equal neighbours are avoided where possible: repeatedly
 * take the most frequent remaining item that differs from the previous pick.
 */
export function spread(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  const out = [];
  let previous = null;
  while (out.length < items.length) {
    const candidates = [...counts.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    if (candidates.length === 0) break;
    // Prefer the most common item that is not a repeat of the last one.
    const pick = candidates.find(([type]) => type !== previous) || candidates[0];
    out.push(pick[0]);
    counts.set(pick[0], pick[1] - 1);
    previous = pick[0];
  }
  return out;
}

/** Should this position carry a CTA? */
export function ctaForPosition(mode, index) {
  switch (mode) {
    case 'always':
      return true;
    case 'light':
      // Roughly one in three.
      return index % 3 === 0;
    case 'some':
    default:
      // Every other post.
      return index % 2 === 0;
  }
}

/** Resolve the tone for one post; "mixed" rotates through the real tones. */
export function toneForPosition(tone, index) {
  if (tone !== 'mixed') {
    return PLANNER_TONE_TO_CONTENT_TONE[tone] || 'professional';
  }
  const rotation = ['professional', 'friendly', 'informative', 'bold'];
  return rotation[index % rotation.length];
}

/** Pick the image template for a content type, alternating within the type. */
export function templateForContentType(contentType, occurrenceIndex = 0) {
  const alternates = CONTENT_TYPE_TEMPLATE_ALTERNATES[contentType];
  if (Array.isArray(alternates) && alternates.length) {
    return alternates[occurrenceIndex % alternates.length];
  }
  return CONTENT_TYPE_TEMPLATES[contentType] || 'editorial-premium';
}

function pick(list, index, fallback = null) {
  if (!Array.isArray(list) || list.length === 0) return fallback;
  return list[index % list.length];
}

/**
 * Build one brief per slot.
 *
 * @param {{ slots, preferences, profile, platforms }} input
 * @returns {Array<object>} briefs aligned 1:1 with slots
 */
export function buildBriefSet({ slots = [], preferences = {}, profile = null, platforms = [] } = {}) {
  const count = Math.min(slots.length, PLANNER_LIMITS.MAX_ITEMS_PER_RUN);
  const mix = preferences.contentMix && Object.keys(preferences.contentMix).length
    ? preferences.contentMix
    : DEFAULT_CONTENT_MIX;
  const goals = Array.isArray(preferences.goals) && preferences.goals.length
    ? preferences.goals.filter((g) => PLANNER_GOALS.includes(g))
    : [...DEFAULT_GOALS];
  const activeGoals = goals.length ? goals : [...DEFAULT_GOALS];

  const tone = PLANNER_TONES.includes(preferences.tone) ? preferences.tone : 'professional';
  const ctaMode = PLANNER_CTA_MODES.includes(preferences.ctaMode) ? preferences.ctaMode : 'some';

  const services = Array.isArray(profile?.services) ? profile.services.filter(Boolean) : [];
  const contentTypes = dealContentTypes(mix, count);

  // How many times each type has been used so far, for template alternation.
  const seenType = new Map();

  const briefs = [];
  for (let i = 0; i < count; i += 1) {
    const contentType = contentTypes[i] || 'educational';
    const occurrence = seenType.get(contentType) || 0;
    seenType.set(contentType, occurrence + 1);

    const service = pick(services, i, null);
    const goal = pick(activeGoals, i, 'awareness');
    const angleList = ANGLES[contentType] || ANGLES.educational;
    const angle = pick(angleList, occurrence, angleList[0]);
    const includeCta = ctaForPosition(ctaMode, i);
    const resolvedTone = toneForPosition(tone, i);

    briefs.push({
      slot: slots[i],
      position: i,
      contentType,
      goal,
      angle,
      serviceEmphasis: service,
      tone: CONTENT_TONES.includes(resolvedTone) ? resolvedTone : 'professional',
      includeCta,
      callToAction: includeCta ? profile?.defaultCallToAction || null : null,
      templateKey: templateForContentType(contentType, occurrence),
      platforms: [...platforms],
      // The instruction text handed to the writer as DATA, never as commands.
      brief: composeBriefText({ contentType, angle, service, goal, profile }),
    });
  }
  return briefs;
}

/**
 * The human-readable brief for one post.
 *
 * Only facts the business actually gave us are included. Nothing here invents a
 * price, guarantee, statistic, or credential — the writer is explicitly told to
 * work from this data alone.
 */
export function composeBriefText({ contentType, angle, service, goal, profile }) {
  const parts = [];
  parts.push(`Post type: ${contentType}.`);
  parts.push(`Angle: ${angle}.`);
  if (goal) parts.push(`Goal: ${goal.replace(/_/g, ' ')}.`);
  if (service) parts.push(`Focus on this service: ${service}.`);
  if (profile?.businessCategory) parts.push(`Business category: ${profile.businessCategory}.`);
  if (profile?.businessDescription) parts.push(`About the business: ${profile.businessDescription}`);
  const location = [profile?.city, profile?.region].filter(Boolean).join(', ');
  if (location) parts.push(`Serves: ${location}.`);
  return parts.join(' ').slice(0, PLANNER_LIMITS.BRIEF_MAX);
}

export default {
  buildBriefSet,
  dealContentTypes,
  spread,
  ctaForPosition,
  toneForPosition,
  templateForContentType,
  composeBriefText,
  DEFAULT_CONTENT_MIX,
  DEFAULT_GOALS,
};
