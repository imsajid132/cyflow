/**
 * The weekly rhythm and post-type strategy extracted from the Make.com
 * "Daily Content Generator (Multi-Platform)" scenarios.
 *
 * Seven scenarios were inspected (see design-references/make-scenario/extracted/).
 * Six are local trade businesses and one is a knowledge business, and the split
 * is real: the contractor scenarios open on a service and close on a phone
 * number, while the SaaS one opens on an idea and closes on a booking link.
 * Forcing one on the other produces the tonally wrong post, so there are two
 * strategies here and no more — a strategy per business would be eight
 * hardcoded workflows wearing a different hat.
 *
 * WHAT WAS TAKEN. The day-of-week rotation itself, which is the thing that
 * makes a week read like a week rather than seven variations of Monday. Each
 * day carries a purpose AND a paired visual concept, because in the source the
 * two switch expressions move together: a stat day gets a stat card, a checklist
 * day gets a cheatsheet. That pairing is why the images look considered.
 *
 * FRIDAY IS GATED, NOT FABRICATED. Friday's `customer_testimonial`, present in
 * five of the six contractor scenarios, renders a five-star card carrying a
 * customer quote, name, location and initials that the model invents. A
 * fabricated review of a real business is forbidden by the product's own copy
 * rules. So Friday runs the testimonial card ONLY when the workspace has a real
 * stored review to feature (see resolveWeek); with none, it falls back to the
 * `maintenance_tip` the sixth scenario had already substituted. The review is
 * never generated: the card is fed the business's own stored review or it does
 * not appear.
 *
 * NOTHING BUSINESS-SPECIFIC LIVES HERE. The source scenarios hardcoded a name,
 * a service list, a borough list, a phone number and a palette into every
 * prompt and every template. All of that is now read from the workspace's own
 * business profile and brand kit; this module contributes strategy only.
 */
import { PLANNER_FORMAT_LABELS } from '../config/constants.js';

/**
 * The niches that earn a distinct strategy.
 *
 * Two, because the evidence supports two. Adding a third on a hunch would mean
 * maintaining a rhythm nobody has ever seen produce a good week.
 */
export const NICHES = Object.freeze({
  LOCAL_SERVICE: 'local_service',
  KNOWLEDGE_BUSINESS: 'knowledge_business',
});

/**
 * How a day type is written and what it is for.
 *
 * `format` maps onto the planner's existing format vocabulary so the rest of the
 * pipeline — layout choice, validators, the board — keeps working unchanged.
 * `imageConcept` is the Make card name; `layoutHint` is the Cyflow layout that
 * carries the same structure.
 *
 * `openingGuidance` and `ctaType` exist because the extracted prompts got their
 * variety from instruction, not from temperature alone. A day that says "open on
 * the symptom the customer noticed" produces a different first line from one
 * that says "open on the belief that is wrong".
 */
export const DAY_TYPES = Object.freeze({
  service_spotlight: {
    label: 'Service Spotlight',
    purpose: 'explain one service properly, what it fixes and what it involves',
    format: 'service_benefit',
    imageConcept: 'service_card',
    layoutHint: 'service-authority',
    openingGuidance: 'open on the problem this service exists to solve',
    ctaType: 'direct',
    headlineStyle: 'service_name_plus_outcome',
  },
  trust_stat: {
    label: 'Trust and Proof',
    purpose: 'establish competence using only facts the business actually gave',
    format: 'authority',
    imageConcept: 'stat_card',
    layoutHint: 'stat-highlight',
    openingGuidance: 'open on the standard or number that matters, never an invented one',
    ctaType: 'soft',
    headlineStyle: 'single_number_or_standard',
  },
  code_tip: {
    label: 'Rules and Requirements',
    purpose: 'explain a rule, code or requirement the customer is subject to',
    format: 'educational_insight',
    imageConcept: 'cheatsheet',
    layoutHint: 'checklist-guide',
    openingGuidance: 'open on what the customer is required to do and did not know',
    ctaType: 'soft',
    headlineStyle: 'requirement_summary',
  },
  project_showcase: {
    label: 'Work and Process',
    purpose: 'walk through how the work is actually done, start to finish',
    format: 'process',
    imageConcept: 'project_card',
    layoutHint: 'numbered-steps',
    openingGuidance: 'open on the stage customers most often misunderstand',
    ctaType: 'direct',
    headlineStyle: 'process_stage',
  },
  maintenance_tip: {
    /*
     * Friday. This replaces `customer_testimonial`, which fabricated a review.
     * The brick pointing scenario made the same substitution before this
     * migration existed, which is the precedent being followed rather than a
     * preference being imposed.
     */
    label: 'Maintenance and Upkeep',
    purpose: 'give the reader something they can check or do themselves',
    format: 'quick_tip',
    imageConcept: 'cheatsheet',
    layoutHint: 'checklist-tips',
    openingGuidance: 'open on the thing worth checking before it becomes expensive',
    ctaType: 'none',
    headlineStyle: 'imperative_action',
  },
  pro_tip_warning: {
    label: 'Mistake to Avoid',
    purpose: 'name a common, costly mistake and what to do instead',
    format: 'common_mistake',
    imageConcept: 'warning_card',
    // The warning concept renders on the comparison layout: a mistake and its
    // fix are two columns, which is the structure this layout already draws.
    layoutHint: 'comparison-cards',
    openingGuidance: 'open on the shortcut that looks sensible and is not',
    ctaType: 'soft',
    headlineStyle: 'mistake_named',
  },
  brand_insight: {
    label: 'How We Think',
    purpose: 'say what the business believes about doing the work properly',
    format: 'soft_promo',
    imageConcept: 'quote_card',
    layoutHint: 'light-editorial',
    openingGuidance: 'open on the standard the business holds itself to',
    ctaType: 'soft',
    headlineStyle: 'short_statement',
  },
  testimonial_spotlight: {
    /*
     * Friday's exact-parity day type: the Make contractor scenarios ran a
     * five-star review card here. It renders ONLY when the workspace has a real
     * stored review to quote; with none, Friday falls back to maintenance_tip.
     * A review is never invented, because a fabricated review of a real business
     * is barred by the product's copy rules. The copy is built from the stored
     * review, not generated.
     */
    label: 'Customer Review',
    purpose: 'feature one real customer review the business has on file',
    format: 'soft_promo',
    imageConcept: 'testimonial',
    layoutHint: 'poster-testimonial',
    openingGuidance: 'open on the outcome the customer described, in the business voice',
    ctaType: 'soft',
    headlineStyle: 'short_statement',
    // Marks a day type that cannot generate its own substance: it needs a
    // supplied review, and the resolver only selects it when one exists.
    requiresReview: true,
  },

  // ---------------------------------------------------- knowledge business
  educational_tip: {
    label: 'Educational Tip',
    purpose: 'teach one concrete, usable technique',
    format: 'educational_insight',
    imageConcept: 'cheatsheet',
    layoutHint: 'checklist-guide',
    openingGuidance: 'open on the mistake the technique corrects',
    ctaType: 'soft',
    headlineStyle: 'technique_named',
  },
  category_insight: {
    /*
     * Generalised from the source's `geo_insight`. GEO is one agency's service
     * category, and naming a day after it would hardcode that business into
     * every workspace that uses this strategy.
     */
    label: 'Category Insight',
    purpose: 'explain where the field is moving and what it means in practice',
    format: 'educational_insight',
    imageConcept: 'quote_card',
    layoutHint: 'light-editorial',
    openingGuidance: 'open on what changed recently in this field',
    ctaType: 'soft',
    headlineStyle: 'shift_named',
  },
  hot_take_myth: {
    label: 'Myth and Correction',
    purpose: 'correct a widely repeated belief',
    format: 'myth_fact',
    imageConcept: 'comparison',
    layoutHint: 'comparison-cards',
    openingGuidance: 'open by stating the belief plainly before correcting it',
    ctaType: 'none',
    headlineStyle: 'belief_versus_fact',
  },
  how_to_guide: {
    label: 'How To',
    purpose: 'give an ordered method the reader can follow',
    format: 'checklist',
    imageConcept: 'cheatsheet',
    // The knowledge-business Thursday image_template is cheatsheet, so the layout is the
    // cheatsheet composition, not numbered-steps: parity follows the concept.
    layoutHint: 'poster-cheatsheet',
    openingGuidance: 'open on the outcome the method produces',
    ctaType: 'soft',
    headlineStyle: 'outcome_plus_steps',
  },
  industry_trend: {
    label: 'Industry Trend',
    purpose: 'describe a change and what to do about it',
    format: 'educational_insight',
    imageConcept: 'quote_card',
    // The knowledge-business Friday image_template is quote_card, so the layout is the quote
    // composition rather than a plain editorial one.
    layoutHint: 'poster-quote',
    openingGuidance: 'open on the change, not on its importance',
    ctaType: 'soft',
    headlineStyle: 'trend_named',
  },
  quick_hack: {
    label: 'Quick Win',
    purpose: 'give one small change with a disproportionate effect',
    format: 'quick_tip',
    imageConcept: 'cheatsheet',
    layoutHint: 'checklist-tips',
    openingGuidance: 'open on how little the change costs',
    ctaType: 'none',
    headlineStyle: 'imperative_action',
  },
  thought_leadership: {
    label: 'Point of View',
    purpose: 'take a position and support it',
    format: 'authority',
    imageConcept: 'quote_card',
    layoutHint: 'light-editorial',
    openingGuidance: 'open on the position itself, stated once and clearly',
    ctaType: 'soft',
    headlineStyle: 'short_statement',
  },
});

/**
 * ISO weekday (1 = Monday) to day type, per niche.
 *
 * Taken from the `switch(formatDate(now; "dddd"); ...)` expressions. The local
 * service rotation is the one shared by five of six contractor scenarios, with
 * Friday taking brick pointing's safe variant.
 */
export const NICHE_STRATEGIES = Object.freeze({
  [NICHES.LOCAL_SERVICE]: Object.freeze({
    key: NICHES.LOCAL_SERVICE,
    label: 'Local service business',
    sourceScenarios: 6,
    week: Object.freeze({
      1: 'service_spotlight',
      2: 'trust_stat',
      3: 'code_tip',
      4: 'project_showcase',
      5: 'maintenance_tip',
      6: 'pro_tip_warning',
      7: 'brand_insight',
    }),
  }),
  [NICHES.KNOWLEDGE_BUSINESS]: Object.freeze({
    key: NICHES.KNOWLEDGE_BUSINESS,
    label: 'Knowledge, agency or software business',
    sourceScenarios: 1,
    week: Object.freeze({
      1: 'educational_tip',
      2: 'category_insight',
      3: 'hot_take_myth',
      4: 'how_to_guide',
      5: 'industry_trend',
      6: 'quick_hack',
      7: 'thought_leadership',
    }),
  }),
});

/*
 * Category words that indicate a knowledge business.
 *
 * Matched against the workspace's OWN business category and description, so the
 * niche follows the business rather than a name in this file. The list is
 * deliberately about the shape of the business, not about any one company:
 * nothing here names a customer, and a business that matches nothing is treated
 * as a local service, which is the majority shape and the safer default (it
 * asks for a service and a location, both of which a knowledge business also
 * has).
 */
const KNOWLEDGE_SIGNALS = Object.freeze([
  'seo', 'marketing', 'agency', 'software', 'saas', 'consult', 'consulting',
  'design', 'analytics', 'advertis', 'media', 'digital', 'technology', 'it services',
  'recruit', 'accounting', 'legal', 'finance', 'education', 'training', 'coaching',
]);

/**
 * Which strategy this workspace's business gets.
 *
 * Reads the persisted profile only. A business with no category resolves to the
 * local service rhythm rather than to nothing, because a rhythm is not a fact
 * about the business — it is a posting shape, and the wrong shape is a weaker
 * post rather than a false claim. Missing FACTS are handled elsewhere, by the
 * business-context guard, which refuses to generate at all.
 *
 * @param {object|null} profile persisted business profile
 * @returns {string} a NICHES value
 */
export function resolveNiche(profile) {
  const haystack = [
    profile?.businessCategory,
    profile?.businessDescription,
  ].filter(Boolean).join(' ').toLowerCase();

  if (!haystack) return NICHES.LOCAL_SERVICE;
  return KNOWLEDGE_SIGNALS.some((signal) => haystack.includes(signal))
    ? NICHES.KNOWLEDGE_BUSINESS
    : NICHES.LOCAL_SERVICE;
}

/** The strategy object for a niche, falling back to the majority shape. */
export function strategyForNiche(niche) {
  return NICHE_STRATEGIES[niche] || NICHE_STRATEGIES[NICHES.LOCAL_SERVICE];
}

/**
 * The week for a strategy, upgraded to the exact-parity Friday testimonial when
 * the workspace has a real review to feature.
 *
 * The local-service week ships maintenance_tip on Friday because that is the
 * safe default when no review exists. When one does, Friday becomes the
 * testimonial spotlight, which is the exact Make Friday. The knowledge week has
 * no testimonial day, so it is returned unchanged. This is the one place the
 * strategy bends to available data, and it only ever bends toward MORE parity,
 * never toward inventing a review.
 *
 * @param {object} strategy from strategyForNiche
 * @param {{ hasReview?: boolean }} opts
 * @returns {Record<number,string>} ISO weekday -> day type key
 */
export function resolveWeek(strategy, { hasReview = false } = {}) {
  const week = { ...(strategy?.week || NICHE_STRATEGIES[NICHES.LOCAL_SERVICE].week) };
  if (hasReview && week[5] === 'maintenance_tip') week[5] = 'testimonial_spotlight';
  return week;
}

/**
 * The day type for one calendar weekday.
 *
 * ISO weekday in, definition out. The source used the Make organisation's
 * timezone here, which meant a New York contractor's "Monday" was decided in
 * another country; the caller passes a weekday already resolved in the plan's
 * own timezone, so that defect does not come across.
 *
 * @param {object} strategy from strategyForNiche
 * @param {number} isoWeekday 1 = Monday through 7 = Sunday
 */
export function dayTypeFor(strategy, isoWeekday) {
  const week = strategy?.week || NICHE_STRATEGIES[NICHES.LOCAL_SERVICE].week;
  // A defaultless switch was how the source rendered blank cards on an
  // unmatched day. Monday is a real day type, not an empty string.
  const key = week[isoWeekday] || week[1];
  const definition = DAY_TYPES[key];
  return {
    key,
    ...definition,
    formatLabel: PLANNER_FORMAT_LABELS[definition.format] || definition.label,
  };
}

/** Every day type a niche can produce, in week order. Used by tests and the UI. */
export function weekShapeFor(niche) {
  const strategy = strategyForNiche(niche);
  return [1, 2, 3, 4, 5, 6, 7].map((d) => dayTypeFor(strategy, d));
}

/**
 * The native poster layout each Make image concept renders on.
 *
 * The source scenarios shipped one bespoke HTML card per concept, hardcoded to a
 * business's palette. Cyflow reproduces those same compositions as native
 * `poster-*` layouts driven by the workspace's own brand roles, so the design is
 * the Make design and only the colours, logo and copy change. This table is the
 * one authoritative concept-to-layout mapping; the day types name a concept, and
 * every concept resolves here.
 */
export const CONCEPT_LAYOUT = Object.freeze({
  service_card: 'poster-service',
  stat_card: 'poster-stat',
  cheatsheet: 'poster-cheatsheet',
  project_card: 'poster-project',
  warning_card: 'poster-warning',
  quote_card: 'poster-quote',
  comparison: 'poster-comparison',
  testimonial: 'poster-testimonial',
});

/**
 * The layout an assigned image concept renders on.
 *
 * Falls back to the caller's own layout choice when a concept is unknown, so an
 * older run generated before concepts existed still renders.
 */
export function layoutForConcept(imageConcept, fallback = 'editorial-insight') {
  return CONCEPT_LAYOUT[imageConcept] || fallback;
}

/** Every concept the engine can assign. Used to validate templates exist. */
export const IMAGE_CONCEPTS = Object.freeze(Object.keys(CONCEPT_LAYOUT));

export default {
  NICHES, DAY_TYPES, NICHE_STRATEGIES, resolveNiche, strategyForNiche, dayTypeFor, weekShapeFor,
};
