/**
 * Content style guard — enforces human-sounding copy AFTER the model returns.
 *
 * Instructions alone do not hold. A model told "never use an em dash" will use
 * one every few generations, and a model told "avoid generic phrases" will
 * still open with "In today's digital world". So generated copy is inspected
 * and either repaired or rejected here, on the way out.
 *
 * Two different problems, two different treatments:
 *
 *   DASHES are punctuation. The sentence around an em dash is usually fine, so
 *   the character is REPAIRED in place — swapped for the punctuation a person
 *   would have typed. Rejecting the whole post over a dash would burn a
 *   generation for nothing.
 *
 *   BANNED PHRASES are not punctuation, they are empty thinking. "Take your
 *   business to the next level" cannot be repaired by substitution, because the
 *   sentence has no content to keep. These force a REGENERATION.
 */

import { BANNED_DASHES, BANNED_PHRASES, HEADLINE_RULES } from '../config/constants.js';

const DASH_CLASS = `[${BANNED_DASHES.join('')}]`;
/*
 * Two regexes on purpose. A /g regex is STATEFUL under .test() — lastIndex
 * advances between calls, so a shared global regex returns false on every
 * other call. The detector must be non-global; only the replacer is global.
 */
const DASH_TEST = new RegExp(DASH_CLASS);
const DASH_ALL = new RegExp(DASH_CLASS, 'g');

/**
 * Replace em/en dashes with the punctuation a person would have used.
 *
 * " — " between clauses becomes a period + capital where that reads naturally,
 * otherwise a comma. A dash between numbers or words ("9–5", "cost–benefit")
 * becomes a hyphen, which is what was meant.
 */
export function stripDashes(value) {
  if (typeof value !== 'string' || !value) return typeof value === 'string' ? value : '';
  let out = value;

  // Leading/trailing dashes carry no clause, so drop them before the clause
  // rules run — otherwise "— Leading dash" would gain a stray period.
  out = out.replace(new RegExp(`^\\s*${DASH_CLASS}\\s*`), '');
  out = out.replace(new RegExp(`\\s*${DASH_CLASS}\\s*$`), '');

  // Unspaced dash between characters ("9–5", "cost–benefit"): a hyphen is what
  // was meant. Do this before the clause rules so it is not read as a break.
  out = out.replace(new RegExp(`(\\w)${DASH_CLASS}(\\w)`, 'g'), '$1-$2');

  // Spaced dash between clauses: "text — more text" -> "text. More text"
  out = out.replace(
    new RegExp(`\\s*${DASH_CLASS}\\s+([a-z])`, 'g'),
    (_m, next) => `. ${next.toUpperCase()}`,
  );
  // Spaced dash before a capital or digit: the clause stands alone.
  out = out.replace(new RegExp(`\\s*${DASH_CLASS}\\s+`, 'g'), '. ');
  // Anything left (doubled, or against punctuation): drop it.
  out = out.replace(DASH_ALL, '');

  // Tidy artefacts the substitution can leave behind.
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').replace(/\.\s*\./g, '.').trim();
  return out;
}

/** True when any banned dash character is present. */
export function hasBannedDash(value) {
  return typeof value === 'string' && DASH_TEST.test(value);
}

/**
 * Banned phrases found in a string, lowercased.
 * Word-boundary matched so "dive into" does not fire on "divers".
 */
export function findBannedPhrases(value) {
  if (typeof value !== 'string' || !value) return [];
  const haystack = value.toLowerCase();
  return BANNED_PHRASES.filter((phrase) => haystack.includes(phrase));
}

/** Word count of a headline, ignoring punctuation. */
export function wordCount(value) {
  if (typeof value !== 'string') return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Is this headline the right shape for a social visual?
 *
 * Too short and it reads as a slogan; too long and it wraps to four lines and
 * has to be shrunk into illegibility.
 */
export function headlineIssues(headline) {
  const issues = [];
  const words = wordCount(headline);
  if (words === 0) {
    issues.push('empty headline');
    return issues;
  }
  if (words < HEADLINE_RULES.MIN_WORDS) issues.push('headline is too short to say anything');
  if (words > HEADLINE_RULES.MAX_WORDS) issues.push('headline is too long for a visual');
  if (typeof headline === 'string' && headline.length > HEADLINE_RULES.MAX_CHARS) {
    issues.push('headline will not fit on two lines');
  }
  return issues;
}

/**
 * Clean one generated post in place and report what could not be cleaned.
 *
 * @param {object} content the parsed generator output
 * @returns {{ content, repaired: string[], rejections: string[] }}
 *          `repaired`   — fields whose punctuation was fixed
 *          `rejections` — reasons this post should be regenerated
 */
export function applyStyleGuard(content) {
  const repaired = [];
  const rejections = [];
  const out = { ...content };

  const textFields = ['caption', 'headline', 'subheadline', 'summary', 'imageAltText'];
  for (const field of textFields) {
    if (typeof out[field] !== 'string') continue;
    if (hasBannedDash(out[field])) {
      out[field] = stripDashes(out[field]);
      repaired.push(field);
    }
  }

  // Structured extras carry copy too, and the same rules apply to them.
  if (Array.isArray(out.bullets)) {
    out.bullets = out.bullets.map((b) => {
      if (typeof b === 'string' && hasBannedDash(b)) {
        repaired.push('bullets');
        return stripDashes(b);
      }
      return b;
    });
  }
  if (out.stat && typeof out.stat === 'object') {
    for (const key of ['value', 'label']) {
      if (typeof out.stat[key] === 'string' && hasBannedDash(out.stat[key])) {
        out.stat = { ...out.stat, [key]: stripDashes(out.stat[key]) };
        repaired.push(`stat.${key}`);
      }
    }
  }
  if (out.comparison && typeof out.comparison === 'object') {
    const fix = (v) => (typeof v === 'string' && hasBannedDash(v) ? stripDashes(v) : v);
    const fixList = (list) => (Array.isArray(list) ? list.map(fix) : list);
    const before = JSON.stringify(out.comparison);
    out.comparison = {
      ...out.comparison,
      leftTitle: fix(out.comparison.leftTitle),
      rightTitle: fix(out.comparison.rightTitle),
      leftItems: fixList(out.comparison.leftItems),
      rightItems: fixList(out.comparison.rightItems),
    };
    if (JSON.stringify(out.comparison) !== before) repaired.push('comparison');
  }

  // Banned phrases: not repairable, so the post is rejected for regeneration.
  const phraseHits = new Set();
  for (const field of ['caption', 'headline', 'subheadline']) {
    for (const hit of findBannedPhrases(out[field])) phraseHits.add(hit);
  }
  if (phraseHits.size) {
    rejections.push(`generic marketing phrasing: ${[...phraseHits].slice(0, 3).join(', ')}`);
  }

  for (const issue of headlineIssues(out.headline)) rejections.push(issue);

  // A caption that says nothing is worse than no caption.
  if (typeof out.caption !== 'string' || out.caption.trim().length < 40) {
    rejections.push('caption is too thin to be useful');
  }

  return { content: out, repaired: [...new Set(repaired)], rejections: [...new Set(rejections)] };
}

export default {
  applyStyleGuard,
  stripDashes,
  hasBannedDash,
  findBannedPhrases,
  headlineIssues,
  wordCount,
};
