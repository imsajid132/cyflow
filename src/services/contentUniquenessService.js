/**
 * Duplicate-prevention engine.
 *
 * A weekly plan is generated in one batch from one business profile, so the
 * natural failure mode is seven posts that all say the same thing in slightly
 * different words. This service scores that risk BEFORE a post is shown to the
 * user, so the planner can regenerate automatically instead of shipping filler.
 *
 * It is deliberately heuristic and local: no network call, no model, no stored
 * caption text. Everything is derived from small token sets, which makes it
 * fast enough to run against every candidate and safe to persist as a
 * fingerprint (see `planner_run_items.content_fingerprint_json`).
 *
 * Scoring compares a candidate against BOTH the current batch and the user's
 * recent history across several independent axes, because two posts can share
 * an angle while wording differs (and vice versa):
 *
 *   caption   — trigram Jaccard over the whole caption (catches paraphrase)
 *   headline  — token Jaccard + exact match (the most visible repetition)
 *   opening   — the first sentence alone (formulaic openers are very obvious)
 *   cta       — CTA wording reuse
 *   topic     — content type + goal + emphasised service
 *   hashtags  — tag set overlap
 *
 * The axes are combined with a weighted max-per-axis rather than an average:
 * one badly repeated headline should be enough to trigger a regeneration even
 * if the rest of the post is fresh.
 */

import {
  DUPLICATION_THRESHOLDS,
  PLANNER_LIMITS,
  PLATFORM_COPY_MAX_SIMILARITY,
  PLATFORM_OPENING_MAX_SIMILARITY,
} from '../config/constants.js';

/** Words too common to carry meaning when comparing marketing copy. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for',
  'from', 'get', 'has', 'have', 'how', 'in', 'is', 'it', 'its', 'more', 'not',
  'of', 'on', 'or', 'our', 'out', 'so', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'up', 'was', 'we', 'were', 'what',
  'when', 'which', 'who', 'will', 'with', 'you', 'your', 'us', 'if', 'about',
]);

/** Lowercase, strip punctuation/emoji/urls, collapse whitespace. */
export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@][\w-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Content words only — stop words and 1-character noise removed. */
export function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Character trigrams of the normalized text.
 *
 * Trigrams catch paraphrase that token overlap misses: "book a roof check" and
 * "book your roof check" share almost no distinctive tokens but nearly all
 * trigrams.
 */
export function trigrams(value) {
  const normalized = normalizeText(value).replace(/\s+/g, ' ');
  if (normalized.length < 3) return new Set(normalized ? [normalized] : []);
  const out = new Set();
  for (let i = 0; i <= normalized.length - 3; i += 1) out.add(normalized.slice(i, i + 3));
  return out;
}

/** |A ∩ B| / |A ∪ B|. Returns 0 when either side is empty. */
export function jaccard(a, b) {
  const setA = a instanceof Set ? a : new Set(a);
  const setB = b instanceof Set ? b : new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const value of setA) if (setB.has(value)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * The first PARAGRAPH, which is the unit a post is actually built from.
 *
 * The opening sentence catches a formulaic first line; this catches a whole
 * opening move reused with its first sentence swapped, which is what a model
 * does when it is told "do not start the same way" and nothing else.
 */
export function firstParagraph(caption) {
  if (typeof caption !== 'string') return '';
  const [first] = caption.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return (first || '').slice(0, 400);
}

/** The last paragraph: the close and CTA, the other end of the formula. */
export function lastParagraph(caption) {
  if (typeof caption !== 'string') return '';
  const paragraphs = caption.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return (paragraphs[paragraphs.length - 1] || '').slice(0, 400);
}

/**
 * Are two platforms' posts the same post?
 *
 * Deliberately permissive. Two posts about one subject legitimately share their
 * facts, their service name and their vocabulary, so this is tuned to catch
 * "identical, or trimmed and reworded", not "same topic". A false positive here
 * costs a regeneration; a false negative ships the thing this phase exists to
 * stop.
 */
export function platformCopyTooSimilar(a, b, threshold = PLATFORM_COPY_MAX_SIMILARITY) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!a.trim() || !b.trim()) return false;
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  // A trimmed copy is a substring of its source once normalized, and trigram
  // overlap alone reads that as merely "similar".
  if (normA.includes(normB) || normB.includes(normA)) return true;

  /*
   * The OPENING is checked separately and harder than the body.
   *
   * A whole-post score is an average over the post, so two versions that share
   * an opening sentence verbatim and then diverge score as merely "similar" and
   * pass. But the opening is the part a reader actually sees in a feed, and it
   * is the part that makes two platforms look like one copy-paste. A shared
   * first paragraph is the failure whatever the rest of the post does.
   */
  const openA = firstParagraph(a);
  const openB = firstParagraph(b);
  if (openA && openB && jaccard(trigrams(openA), trigrams(openB)) >= PLATFORM_OPENING_MAX_SIMILARITY) {
    return true;
  }

  return jaccard(trigrams(a), trigrams(b)) >= threshold;
}

/** The first sentence, which is what a reader actually sees in a feed. */
export function firstSentence(caption) {
  if (typeof caption !== 'string') return '';
  const trimmed = caption.trim();
  if (!trimmed) return '';
  const match = /^[\s\S]*?[.!?](\s|$)/.exec(trimmed);
  const sentence = match ? match[0] : trimmed;
  return sentence.trim().slice(0, 200);
}

function normalizeHashtagSet(hashtags) {
  if (!Array.isArray(hashtags)) return new Set();
  return new Set(
    hashtags
      .filter((h) => typeof h === 'string')
      .map((h) => h.toLowerCase().replace(/^#+/, '').trim())
      .filter(Boolean),
  );
}

/**
 * Reduce a post to the small set of signals the comparison needs.
 *
 * This is what gets persisted: derived tokens only, never the caption itself.
 *
 * @param {{ caption?, headline?, subheadline?, cta?, hashtags?, contentType?,
 *           goal?, serviceEmphasis?, templateKey? }} post
 */
export function fingerprint(post = {}) {
  const caption = typeof post.caption === 'string' ? post.caption : '';
  const opening = firstSentence(caption);
  return {
    captionTrigrams: [...trigrams(caption)],
    captionTokens: [...new Set(tokenize(caption))],
    headlineTokens: [...new Set(tokenize(post.headline))],
    headlineNormalized: normalizeText(post.headline),
    openingTrigrams: [...trigrams(opening)],
    /*
     * The opening PARAGRAPH and the closing paragraph. A week of posts that
     * repeat a shape ("observation, then explanation, then book a quote") reads
     * as formulaic even when every sentence differs, and the first-sentence axis
     * alone cannot see it.
     */
    openingParagraphTrigrams: [...trigrams(firstParagraph(caption))],
    conclusionTrigrams: [...trigrams(lastParagraph(caption))],
    /*
     * The normalized opening is kept as text (not just trigrams) so the planner
     * can tell the next generation which openings are taken. It is derived and
     * short — the caption itself is still never stored here.
     */
    openingText: normalizeText(opening).slice(0, 60),
    ctaNormalized: normalizeText(post.cta),
    hashtags: [...normalizeHashtagSet(post.hashtags)],
    contentType: typeof post.contentType === 'string' ? post.contentType : null,
    goal: typeof post.goal === 'string' ? post.goal : null,
    serviceEmphasis: normalizeText(post.serviceEmphasis) || null,
    templateKey: typeof post.templateKey === 'string' ? post.templateKey : null,
    // The strategic writing format. Distinct from contentType, which is the
    // older, coarser label; a week can repeat a contentType legitimately while
    // repeating a format is what makes seven posts feel like one.
    format: typeof post.format === 'string' ? post.format : null,
  };
}

/**
 * Similarity between two fingerprints, per axis and combined.
 * @returns {{ score:number, axes:object, reasons:string[] }}
 */
export function compareFingerprints(a, b) {
  const axes = {
    caption: jaccard(a.captionTrigrams, b.captionTrigrams),
    headline: 0,
    opening: jaccard(a.openingTrigrams, b.openingTrigrams),
    openingParagraph: jaccard(a.openingParagraphTrigrams, b.openingParagraphTrigrams),
    conclusion: jaccard(a.conclusionTrigrams, b.conclusionTrigrams),
    cta: 0,
    topic: 0,
    structure: 0,
    hashtags: jaccard(a.hashtags, b.hashtags),
  };
  const reasons = [];

  // Headline: an exact repeat is absolute, otherwise token overlap.
  if (a.headlineNormalized && a.headlineNormalized === b.headlineNormalized) {
    axes.headline = DUPLICATION_THRESHOLDS.EXACT;
    reasons.push('identical headline');
  } else {
    axes.headline = jaccard(a.headlineTokens, b.headlineTokens);
  }

  // An identical caption is absolute too.
  if (a.captionTokens.length && b.captionTokens.length && axes.caption >= 0.98) {
    axes.caption = DUPLICATION_THRESHOLDS.EXACT;
    reasons.push('near-identical caption');
  }

  if (a.ctaNormalized && b.ctaNormalized) {
    axes.cta = a.ctaNormalized === b.ctaNormalized ? 1 : jaccard(tokenize(a.ctaNormalized), tokenize(b.ctaNormalized));
  }

  /*
   * Topic: same content type AND goal is the strongest signal of a repeated
   * angle; sharing only one of them is weak, since a 7-day plan legitimately
   * reuses each type more than once.
   */
  let topic = 0;
  if (a.contentType && a.contentType === b.contentType) topic += 0.45;
  if (a.goal && a.goal === b.goal) topic += 0.3;
  if (a.serviceEmphasis && a.serviceEmphasis === b.serviceEmphasis) topic += 0.25;
  axes.topic = Math.min(1, topic);

  /*
   * Structure: the writing format and the layout that carries it.
   *
   * Soft on purpose. A 7-day plan has more days than formats, so reusing a
   * format is expected and reusing a layout is unavoidable — FORMAT_TEMPLATES
   * maps several formats onto one layout by design. This axis exists to break
   * ties: a post that repeats an angle AND its format AND its layout is the same
   * post, while any one of the three alone is just a plan with a shape.
   */
  let structure = 0;
  if (a.format && a.format === b.format) structure += 0.6;
  if (a.templateKey && a.templateKey === b.templateKey) structure += 0.4;
  axes.structure = Math.min(1, structure);

  /*
   * Scoring splits the axes into two groups, because they mean different things:
   *
   * STRONG axes are the actual words on the page. Any one of them alone is
   * enough to condemn a post — an identical headline must fail even if every
   * other axis is fresh, which is why this is a max and not an average.
   *
   * SOFT axes describe reuse that is often CORRECT. A business is supposed to
   * end every post with "Book a free quote" and to reuse its own hashtags; that
   * is brand consistency, not repetition. So no soft axis can flag a post by
   * itself — they only add up, and only several of them together reach the
   * warning threshold.
   */
  /*
   * Adding an axis rebalances the stack rather than just extending it, because
   * the soft group has to keep two properties at once:
   *
   *   what a brand SHOULD repeat must not warn on its own — identical hashtags
   *   plus an identical CTA is 0.37, under WARN (0.45), because ending every
   *   post with "Book a free quote" is consistency, not repetition;
   *
   *   a repeated ANGLE must still warn even when little else matches — the same
   *   content type and service with a shared CTA is 0.50, over WARN.
   *
   * `structure` is weighted low deliberately. A 7-day plan has more days than
   * layouts and FORMAT_TEMPLATES maps several formats onto one layout by design,
   * so a shared layout is expected: at 0.10, sharing only the layout adds 0.04
   * and cannot push brand-consistent reuse over the line, while sharing the
   * format AND the layout adds the full 0.10 and can.
   */
  const SOFT_WEIGHTS = {
    topic: 0.5, hashtags: 0.22, cta: 0.15, structure: 0.1, conclusion: 0.1,
  };
  const strong = Math.max(
    axes.caption * 1,
    axes.headline * 0.95,
    axes.opening * 0.85,
    axes.openingParagraph * 0.8,
  );
  const soft = Math.min(
    0.9,
    axes.topic * SOFT_WEIGHTS.topic
      + axes.hashtags * SOFT_WEIGHTS.hashtags
      + axes.cta * SOFT_WEIGHTS.cta
      + axes.structure * SOFT_WEIGHTS.structure
      + axes.conclusion * SOFT_WEIGHTS.conclusion,
  );
  const score = Math.max(strong, soft);

  if (axes.caption >= 0.6) reasons.push('very similar post copy');
  if (axes.opening >= 0.7) reasons.push('near-identical opening line');
  if (axes.openingParagraph >= 0.7 && axes.opening < 0.7) reasons.push('the same opening paragraph');
  if (axes.headline >= 0.6 && !reasons.includes('identical headline')) reasons.push('similar headline');

  /*
   * When the soft stack is what pushed the score up, name its factors in order
   * of how much each actually contributed. Listing them by a fixed threshold
   * would report "same call to action" (a 0.15 contributor, and a thing
   * businesses SHOULD do) while hiding the repeated angle that really drove it
   * — which trains users to dismiss the warning.
   */
  if (soft >= DUPLICATION_THRESHOLDS.WARN && soft >= strong) {
    const contributions = [
      [axes.topic * SOFT_WEIGHTS.topic, axes.topic >= 0.9 ? 'the same angle and service' : 'a similar angle'],
      [axes.hashtags * SOFT_WEIGHTS.hashtags, 'the same hashtags'],
      [
        axes.structure * SOFT_WEIGHTS.structure,
        axes.structure >= 0.9 ? 'the same writing format and layout' : 'the same writing format',
      ],
      [axes.conclusion * SOFT_WEIGHTS.conclusion, 'the same closing paragraph'],
      [axes.cta * SOFT_WEIGHTS.cta, 'the same call to action'],
    ]
      .filter(([contribution]) => contribution > 0.01)
      .sort((a, b) => b[0] - a[0]);
    for (const [, label] of contributions) reasons.push(label);
  }

  return { score: Number(score.toFixed(3)), axes, reasons };
}

export function createContentUniquenessService({ thresholds = DUPLICATION_THRESHOLDS } = {}) {
  /**
   * Score one candidate against everything it must not repeat.
   *
   * @param {object} candidate the proposed post (raw fields, not a fingerprint)
   * @param {{ batch?: object[], recent?: object[] }} context
   *        `batch`  — fingerprints (or posts) already accepted in this run
   *        `recent` — fingerprints (or posts) from the user's recent history
   * @returns {{ score, verdict, shouldRegenerate, reasons, worst, axes }}
   *          verdict: 'unique' | 'review' | 'duplicate'
   */
  function evaluate(candidate, { batch = [], recent = [] } = {}) {
    const candidateFp = candidate?.captionTrigrams ? candidate : fingerprint(candidate);

    const comparisons = [];
    const consider = (others, source) => {
      for (const other of others) {
        if (!other) continue;
        const otherFp = other.captionTrigrams ? other : fingerprint(other);
        const result = compareFingerprints(candidateFp, otherFp);
        comparisons.push({ ...result, source, ref: other.id ?? null });
      }
    };
    // The batch matters most: repetition inside one week is the most visible.
    consider(batch, 'batch');
    consider(recent.slice(0, PLANNER_LIMITS.DUPLICATE_LOOKBACK_ITEMS), 'recent');

    if (comparisons.length === 0) {
      return {
        score: 0,
        verdict: 'unique',
        shouldRegenerate: false,
        reasons: [],
        worst: null,
        axes: {},
      };
    }

    const worst = comparisons.reduce((max, c) => (c.score > max.score ? c : max), comparisons[0]);
    const score = worst.score;
    let verdict = 'unique';
    if (score >= thresholds.REGENERATE) verdict = 'duplicate';
    else if (score >= thresholds.WARN) verdict = 'review';

    return {
      score,
      verdict,
      shouldRegenerate: verdict === 'duplicate',
      reasons: [...new Set(worst.reasons)],
      worst: { source: worst.source, ref: worst.ref, score: worst.score },
      axes: worst.axes,
    };
  }

  /**
   * A short, human-readable note for the review card. Never includes the other
   * post's text — only why this one looks repetitive.
   */
  function describe(evaluation) {
    if (!evaluation || evaluation.verdict === 'unique') return null;
    const where = evaluation.worst?.source === 'batch' ? 'another post in this plan' : 'a recent post';
    const why = evaluation.reasons.length ? evaluation.reasons.join(', ') : 'overlapping wording';
    const prefix = evaluation.verdict === 'duplicate' ? 'Too similar to' : 'Similar to';
    return `${prefix} ${where}: ${why}.`.slice(0, 500);
  }

  /**
   * Pick the freshest of several candidates. Used after regeneration attempts
   * are exhausted: shipping the least-repetitive attempt beats shipping the
   * last one just because it was last.
   */
  function pickBest(candidates, context) {
    let best = null;
    for (const candidate of candidates) {
      const evaluation = evaluate(candidate, context);
      if (!best || evaluation.score < best.evaluation.score) best = { candidate, evaluation };
    }
    return best;
  }

  return {
    evaluate,
    describe,
    pickBest,
    fingerprint,
    compareFingerprints,
    platformCopyTooSimilar,
  };
}

export const contentUniquenessService = createContentUniquenessService();
export default contentUniquenessService;
