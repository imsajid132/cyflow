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

import {
  BANNED_DASHES,
  BANNED_PHRASES,
  HEADLINE_RULES,
  POST_COPY_RULES,
  POST_COPY_TARGETS,
  PARAGRAPH_MAX_WORDS,
  UNSUPPORTED_CLAIM_PHRASES,
  UNSUPPORTED_CLAIM_PATTERNS,
  CONSONANT_SOUND_VOWEL_WORDS,
  VOWEL_SOUND_CONSONANT_WORDS,
  PLATFORM_LABELS,
} from '../config/constants.js';

/* Compiled once. Each pattern matches a figure attached to a claim context. */
const CLAIM_REGEXPS = UNSUPPORTED_CLAIM_PATTERNS.map((src) => new RegExp(src, 'i'));

const DASH_CLASS = `[${BANNED_DASHES.join('')}]`;
/*
 * Two regexes on purpose. A /g regex is STATEFUL under .test() — lastIndex
 * advances between calls, so a shared global regex returns false on every
 * other call. The detector must be non-global; only the replacer is global.
 */
const DASH_TEST = new RegExp(DASH_CLASS);
const DASH_ALL = new RegExp(DASH_CLASS, 'g');

/*
 * Horizontal whitespace only: spaces and tabs, never a newline.
 *
 * This distinction is the whole reason the repair is safe. `\s` matches `\n`,
 * so tidying with /\s{2,}/ -> ' ' silently welded a real 3-paragraph post into
 * one block the moment it contained a dash. The blank lines between paragraphs
 * are structure, not whitespace to be cleaned up.
 */
const H = '[^\\S\\r\\n]';

/** Repair the dashes inside ONE line. Never sees a newline. */
function repairDashesInLine(line) {
  if (!DASH_TEST.test(line)) return line;
  let out = line;

  // Leading/trailing dashes carry no clause, so drop them before the clause
  // rules run — otherwise "— Leading dash" would gain a stray period.
  out = out.replace(new RegExp(`^${H}*${DASH_CLASS}${H}*`), '');
  out = out.replace(new RegExp(`${H}*${DASH_CLASS}${H}*$`), '');

  // Unspaced dash between characters ("9–5", "cost–benefit"): a hyphen is what
  // was meant. Do this before the clause rules so it is not read as a break.
  out = out.replace(new RegExp(`(\\w)${DASH_CLASS}(\\w)`, 'g'), '$1-$2');

  // Spaced dash between clauses: "text — more text" -> "text. More text"
  out = out.replace(
    new RegExp(`${H}*${DASH_CLASS}${H}+([a-z])`, 'g'),
    (_m, next) => `. ${next.toUpperCase()}`,
  );
  // Spaced dash before a capital or digit: the clause stands alone.
  out = out.replace(new RegExp(`${H}*${DASH_CLASS}${H}+`, 'g'), '. ');
  // Anything left (doubled, or against punctuation): drop it.
  out = out.replace(DASH_ALL, '');

  // Tidy artefacts the substitution can leave behind.
  out = out
    .replace(new RegExp(`${H}{2,}`, 'g'), ' ')
    .replace(new RegExp(`${H}+([.,!?;:])`, 'g'), '$1')
    .replace(new RegExp(`\\.${H}*\\.`, 'g'), '.');
  return out;
}

/**
 * Replace em/en dashes with the punctuation a person would have used.
 *
 * " — " between clauses becomes a period + capital where that reads naturally,
 * otherwise a comma. A dash between numbers or words ("9–5", "cost–benefit")
 * becomes a hyphen, which is what was meant.
 *
 * Each line is repaired independently and rejoined with its ORIGINAL newline
 * runs, so a post's paragraph breaks come out exactly as they went in.
 */
export function stripDashes(value) {
  if (typeof value !== 'string' || !value) return typeof value === 'string' ? value : '';
  return value
    .split(/(\n+)/)
    .map((chunk) => (chunk.startsWith('\n') ? chunk : repairDashesInLine(chunk)))
    .join('')
    .trim();
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

const CONSONANT_SOUND = new Set(CONSONANT_SOUND_VOWEL_WORDS);
const VOWEL_SOUND = new Set(VOWEL_SOUND_CONSONANT_WORDS);

/**
 * Which article a word takes.
 *
 * English decides this by SOUND, not spelling, which is why a naive
 * "starts with aeiou" test is wrong in both directions: it would reject the
 * correct "a user" and accept the incorrect "a SEO audit". The two exception
 * lists carry the cases that actually occur in this product's vocabulary; an
 * unknown word falls back to the letter, which is right most of the time.
 *
 * An ALL-CAPS initialism is read letter by letter, so its article follows the
 * sound of its first letter's NAME: "an S", "an F", "an M".
 */
const LETTER_NAME_STARTS_WITH_VOWEL = new Set(['a', 'e', 'f', 'h', 'i', 'l', 'm', 'n', 'o', 'r', 's', 'x']);

export function expectedArticle(word) {
  if (!word) return null;
  const bare = word.replace(/[^\p{L}\p{N}-]/gu, '');
  if (!bare) return null;
  const lower = bare.toLowerCase();

  if (CONSONANT_SOUND.has(lower)) return 'a';
  if (VOWEL_SOUND.has(lower)) return 'an';

  /*
   * A hyphenated compound takes the article of its FIRST element: "a one-page
   * site", "an hour-long call". Checking the whole token would miss these,
   * because "one-page" is not a word anyone lists.
   */
  if (lower.includes('-')) {
    const [head] = lower.split('-');
    if (CONSONANT_SOUND.has(head)) return 'a';
    if (VOWEL_SOUND.has(head)) return 'an';
  }

  // An initialism the reader spells out: SEO, FAQ, RSS. Two or more capitals
  // and no lower-case letters.
  if (/^[A-Z0-9-]{2,}$/.test(bare) && /[A-Z]/.test(bare)) {
    return LETTER_NAME_STARTS_WITH_VOWEL.has(lower[0]) ? 'an' : 'a';
  }

  return /^[aeiou]/.test(lower) ? 'an' : 'a';
}

/**
 * Obvious article errors: "a agency", "a SEO audit", "an website", "an user".
 *
 * Deliberately narrow. This is not a grammar checker; it catches the specific,
 * unambiguous a/an mistake that makes a post read as machine-written, and it
 * stays quiet about anything it cannot be certain of. A false accusation here
 * would burn a generation for nothing.
 *
 * Returns the exact pairs found, so the retry can be told precisely what to fix
 * rather than having the text silently rewritten underneath the writer.
 */
export function findArticleErrors(value) {
  if (typeof value !== 'string' || !value) return [];
  const out = [];
  const seen = new Set();
  const re = /\b(a|an|A|An)\s+([\p{L}][\p{L}\p{N}-]*)/gu;
  let match = re.exec(value);
  while (match) {
    const [, article, word] = match;
    const expected = expectedArticle(word);
    if (expected && expected !== article.toLowerCase()) {
      const found = `${article.toLowerCase()} ${word}`;
      if (!seen.has(found)) {
        seen.add(found);
        out.push({ found, expected: `${expected} ${word}` });
      }
    }
    match = re.exec(value);
  }
  return out;
}

/**
 * Unsupported claims in a string: invented experience, results, counts, or
 * reputation. Returns short reasons, not the matched text, so nothing sensitive
 * or misleading is echoed back.
 *
 * A number is only a claim in a claim CONTEXT. "Check the joints each spring"
 * and "resize to 800px" carry numbers and are fine; "helped over 500 clients"
 * and "a 50% increase" are not.
 */
export function findUnsupportedClaims(value) {
  if (typeof value !== 'string' || !value) return [];
  const haystack = value.toLowerCase();
  const reasons = [];
  for (const phrase of UNSUPPORTED_CLAIM_PHRASES) {
    if (haystack.includes(phrase)) {
      reasons.push('claims experience or results the business did not provide');
      break;
    }
  }
  for (const re of CLAIM_REGEXPS) {
    if (re.test(value)) {
      reasons.push('states a number (a count, a result, or a rating) that is not a verified fact');
      break;
    }
  }
  return reasons;
}

/** Word count of a headline, ignoring punctuation. */
export function wordCount(value) {
  if (typeof value !== 'string') return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * The raw blocks of a post: every non-empty line, trimmed.
 *
 * Any run of newlines is a break, not just a blank line: Facebook, Instagram
 * and Threads all render a single newline as a new line, so that is what a
 * reader sees regardless of which the model emitted.
 *
 * This is a LINE splitter and nothing more. It cannot tell a paragraph from a
 * checklist item, and using it to count paragraphs is the defect that made
 * every checklist post unpublishable — see analyzeStructure below. Kept for
 * what it is actually good for: proving a repair did not weld a post's line
 * breaks together.
 */
export function blocksOf(text) {
  if (typeof text !== 'string') return [];
  return text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

/** @deprecated Misleading name for a line splitter. Use blocksOf or analyzeStructure. */
export const paragraphsOf = blocksOf;

/**
 * Bullet and number markers a model actually emits.
 *
 * Deliberately broad: the model is told not to add markers and adds them
 * anyway, in whichever glyph it feels like. An en/em dash marker is included
 * because the model emits them despite the dash ban, and a line that opens with
 * one is a list item, not a sentence with bad punctuation.
 */
const LIST_MARKER = /^\s*(?:[-*•·‣▪◦–—]|\d+[.)]|\(\d+\)|[a-z][.)])\s+/i;

/** A line that is nothing but hashtags. */
const HASHTAG_ONLY_LINE = /^\s*(?:#[\p{L}\p{N}_]+[\s,]*)+$/u;
const HASHTAG_TOKEN = /#[\p{L}\p{N}_]{2,}/gu;

/**
 * Normalize generated copy to one deterministic shape before anything measures it.
 *
 * A model returns CRLF, lone CR, trailing spaces, whitespace-only "blank" lines
 * that are not actually empty, and three blank lines where it meant one break.
 * Measuring any of that directly makes the verdict depend on invisible
 * characters, which makes a repair loop chase noise.
 */
export function normalizeCopy(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n?/g, '\n')
    // A line of spaces or tabs is a blank line. It does not look like content
    // and must not count as one.
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * What this post actually IS, structurally.
 *
 * THE DEFECT THIS EXISTS TO FIX: everything counted paragraphs with a line
 * splitter, so a checklist item was a paragraph. A good Threads checklist — one
 * intro and five bullets, 68 words, mid-band — measured as "6 paragraphs"
 * against an allowed 1 to 3, and could never pass however well it was written.
 *
 * Worse, it made the repair loop incoherent. A short checklist was told "add
 * 40 words" and "cut to 2 to 4 paragraphs" in the same breath. The only way to
 * add words to a checklist is more items, and every item counted as a
 * paragraph, so the two instructions contradicted each other. The observed
 * result was a retry that fixed the word count and drove the paragraph count
 * from 11 to 14 — not a bad model, an impossible instruction.
 *
 * Five different things live in a post and are counted separately:
 *
 *   prose     — a real paragraph, the thing the band is about
 *   list      — a contiguous run of bullets or numbered items: ONE block
 *   listItem  — an individual bullet inside a list block
 *   hashtags  — a line that is only tags (they belong in their own field)
 *   cta       — a closing line; still prose, but reported so a repair can see it
 *
 * @returns {{ blocks, words, proseParagraphs, listBlocks, listItems,
 *             longestProseParagraph, hashtagsInCopy, normalized }}
 */
export function analyzeStructure(caption) {
  const normalized = normalizeCopy(caption);
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);

  const blocks = [];
  for (const line of lines) {
    if (HASHTAG_ONLY_LINE.test(line)) {
      blocks.push({ type: 'hashtags', text: line });
      continue;
    }
    if (LIST_MARKER.test(line)) {
      const text = line.replace(LIST_MARKER, '').trim();
      const last = blocks[blocks.length - 1];
      // Contiguous items are ONE list block. A five-item checklist is one
      // structural element in a post, not five.
      if (last?.type === 'list') last.items.push(text);
      else blocks.push({ type: 'list', items: [text] });
      continue;
    }
    blocks.push({ type: 'prose', text: line });
  }

  const prose = blocks.filter((b) => b.type === 'prose');
  const lists = blocks.filter((b) => b.type === 'list');

  return {
    blocks,
    normalized,
    words: wordCount(normalized),
    proseParagraphs: prose.length,
    listBlocks: lists.length,
    listItems: lists.reduce((n, b) => n + b.items.length, 0),
    longestProseParagraph: prose.reduce((max, b) => Math.max(max, wordCount(b.text)), 0),
    hashtagsInCopy: (normalized.match(HASHTAG_TOKEN) || []).length,
  };
}

/** How a platform is named in a message a person reads. */
const label = (platform) => PLATFORM_LABELS[platform] ?? platform;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * What this post copy actually IS, measured.
 *
 * Separate from the verdict because a repair attempt has to be TOLD the counts,
 * not just told it failed. "Threads has 44 words; the minimum is 45" is a
 * sentence a writer can act on. "could not be written to a valid length or
 * shape" is not, and that string is exactly what planner item 31 stored nine
 * times while the number it needed was sitting one stack frame away.
 *
 * @returns {{ words, paragraphs, longestParagraph, rules }|null} null when the
 *          platform is unknown, because measuring against no rules is guessing.
 */
export function measurePostCopy(caption, platform) {
  const rules = POST_COPY_RULES[platform];
  if (!rules) return null;
  const s = analyzeStructure(caption);
  return {
    words: s.words,
    // PROSE paragraphs. Counting list items here is what made every checklist
    // post fail on structure no matter how well it was written.
    paragraphs: s.proseParagraphs,
    longestParagraph: s.longestProseParagraph,
    listBlocks: s.listBlocks,
    listItems: s.listItems,
    hashtagsInCopy: s.hashtagsInCopy,
    rules,
  };
}

/**
 * Is this real post copy for this platform, or a caption wearing a post's name?
 *
 * The bands are per-platform and Threads' does not overlap Facebook's, so a
 * trimmed Instagram post cannot pass as a Threads post on length alone.
 *
 * Every message names the platform and carries the REAL number next to the
 * required one. These are shown to users on the planner board and fed back to
 * the writer on a repair attempt, so they are written as sentences rather than
 * as log lines, and none of them is ever collapsed into a generic summary.
 *
 * Returns [] for an unknown platform: this guard reports on what it can judge,
 * and a caller that does not say which platform it is writing for does not get
 * a length verdict invented for it.
 */
/*
 * A structurally complete post that lands a few words under the minimum is
 * repairable, not broken.
 *
 * Staging failed a 124-word Facebook post terminally because the minimum is 130.
 * The repair loop still TRIES to reach the floor (postCopyIssues flags the
 * shortfall, targetBandFor raises the ask), so this tolerance is NOT applied
 * here — flagging is what makes the repair happen. It is applied at the final
 * decision (isCompleteWithinTolerance), so a complete post that the model could
 * not push those last few words over is accepted instead of thrown away.
 */
export const WORD_MIN_TOLERANCE = 12;

/**
 * After the repair attempts are spent, is this post complete and only a few
 * words short — accept it — or genuinely wrong — fail it?
 *
 * "Complete" means the structure is right: paragraphs in range, no wall-of-text
 * paragraph, no hashtags in the prose, and within the word tolerance of the
 * minimum (and never over the maximum). This is the "accept a small tolerance
 * when content is complete" path, kept separate from a similarity rewrite.
 */
export function isCompleteWithinTolerance(caption, platform) {
  const m = measurePostCopy(caption, platform);
  if (!m || m.words === 0) return false;
  const { rules } = m;
  const structurallyComplete = m.paragraphs >= rules.MIN_PARAGRAPHS
    && m.paragraphs <= rules.MAX_PARAGRAPHS
    && m.longestParagraph <= PARAGRAPH_MAX_WORDS
    && m.hashtagsInCopy === 0
    && m.words <= rules.MAX_WORDS;
  const shortfall = rules.MIN_WORDS - m.words;
  return structurallyComplete && shortfall >= 0 && shortfall <= WORD_MIN_TOLERANCE;
}

export function postCopyIssues(caption, platform) {
  const m = measurePostCopy(caption, platform);
  if (!m) return [];
  const { rules } = m;
  const who = label(platform);

  if (m.words === 0) return [`${who} has no post copy`];

  const issues = [];
  if (m.words < rules.MIN_WORDS) {
    issues.push(`${who} has ${plural(m.words, 'word', 'words')}; the minimum is ${rules.MIN_WORDS}`);
  }
  if (m.words > rules.MAX_WORDS) {
    issues.push(`${who} has ${plural(m.words, 'word', 'words')}; the maximum is ${rules.MAX_WORDS}`);
  }
  /*
   * PROSE paragraphs. The word is load-bearing now and appears in the message,
   * because "Instagram has 11 paragraphs" over a post with two paragraphs and
   * nine bullets was not just wrong, it was an instruction the writer could not
   * follow: cutting to 4 meant deleting the checklist it had been asked for.
   */
  if (m.paragraphs < rules.MIN_PARAGRAPHS || m.paragraphs > rules.MAX_PARAGRAPHS) {
    issues.push(
      `${who} has ${plural(m.paragraphs, 'prose paragraph', 'prose paragraphs')}; `
      + `it needs ${rules.MIN_PARAGRAPHS} to ${rules.MAX_PARAGRAPHS}`
      + (m.listItems ? ` (its ${plural(m.listItems, 'list item', 'list items')} are not counted)` : ''),
    );
  }

  // Word count alone does not make a post readable: 160 words in one lump
  // satisfies the band and is still a wall of text. Applies to prose only — a
  // list is meant to be scanned, and its length is governed by the word band.
  if (m.longestParagraph > PARAGRAPH_MAX_WORDS) {
    issues.push(
      `${who} has a prose paragraph of ${plural(m.longestParagraph, 'word', 'words')}; `
      + `the maximum for one paragraph is ${PARAGRAPH_MAX_WORDS}`,
    );
  }

  // Hashtags belong in the hashtags array, at the end, not woven into a
  // sentence. A tag inside the prose is the caption habit this replaces.
  if (m.hashtagsInCopy > 0) {
    issues.push(
      `${who} has ${plural(m.hashtagsInCopy, 'hashtag', 'hashtags')} inside the post copy; `
      + 'they belong in the hashtags field',
    );
  }
  return issues;
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
 * @param {{ platform?: string }} [options] which platform's post copy rules to
 *        apply. Omitted, the length and paragraph rules are skipped — this guard
 *        does not invent a verdict for a caller that did not say what it wrote.
 * @returns {{ content, repaired: string[], rejections: string[] }}
 *          `repaired`   — fields whose punctuation was fixed
 *          `rejections` — reasons this post should be regenerated
 */
export function applyStyleGuard(content, { platform } = {}) {
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

  /*
   * Every reason below names the platform when the caller said which one it is.
   * A failed item can carry reasons from more than one platform at once, and
   * "contains the grammar error" without a subject leaves the reader (and the
   * repair) guessing which post to fix.
   */
  const who = PLATFORM_LABELS[platform] ?? null;
  const on = (text) => (who ? `${who} ${text}` : `this post ${text}`);

  // Banned phrases: not repairable, so the post is rejected for regeneration.
  const phraseHits = new Set();
  for (const field of ['caption', 'headline', 'subheadline']) {
    for (const hit of findBannedPhrases(out[field])) phraseHits.add(hit);
  }
  if (phraseHits.size) {
    rejections.push(on(`uses generic marketing phrasing: ${[...phraseHits].slice(0, 3).join(', ')}`));
  }

  // Unsupported claims: invented experience, results, counts, or reputation.
  // Not repairable either — the sentence has to be rewritten around a real
  // point, so this forces a regeneration.
  const claimHits = new Set();
  for (const field of ['caption', 'headline', 'subheadline']) {
    for (const reason of findUnsupportedClaims(out[field])) claimHits.add(reason);
  }
  for (const reason of claimHits) rejections.push(on(`makes an unsupported claim: it ${reason}`));

  /*
   * Obvious article errors ("a agency", "a SEO audit").
   *
   * REJECTED, not repaired. Swapping the article in place would silently edit a
   * sentence nobody has read, and a writer that produced "a agency" usually has
   * more wrong with the line than its article. The reason names the exact pair
   * and the correction, so the retry is told what to fix rather than being sent
   * back empty-handed.
   */
  const articleHits = [];
  for (const field of ['caption', 'headline', 'subheadline']) {
    for (const hit of findArticleErrors(out[field])) articleHits.push(hit);
  }
  if (articleHits.length) {
    const detail = articleHits.slice(0, 3).map((h) => `"${h.found}" should be "${h.expected}"`).join(', ');
    rejections.push(on(`contains the grammar error ${detail}`));
  }

  for (const issue of headlineIssues(out.headline)) rejections.push(issue);

  /*
   * Post copy shape. When the platform is known this is the real check: a
   * one-sentence advert fails it, and so does a 160-word single block.
   *
   * When it is not known, fall back to the old floor — something is better than
   * nothing, and this path is still used by callers that generate for a
   * platform they do not name.
   */
  if (POST_COPY_RULES[platform]) {
    for (const issue of postCopyIssues(out.caption, platform)) rejections.push(issue);
  } else if (typeof out.caption !== 'string' || out.caption.trim().length < 40) {
    rejections.push('post copy is too thin to be useful');
  }

  return { content: out, repaired: [...new Set(repaired)], rejections: [...new Set(rejections)] };
}

/**
 * The band a repair attempt should aim at, and which way to lean.
 *
 * The first two attempts aim at the plain safe target. A third attempt has
 * already missed twice, so it is given the narrower band pushed AWAY from the
 * edge it actually missed: copy that came in short is aimed at the upper half,
 * copy that ran long at the lower half. Aiming a repeatedly-short writer at the
 * same midpoint that already failed twice is not a different instruction.
 *
 * @param {string} platform
 * @param {number} attempt zero-based
 * @param {{words:number}|null} last the previous attempt's measurement
 */
export function targetBandFor(platform, attempt = 0, last = null) {
  const target = POST_COPY_TARGETS[platform];
  if (!target) return null;
  if (attempt < 2) return { min: target.MIN_WORDS, max: target.MAX_WORDS };

  const rules = POST_COPY_RULES[platform];
  if (last && rules) {
    // Came in short: aim high in the narrow band. Ran long: aim low.
    if (last.words < rules.MIN_WORDS) return { min: target.NARROW_MAX, max: target.MAX_WORDS };
    if (last.words > rules.MAX_WORDS) return { min: target.MIN_WORDS, max: target.NARROW_MIN };
  }
  return { min: target.NARROW_MIN, max: target.NARROW_MAX };
}

/**
 * Tell the next attempt exactly what the last one measured and what to do.
 *
 * This is the difference between a repair and a re-roll. A writer told only
 * "rejected" produces another near-miss; a writer told "you wrote 44 words, the
 * floor is 45, aim for 62 to 85, and add a real detail rather than padding"
 * has something to act on.
 *
 * The anti-filler line is not decoration. The cheapest way to answer "you are
 * one word short" is to bolt on "Get in touch today!", which passes the count
 * and makes the post worse. Nothing in this codebase appends words to fix a
 * word count; the shortage is always sent back to the writer with the
 * instruction to add something real.
 *
 * @returns {string[]} short lines, safe to hand to the model verbatim
 */
export function repairGuidance(caption, platform, attempt = 0) {
  const m = measurePostCopy(caption, platform);
  const band = targetBandFor(platform, attempt, m);
  if (!m || !band) return [];
  const who = label(platform);
  const { rules } = m;

  /*
   * The measurement, stated so the two halves cannot contradict each other.
   *
   * The old guidance said "you have N paragraphs" while counting bullets as
   * paragraphs, and then asked for more words. For a checklist those are
   * opposite instructions: more words means more items means more "paragraphs".
   * Naming prose and list items separately is what makes the pair satisfiable —
   * "keep your 2 paragraphs, add 2 more items" is an instruction that works.
   */
  const shape = [
    `${plural(m.words, 'word', 'words')}`,
    `${plural(m.paragraphs, 'prose paragraph', 'prose paragraphs')}`,
    ...(m.listItems ? [`${plural(m.listItems, 'list item', 'list items')}`] : []),
  ].join(', ');
  const lines = [`your last ${who} attempt measured ${shape}`];

  if (m.words < rules.MIN_WORDS) {
    const short = rules.MIN_WORDS - m.words;
    lines.push(
      `that is ${plural(short, 'word', 'words')} below the ${rules.MIN_WORDS} minimum: `
      + (m.listItems
        // A checklist grows by saying more in each item, or by adding one real
        // check. Telling it to "add a sentence" produces a stray paragraph and
        // breaks the prose band it is already passing.
        ? 'make each list item say something concrete, or add ONE more genuinely '
          + 'useful check. Do NOT add prose paragraphs and do NOT pad with filler'
        : 'add a useful sentence (a concrete example, a clarification, or a practical '
          + 'detail). Do NOT pad with filler, restatement, or a longer sign-off'),
    );
  } else if (m.words > rules.MAX_WORDS) {
    lines.push(
      `that is ${plural(m.words - rules.MAX_WORDS, 'word', 'words')} over the ${rules.MAX_WORDS} maximum: `
      + (m.listItems
        ? 'drop a whole list item, or tighten each one. Do not delete the intro'
        : 'cut a whole point rather than trimming every sentence'),
    );
  }
  if (m.paragraphs < rules.MIN_PARAGRAPHS || m.paragraphs > rules.MAX_PARAGRAPHS) {
    lines.push(
      `use ${rules.MIN_PARAGRAPHS} to ${rules.MAX_PARAGRAPHS} PROSE paragraphs `
      + '(separate each with a blank line)'
      + (m.listItems
        ? `. Your ${plural(m.listItems, 'list item', 'list items')} are not paragraphs `
          + 'and do not count towards this: keep the list'
        : ''),
    );
  }
  if (m.longestParagraph > PARAGRAPH_MAX_WORDS) {
    lines.push(
      `one prose paragraph runs to ${plural(m.longestParagraph, 'word', 'words')}; `
      + `split it, or move part of it into the list. The maximum is ${PARAGRAPH_MAX_WORDS}`,
    );
  }
  if (m.hashtagsInCopy > 0) {
    lines.push(
      `remove the ${plural(m.hashtagsInCopy, 'hashtag', 'hashtags')} from the post copy: `
      + 'they are returned in the hashtags field, not written into the text',
    );
  }
  lines.push(`return approximately ${band.min} to ${band.max} words for ${who}`);
  return lines;
}

export default {
  applyStyleGuard,
  stripDashes,
  hasBannedDash,
  findBannedPhrases,
  findUnsupportedClaims,
  findArticleErrors,
  expectedArticle,
  headlineIssues,
  postCopyIssues,
  measurePostCopy,
  analyzeStructure,
  normalizeCopy,
  blocksOf,
  targetBandFor,
  repairGuidance,
  paragraphsOf,
  wordCount,
};
