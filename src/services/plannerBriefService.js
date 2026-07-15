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
  PLANNER_FORMATS,
  PLANNER_FORMAT_LABELS,
  PLANNER_GOALS,
  PLANNER_TONES,
  PLANNER_TONE_TO_CONTENT_TONE,
  PLANNER_CTA_MODES,
  FORMAT_TEMPLATES,
  CONTENT_TONES,
  PLANNER_LIMITS,
} from '../config/constants.js';

/**
 * Default weights when a user has not customised their mix.
 *
 * Keyed by strategic FORMAT. The spread deliberately favours teaching over
 * selling: a plan of seven service adverts is the failure mode this replaces.
 */
export const DEFAULT_CONTENT_MIX = Object.freeze({
  educational_insight: 3,
  quick_tip: 2,
  common_mistake: 2,
  checklist: 2,
  comparison: 1,
  myth_fact: 1,
  process: 1,
  faq_answer: 1,
  authority: 1,
  service_benefit: 1,
  local_relevance: 1,
  soft_promo: 1,
});

/**
 * The legacy Phase 4.7 content types map onto formats, so a saved content mix
 * from before this phase still means something.
 */
export const LEGACY_TYPE_TO_FORMAT = Object.freeze({
  educational: 'educational_insight',
  tips: 'quick_tip',
  authority: 'authority',
  promotional: 'soft_promo',
  cta: 'service_benefit',
  proof: 'authority',
  local: 'local_relevance',
  comparison: 'comparison',
});

export const DEFAULT_GOALS = Object.freeze(['awareness', 'engagement', 'education']);

/**
 * Structural framing per content type. These shape HOW the copy is built so two
 * posts of the same type still differ; they are guidance for the writer, never
 * claims about the business.
 */
const ANGLES = Object.freeze({
  educational_insight: [
    'explain one thing people usually get wrong about this, and why it matters',
    'explain what actually drives the result people are chasing',
    'explain what a common warning sign really means',
  ],
  quick_tip: [
    'one action the reader can take today, and what it changes',
    'the smallest useful change with the biggest effect',
    'a five minute check worth doing now',
  ],
  common_mistake: [
    'one specific mistake, why it happens, and what to do instead',
    'the shortcut that costs more later',
  ],
  myth_fact: [
    'a belief people hold about this, and what is actually true',
    'why a popular rule of thumb is out of date',
  ],
  checklist: [
    'the concrete checks worth running on this',
    'what to look at before committing to the work',
  ],
  comparison: [
    'two honest options with real trade-offs',
    'the fast route against the durable route',
  ],
  process: [
    'the real steps, in order, and what happens at each',
    'what actually happens once work starts',
  ],
  service_benefit: [
    'what this service changes for the client, concretely',
    'who this suits and who it does not',
  ],
  local_relevance: [
    'why the local context changes the answer here',
    'what businesses in this area keep running into',
  ],
  faq_answer: [
    'answer one question clients genuinely ask, directly',
    'the question people ask last that they should ask first',
  ],
  authority: [
    'a standard worth holding, and why',
    'something experience taught that is not obvious',
  ],
  soft_promo: [
    'describe the work plainly and who it suits',
    'what is involved, without overselling it',
  ],
});

/**
 * The audience problem each format speaks to. Rotated per post so seven posts
 * about one service still answer seven different worries.
 */
const AUDIENCE_PROBLEMS = Object.freeze([
  'they are not sure what is actually worth paying for',
  'they have tried this before and it did not work',
  'they cannot tell good work from bad work here',
  'they do not know what to check first',
  'they think this is simpler than it is',
  'they think this is harder than it is',
  'they are worried about wasting money on it',
  'they do not know how long it should take',
]);

/**
 * Normalize a saved mix to formats. A Phase 4.7 mix keyed by content type is
 * translated rather than discarded, so upgrading does not reset a user's setup.
 */
export function normalizeMix(mix) {
  if (!mix || typeof mix !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(mix)) {
    const weight = Number(value);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const format = PLANNER_FORMATS.includes(key)
      ? key
      : LEGACY_TYPE_TO_FORMAT[key] || null;
    if (!format) continue;
    // Two legacy types can map onto one format; take the larger weight.
    out[format] = Math.max(out[format] || 0, weight);
  }
  return Object.keys(out).length ? out : null;
}

/** Deal `count` formats from weights, avoiding immediate repeats. */
export function dealContentTypes(mix, count) {
  const normalized = normalizeMix(mix);
  const weights = {};
  for (const format of PLANNER_FORMATS) {
    const raw = Number(normalized?.[format]);
    if (Number.isFinite(raw) && raw > 0) weights[format] = raw;
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

  /*
   * Build the pool, then spread it by the LAYOUT each format produces. Spreading
   * by format alone still lets two formats that share a layout (comparison and
   * myth/fact) sit next to each other and render the same design twice.
   */
  const pool = [];
  for (const { type, n } of allocation) for (let k = 0; k < n; k += 1) pool.push(type);
  return spread(diversifyLayouts(pool, weights), primaryTemplateOf).slice(0, count);
}

/**
 * Trade duplicate layouts for unused ones until the plan shows enough designs.
 *
 * Weighting alone cannot deliver this. With the default mix, largest-remainder
 * hands a 7-day plan seven different FORMATS that collapse onto four LAYOUTS,
 * because several formats legitimately share one design: a comparison and a
 * myth/fact post are both two columns. The result is a week where the same four
 * pictures cycle, which is what makes generated output look generated.
 *
 * So layout coverage is stated as a constraint and solved for, rather than being
 * hoped for from weights that were tuned for something else.
 *
 * Two rules keep this honest:
 *   - it only ever swaps in a format the user weighted ABOVE ZERO, so it cannot
 *     smuggle a post type they turned off into their plan;
 *   - the target is capped by what their mix can actually reach, so a mix of two
 *     formats yields two layouts and no error.
 *
 * The format given up is the lowest-weighted one in an over-used layout, so the
 * user's emphasis survives the trade.
 */
export function diversifyLayouts(pool, weights) {
  const reachable = new Set(Object.keys(weights).map(primaryTemplateOf));
  const target = Math.min(PLANNER_LIMITS.MIN_DISTINCT_LAYOUTS, reachable.size, pool.length);

  const distinctIn = (items) => new Set(items.map(primaryTemplateOf)).size;
  const out = [...pool];

  // Bounded by the pool: each pass either adds a layout or stops.
  for (let guard = 0; guard < out.length && distinctIn(out) < target; guard += 1) {
    const used = new Set(out.map(primaryTemplateOf));
    const missing = [...reachable].filter((layout) => !used.has(layout));
    if (missing.length === 0) break;

    // Prefer the format the user weighted highest among those that would
    // introduce a layout the plan does not yet have.
    const incoming = Object.keys(weights)
      .filter((format) => missing.includes(primaryTemplateOf(format)))
      .sort((a, b) => weights[b] - weights[a])[0];
    if (!incoming) break;

    // Give up a duplicate, never a format that is the only one of its layout.
    const layoutCounts = new Map();
    for (const format of out) {
      const layout = primaryTemplateOf(format);
      layoutCounts.set(layout, (layoutCounts.get(layout) || 0) + 1);
    }
    const donorIndex = out
      .map((format, index) => ({ format, index }))
      .filter(({ format }) => layoutCounts.get(primaryTemplateOf(format)) > 1)
      .sort((a, b) => (weights[a.format] ?? 0) - (weights[b.format] ?? 0))[0]?.index;
    if (donorIndex === undefined) break;

    out[donorIndex] = incoming;
  }
  return out;
}

/**
 * Re-order a multiset so equal neighbours are avoided where possible: repeatedly
 * take the most frequent remaining item whose KEY differs from the previous
 * pick's key.
 *
 * `keyFn` exists because two different formats can still produce the same
 * layout — a comparison post and a myth/fact post are both two columns. Keying
 * on the format alone would happily place them side by side and the plan would
 * show the same design twice in a row.
 */
export function spread(items, keyFn = (item) => item) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  const out = [];
  let previousKey = null;
  while (out.length < items.length) {
    const candidates = [...counts.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    if (candidates.length === 0) break;
    // Prefer the most common item whose key is not a repeat of the last one.
    const pick = candidates.find(([item]) => keyFn(item) !== previousKey) || candidates[0];
    out.push(pick[0]);
    counts.set(pick[0], pick[1] - 1);
    previousKey = keyFn(pick[0]);
  }
  return out;
}

/** The layout a format reaches for first — its identity for spreading. */
function primaryTemplateOf(format) {
  const candidates = FORMAT_TEMPLATES[format] || FORMAT_TEMPLATES[LEGACY_TYPE_TO_FORMAT[format]];
  return Array.isArray(candidates) ? candidates[0] : 'editorial-insight';
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

/**
 * Pick the layout for a format.
 *
 * The layout follows the content: a checklist gets a list, a comparison gets
 * two columns. Where a format has more than one layout that can genuinely carry
 * it, they alternate so the same structure does not run back to back — but the
 * planner never reaches for a layout that misfits the content merely to look
 * varied.
 *
 * @param {string} format
 * @param {number} occurrenceIndex how many times this format has been used
 * @param {string|null} previousTemplate the template on the previous post
 */
export function templateForContentType(format, occurrenceIndex = 0, previousTemplate = null) {
  const candidates = FORMAT_TEMPLATES[format]
    || FORMAT_TEMPLATES[LEGACY_TYPE_TO_FORMAT[format]]
    || ['editorial-insight'];

  const chosen = candidates[occurrenceIndex % candidates.length];
  // Avoid a back-to-back repeat when the format offers a real alternative.
  if (chosen === previousTemplate && candidates.length > 1) {
    return candidates[(occurrenceIndex + 1) % candidates.length];
  }
  return chosen;
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
  const location = [profile?.city, profile?.region].filter(Boolean).join(', ') || null;

  // How many times each format has been used so far, for template alternation.
  const seenType = new Map();
  let previousTemplate = null;

  const briefs = [];
  for (let i = 0; i < count; i += 1) {
    const contentType = contentTypes[i] || 'educational_insight';
    const occurrence = seenType.get(contentType) || 0;
    seenType.set(contentType, occurrence + 1);

    const service = pick(services, i, null);
    const goal = pick(activeGoals, i, 'awareness');
    const angleList = ANGLES[contentType] || ANGLES.educational_insight;
    const angle = pick(angleList, occurrence, angleList[0]);
    const audienceProblem = pick(AUDIENCE_PROBLEMS, i, AUDIENCE_PROBLEMS[0]);
    const includeCta = ctaForPosition(ctaMode, i);
    const resolvedTone = toneForPosition(tone, i);
    const templateKey = templateForContentType(contentType, occurrence, previousTemplate);
    previousTemplate = templateKey;

    briefs.push({
      slot: slots[i],
      position: i,
      // `format` is the strategic shape; `contentType` is kept as an alias so
      // storage and the Phase 4.7 API surface keep working unchanged.
      format: contentType,
      contentType,
      formatLabel: PLANNER_FORMAT_LABELS[contentType] || 'Insight',
      goal,
      angle,
      audienceProblem,
      serviceEmphasis: service,
      location: contentType === 'local_relevance' ? location : null,
      tone: CONTENT_TONES.includes(resolvedTone) ? resolvedTone : 'professional',
      includeCta,
      callToAction: includeCta ? profile?.defaultCallToAction || null : null,
      templateKey,
      platforms: [...platforms],
      // The instruction text handed to the writer as DATA, never as commands.
      brief: composeBriefText({ contentType, angle, service, goal, audienceProblem, profile }),
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
export function composeBriefText({ contentType, angle, service, goal, audienceProblem, profile }) {
  const parts = [];
  parts.push(`Format: ${contentType.replace(/_/g, ' ')}.`);
  parts.push(`Angle: ${angle}.`);
  if (audienceProblem) parts.push(`The reader's problem: ${audienceProblem}.`);
  if (goal) parts.push(`Objective: ${goal.replace(/_/g, ' ')}.`);
  if (service) parts.push(`This post is about this service: ${service}.`);
  if (profile?.businessCategory) parts.push(`Business category: ${profile.businessCategory}.`);
  if (profile?.businessDescription) parts.push(`About the business: ${profile.businessDescription}`);
  const location = [profile?.city, profile?.region].filter(Boolean).join(', ');
  if (location) parts.push(`Serves: ${location}.`);
  return parts.join(' ').slice(0, PLANNER_LIMITS.BRIEF_MAX);
}

export default {
  buildBriefSet,
  dealContentTypes,
  normalizeMix,
  spread,
  ctaForPosition,
  toneForPosition,
  templateForContentType,
  composeBriefText,
  DEFAULT_CONTENT_MIX,
  DEFAULT_GOALS,
};
