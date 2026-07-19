/**
 * The batch diversity plan: what makes ten posts ten posts.
 *
 * The Make scenarios generated one post per day, in isolation, with no memory
 * of the previous one. Six of the seven had no history mechanism at all, and the
 * seventh kept an unbounded blob of past topics and asked the model politely to
 * pick something else. That is why a run of posts drifts into restatement: the
 * only thing resisting repetition was the sampling temperature.
 *
 * Cyflow generates a whole batch at once, which makes the problem visible and
 * also makes it solvable. Before any model call, every slot is assigned its own
 * service, customer problem, opening style, structure, CTA type, closing style,
 * hashtag family and image concept, and those assignments are rotated so two
 * posts in a batch cannot be handed the same combination. The model is then told
 * what it may not reuse.
 *
 * The failure this exists to prevent is specific and was observed: a ten-post
 * waterproofing batch that produced ten arguments that patching does not work.
 * Every post was defensible on its own. As a set they were one idea, and a
 * reader would have unfollowed by Wednesday.
 *
 * Nothing in this file knows about any particular business. Services and
 * locations arrive from the workspace's persisted profile, and the rotation
 * banks below are about WRITING — how a paragraph opens, how it closes — which
 * is the part that is genuinely shared across niches.
 */

/**
 * How a post opens. Rotated so no two posts in a batch start the same way.
 *
 * These are instructions to the writer, not templates to fill. The extracted
 * prompts got their variety from exactly this kind of direction.
 */
export const OPENING_STYLES = Object.freeze([
  { key: 'symptom', guidance: 'open on the symptom the customer noticed first' },
  { key: 'question', guidance: 'open with a direct question the customer is already asking' },
  { key: 'misconception', guidance: 'open by stating the wrong belief plainly, then correct it' },
  { key: 'scenario', guidance: 'open on a concrete situation, no more than two sentences' },
  { key: 'requirement', guidance: 'open on what the customer is obliged to do' },
  { key: 'cost', guidance: 'open on what waiting or guessing ends up costing' },
  { key: 'comparison', guidance: 'open by contrasting two approaches in one line' },
  { key: 'observation', guidance: 'open on something the business sees repeatedly in this work' },
]);

/** How a post lands. Rotated independently of the opening. */
export const CLOSING_STYLES = Object.freeze([
  { key: 'next_step', guidance: 'close on the single next step worth taking' },
  { key: 'check_yourself', guidance: 'close on something the reader can check without help' },
  { key: 'principle', guidance: 'close on the principle behind the advice' },
  { key: 'invitation', guidance: 'close by inviting a question, without pressure' },
  { key: 'reassurance', guidance: 'close by reducing the reader\'s worry, honestly' },
  { key: 'summary', guidance: 'close with a one-line summary of the point' },
]);

/** The structural shape of the body. */
export const WRITING_FORMATS = Object.freeze([
  { key: 'short_paragraphs', guidance: 'two to four short paragraphs of plain prose' },
  { key: 'problem_then_fix', guidance: 'name the problem, then the fix, then what it prevents' },
  { key: 'numbered_points', guidance: 'a short lead-in, then three or four numbered points' },
  { key: 'before_after', guidance: 'what it looks like before, what it looks like after' },
  { key: 'question_answer', guidance: 'pose the question, answer it, add one caveat' },
  { key: 'walkthrough', guidance: 'walk the steps in the order they actually happen' },
]);

/**
 * Hashtag families, as ROLES rather than tags.
 *
 * The source scenarios asked the model for four to seven hashtags with no other
 * direction and got the same handful every day. A family tells the writer which
 * angle to tag from, so a batch spreads across service, location, problem and
 * audience instead of repeating the brand tag seven times.
 */
export const HASHTAG_FAMILIES = Object.freeze([
  { key: 'service', guidance: 'tag the specific service and the work itself' },
  { key: 'location', guidance: 'tag the service area and the local trade' },
  { key: 'problem', guidance: 'tag the problem the reader has, in their words' },
  { key: 'audience', guidance: 'tag who this is for, such as homeowners or property managers' },
  { key: 'category', guidance: 'tag the broader category and industry' },
]);

/** Headline treatments for the image. Paired with, but rotated apart from, the concept. */
export const HEADLINE_STYLES = Object.freeze([
  { key: 'noun_phrase', guidance: 'a short noun phrase, no verb' },
  { key: 'imperative', guidance: 'a direct instruction of three to five words' },
  { key: 'question', guidance: 'a short question the reader would ask' },
  { key: 'number_led', guidance: 'lead with the number, then the noun' },
  { key: 'contrast', guidance: 'two halves in tension, joined by a comma' },
]);

const at = (list, i) => list[((i % list.length) + list.length) % list.length];

/**
 * Customer problems, derived from the business's OWN services.
 *
 * The planner previously drew from a fixed list of eight generic worries, which
 * meant every business in every niche worried about the same eight things and a
 * long batch cycled back round to the first. Pairing a real service with a
 * problem shape produces a problem that is about this business, and gives
 * services x shapes distinct combinations rather than eight.
 *
 * A business with no services recorded gets the shapes alone rather than an
 * invented service — nothing here fills a gap in the profile with a guess.
 */
const PROBLEM_SHAPES = Object.freeze([
  (s) => `they cannot tell whether they actually need ${s}`,
  (s) => `they have paid for ${s} before and it did not hold`,
  (s) => `they do not know what good ${s} should cost`,
  (s) => `they cannot tell competent ${s} from careless work`,
  (s) => `they do not know how long ${s} should take`,
  (s) => `they are unsure what has to happen before ${s} can start`,
  (s) => `they think ${s} is simpler than it is`,
  (s) => `they are worried ${s} will uncover something worse`,
]);

const GENERIC_PROBLEMS = Object.freeze([
  'they are not sure what is actually worth paying for',
  'they cannot tell good work from bad work here',
  'they do not know what to check first',
  'they are worried about wasting money on it',
]);

export function problemFor(services, index) {
  const list = (services || []).filter((s) => typeof s === 'string' && s.trim());
  if (!list.length) return at(GENERIC_PROBLEMS, index);
  /*
   * Service and shape advance on different cycles so the pairing does not
   * repeat until both wrap. With five services and eight shapes that is forty
   * distinct problems before the first one comes round again, which is well
   * past any realistic batch.
   */
  const service = at(list, index).trim();
  const shape = at(PROBLEM_SHAPES, Math.floor(index / Math.max(list.length, 1)) + index);
  return shape(service.toLowerCase());
}

/**
 * Assign every slot in a batch its own creative combination.
 *
 * Each dimension advances on its own cycle. Using one index for all of them
 * would make the whole combination repeat as soon as the shortest bank wrapped,
 * which is the trap that produces "different words, same post".
 *
 * @param {object} input
 * @param {Array} input.slots      scheduled slots, in order
 * @param {Function} input.dayTypeAt  (isoWeekday) => day type definition
 * @param {Array<string>} input.services the workspace's persisted services
 * @returns {Array<object>} one assignment per slot, aligned by index
 */
export function planBatch({ slots = [], dayTypeAt, services = [], reviews = [] } = {}) {
  const serviceList = (services || []).filter((s) => typeof s === 'string' && s.trim());
  /*
   * Reviews are handed out one per testimonial slot, in order, so a batch with
   * several testimonial days does not repeat one review. When they run out, a
   * further testimonial slot has no review to show — but the week resolver only
   * routes to a testimonial day when at least one review exists, so in practice
   * a single review covers a week's single Friday.
   */
  const reviewList = Array.isArray(reviews) ? reviews.filter((r) => r && r.quote) : [];
  let reviewCursor = 0;

  /*
   * How many earlier slots fall on the same calendar day.
   *
   * The Make scenarios posted once a day, so a day type could map straight from
   * the weekday. Cyflow allows several posts a day, and two posts sharing a day
   * type would share a concept and a layout and read as one post published
   * twice. The second post on a day steps to the NEXT day type in the week, so
   * a Tuesday morning stat card is followed by a Tuesday evening rules post,
   * not a second stat card. Single-post days, the common case, are unchanged.
   */
  const seenOnDay = new Map();

  return slots.map((slot, i) => {
    const isoWeekday = slot?.weekday ?? ((i % 7) + 1);
    const dayKey = slot?.localDate || `w${isoWeekday}`;
    const offset = seenOnDay.get(dayKey) || 0;
    seenOnDay.set(dayKey, offset + 1);
    // Step the weekday by the within-day offset, wrapping 1..7.
    const effectiveWeekday = ((isoWeekday - 1 + offset) % 7) + 1;
    const dayType = typeof dayTypeAt === 'function' ? dayTypeAt(effectiveWeekday) : null;

    /*
     * Every bank advances by ONE, from a different starting offset.
     *
     * The first version used a different stride per bank (i*2, i*3) to
     * decorrelate them, and two banks silently collapsed: stride 2 over six
     * closings yields three of them, stride 3 over six formats yields two. A
     * stride only visits the whole bank when it is coprime with the bank's
     * length, and "pick a stride that looks unrelated" is not that. Ten posts
     * came out with two structures.
     *
     * Stride one always visits every entry. The offsets keep the dimensions
     * from moving in lockstep, and the combination as a whole repeats on the
     * lowest common multiple of the bank sizes, which is far beyond any batch
     * a user will schedule.
     */
    const opening = at(OPENING_STYLES, i);
    const closing = at(CLOSING_STYLES, i + 1);
    const writingFormat = at(WRITING_FORMATS, i + 2);
    const hashtagFamily = at(HASHTAG_FAMILIES, i + 3);
    const headlineStyle = at(HEADLINE_STYLES, i + 1);

    return {
      position: i,
      isoWeekday,
      dayTypeKey: dayType?.key || null,
      dayTypeLabel: dayType?.label || null,
      purpose: dayType?.purpose || null,
      format: dayType?.format || null,
      // The image concept follows the day, exactly as the two switch
      // expressions moved together in the source.
      imageConcept: dayType?.imageConcept || null,
      layoutHint: dayType?.layoutHint || null,
      ctaType: dayType?.ctaType || 'soft',
      service: serviceList.length ? at(serviceList, i).trim() : null,
      audienceProblem: problemFor(serviceList, i),
      openingStyle: opening.key,
      openingGuidance: dayType?.openingGuidance || opening.guidance,
      closingStyle: closing.key,
      closingGuidance: closing.guidance,
      writingFormat: writingFormat.key,
      writingGuidance: writingFormat.guidance,
      hashtagFamily: hashtagFamily.key,
      hashtagGuidance: hashtagFamily.guidance,
      headlineStyle: dayType?.headlineStyle || headlineStyle.key,
      headlineGuidance: headlineStyle.guidance,
      // A testimonial slot carries the actual review it will feature, taken in
      // order from the workspace's own reviews. No review, no testimonial.
      review: dayType?.imageConcept === 'testimonial' && reviewCursor < reviewList.length
        ? reviewList[reviewCursor++]
        : null,
    };
  });
}

/**
 * What a batch actually varies, counted.
 *
 * Returned so the caller can assert on it and so a weak batch is visible before
 * anyone reads ten posts to discover it. Counting distinct values is the whole
 * point: a plan that assigns the same opening to every slot is not a plan.
 */
export function summarizeDiversity(plan = []) {
  const distinct = (key) => new Set(plan.map((p) => p[key]).filter((v) => v != null)).size;
  return {
    posts: plan.length,
    services: distinct('service'),
    problems: distinct('audienceProblem'),
    dayTypes: distinct('dayTypeKey'),
    openings: distinct('openingStyle'),
    closings: distinct('closingStyle'),
    formats: distinct('writingFormat'),
    hashtagFamilies: distinct('hashtagFamily'),
    imageConcepts: distinct('imageConcept'),
    headlineStyles: distinct('headlineStyle'),
  };
}

/**
 * The elements a retry must not reuse.
 *
 * A retry that only reruns the prompt produces a paraphrase, because the prompt
 * is what produced the rejected post. This gathers what the batch has already
 * spent so the rewrite can be told to spend something else — the source
 * scenarios had no retry path at all, so this is new rather than migrated.
 *
 * @param {Array<object>} plan the batch plan
 * @param {Array<object>} generated items already generated, with their copy
 * @param {number} excludePosition the slot being retried, whose own history is not a constraint on itself
 */
export function usedElements(plan = [], generated = [], excludePosition = null) {
  const others = plan.filter((p) => p.position !== excludePosition);
  const openings = generated
    .filter((g) => g?.position !== excludePosition)
    .map((g) => firstSentence(g?.caption))
    .filter(Boolean);

  return {
    topics: generated.filter((g) => g?.position !== excludePosition).map((g) => g?.topic).filter(Boolean),
    services: [...new Set(others.map((p) => p.service).filter(Boolean))],
    problems: [...new Set(others.map((p) => p.audienceProblem).filter(Boolean))],
    openingStyles: [...new Set(others.map((p) => p.openingStyle).filter(Boolean))],
    openingSentences: openings,
    closingStyles: [...new Set(others.map((p) => p.closingStyle).filter(Boolean))],
    hashtagFamilies: [...new Set(others.map((p) => p.hashtagFamily).filter(Boolean))],
    imageConcepts: [...new Set(others.map((p) => p.imageConcept).filter(Boolean))],
    headlineStyles: [...new Set(others.map((p) => p.headlineStyle).filter(Boolean))],
  };
}

function firstSentence(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const match = text.trim().match(/^[^.!?\n]{4,140}[.!?]?/);
  return match ? match[0].trim() : null;
}

export default {
  OPENING_STYLES, CLOSING_STYLES, WRITING_FORMATS, HASHTAG_FAMILIES, HEADLINE_STYLES,
  planBatch, summarizeDiversity, usedElements, problemFor,
};
