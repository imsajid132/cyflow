// Phase 4.7: the duplicate-prevention engine.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createContentUniquenessService,
  fingerprint,
  compareFingerprints,
  normalizeText,
  tokenize,
  trigrams,
  jaccard,
  firstSentence,
} from '../src/services/contentUniquenessService.js';
import { DUPLICATION_THRESHOLDS } from '../src/config/constants.js';

const svc = createContentUniquenessService();

const POST = {
  caption: 'Winter is hard on flat roofs. Book a free inspection before the rain sets in and we will show you exactly what needs doing.',
  headline: 'Roof repairs done right',
  cta: 'Book a free quote',
  hashtags: ['#roofing', '#london', '#homecare'],
  contentType: 'educational',
  goal: 'awareness',
  serviceEmphasis: 'Roof repair',
};

test('normalization strips urls, hashtags, punctuation and case', () => {
  assert.equal(normalizeText('Visit https://acme.com NOW! #roofing'), 'visit now');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText('  Multiple   spaces  '), 'multiple spaces');
});

test('tokenize drops stop words and single characters', () => {
  assert.deepEqual(tokenize('We are the best in the city'), ['best', 'city']);
  assert.deepEqual(tokenize(''), []);
});

test('trigrams and jaccard behave as the comparison relies on', () => {
  assert.ok(trigrams('roofing').has('roo'));
  assert.equal(jaccard([], ['a']), 0, 'an empty side must score 0, not NaN');
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1);
  assert.equal(jaccard(['a', 'b'], ['c', 'd']), 0);
  assert.equal(jaccard(new Set(['a', 'b', 'c']), new Set(['a', 'b'])), 2 / 3);
});

test('firstSentence isolates the opening line', () => {
  assert.equal(firstSentence('Book now. Then relax.'), 'Book now.');
  assert.equal(firstSentence('No terminator here'), 'No terminator here');
  assert.equal(firstSentence(''), '');
  assert.equal(firstSentence(null), '');
});

test('a fingerprint carries signals, never the caption text', () => {
  const fp = fingerprint(POST);
  const serialized = JSON.stringify(fp);
  // The raw sentence must not be recoverable from what we persist.
  assert.equal(serialized.includes('Book a free inspection before the rain'), false);
  assert.equal(serialized.includes('Winter is hard on flat roofs'), false);
  assert.ok(fp.captionTrigrams.length > 0);
  assert.equal(fp.contentType, 'educational');
  assert.deepEqual(fp.hashtags.sort(), ['homecare', 'london', 'roofing']);
});

test('an identical post scores as a hard duplicate', () => {
  const result = svc.evaluate(POST, { batch: [POST] });
  assert.equal(result.verdict, 'duplicate');
  assert.ok(result.shouldRegenerate);
  assert.ok(result.score >= DUPLICATION_THRESHOLDS.REGENERATE);
  assert.ok(result.reasons.length > 0);
});

test('an identical headline alone fails the post, even with fresh copy', () => {
  // This is the averaging trap: five fresh axes must not hide one exact repeat.
  const other = {
    caption: 'Completely different wording about gutters and drainage systems in autumn months.',
    headline: 'Roof repairs done right',
    cta: 'Call the team',
    hashtags: ['#gutters'],
    contentType: 'tips',
    goal: 'engagement',
    serviceEmphasis: 'Gutter cleaning',
  };
  const result = svc.evaluate(POST, { batch: [other] });
  assert.ok(result.score >= DUPLICATION_THRESHOLDS.REGENERATE, `score was ${result.score}`);
  assert.ok(result.reasons.includes('identical headline'));
});

test('a genuinely different post is unique', () => {
  const other = {
    caption: 'Meet Dan, who has been fitting gutters with us for eleven years and still turns up early.',
    headline: 'Eleven years on the tools',
    cta: 'Meet the team',
    hashtags: ['#team', '#craft'],
    contentType: 'authority',
    goal: 'trust_building',
    serviceEmphasis: 'Gutter cleaning',
  };
  const result = svc.evaluate(POST, { batch: [other] });
  assert.equal(result.verdict, 'unique');
  assert.equal(result.shouldRegenerate, false);
  assert.ok(result.score < DUPLICATION_THRESHOLDS.WARN, `score was ${result.score}`);
});

test('paraphrase is caught even when tokens differ', () => {
  const paraphrase = {
    ...POST,
    headline: 'Roofing repairs done properly',
    caption: 'Winter is tough on flat roofs. Book your free inspection before the rain sets in and we will show you exactly what needs doing.',
  };
  const result = svc.evaluate(paraphrase, { batch: [POST] });
  assert.ok(result.score >= DUPLICATION_THRESHOLDS.WARN, `paraphrase scored only ${result.score}`);
});

test('a formulaic opening line is flagged on its own', () => {
  const sameOpener = {
    caption: 'Winter is hard on flat roofs. Here is a totally unrelated point about skylight seals and ventilation.',
    headline: 'Skylight seals matter',
    cta: 'Ask a question',
    hashtags: ['#skylights'],
    contentType: 'tips',
    goal: 'education',
    serviceEmphasis: 'Skylights',
  };
  const result = svc.evaluate(sameOpener, { batch: [POST] });
  assert.ok(result.score >= DUPLICATION_THRESHOLDS.WARN, `opener repeat scored only ${result.score}`);
  assert.ok(result.reasons.some((r) => /opening/.test(r)));
});

test('reusing the same call to action alone is NOT repetition', () => {
  // A business is supposed to end every post with the same CTA. Flagging that
  // would train users to ignore the warnings.
  const sameCtaOnly = {
    caption: 'Ladders are fine for a look but not for a day of work up there on the ridge.',
    headline: 'Access matters more than you think',
    cta: 'Book a free quote', // identical to POST
    hashtags: ['#safety'],
    contentType: 'authority',
    goal: 'trust_building',
    serviceEmphasis: 'Scaffolding',
  };
  const result = svc.evaluate(sameCtaOnly, { batch: [POST] });
  assert.equal(result.axes.cta, 1, 'the CTA really is identical');
  assert.equal(result.verdict, 'unique', `a shared CTA alone scored ${result.score}`);
});

test('reusing the same hashtags alone is NOT repetition', () => {
  const sameTagsOnly = {
    caption: 'Moss thrives in shade. Scrubbing it off treats the symptom rather than the cause of it.',
    headline: 'Moss is a symptom',
    cta: 'Ask us anything',
    hashtags: ['#roofing', '#london', '#homecare'], // identical to POST
    contentType: 'authority',
    goal: 'education',
    serviceEmphasis: 'Cleaning',
  };
  const result = svc.evaluate(sameTagsOnly, { batch: [POST] });
  assert.equal(result.axes.hashtags, 1, 'the hashtags really are identical');
  assert.equal(result.verdict, 'unique', `shared hashtags alone scored ${result.score}`);
});

test('several soft signals together DO add up to a warning', () => {
  // Same angle + same service + same CTA + same tags, only the words differ.
  const softStack = {
    caption: 'Rain finds a way in once a seal gives up, and an early look saves money later down the line.',
    headline: 'Catch it early',
    cta: 'Book a free quote',
    hashtags: ['#roofing', '#london', '#homecare'],
    contentType: 'educational',
    goal: 'awareness',
    serviceEmphasis: 'Roof repair',
  };
  const result = svc.evaluate(softStack, { batch: [POST] });
  assert.notEqual(result.verdict, 'unique', `stacked soft signals scored only ${result.score}`);
});

test('a soft warning names its biggest cause first, not its smallest', () => {
  /*
   * The trap: a repeated ANGLE plus a shared CTA. The CTA contributes least but
   * is the most eye-catching phrase — reporting it first would tell the user
   * "you reused your CTA", which they meant to do, and they would dismiss a
   * warning that was really about a repeated angle.
   */
  const sameAngleSharedCta = {
    caption: 'A slipped tile lets water track along the batten for months before anything shows up inside.',
    headline: 'What a slipped tile really costs',
    cta: 'Book a free quote', // identical to POST
    hashtags: ['#tiles'], // different
    contentType: 'educational', // same as POST
    goal: 'education', // different from POST
    serviceEmphasis: 'Roof repair', // same as POST
  };
  const result = svc.evaluate(sameAngleSharedCta, { batch: [POST] });
  assert.equal(result.verdict, 'review');
  assert.ok(result.reasons.length >= 2, `expected several reasons, got ${JSON.stringify(result.reasons)}`);
  assert.match(result.reasons[0], /angle/, `the biggest cause must come first: ${JSON.stringify(result.reasons)}`);
  assert.ok(result.reasons.includes('the same call to action'));
  // ...and the note reads in that order too.
  assert.match(svc.describe(result), /angle.*call to action/);
});

test('the same angle on the same service is flagged as a repeated topic', () => {
  const sameAngle = {
    caption: 'Rain gets everywhere once a seal fails, so an early look saves money later on.',
    headline: 'Catch it early',
    cta: 'Get in touch',
    hashtags: ['#maintenance'],
    contentType: 'educational',
    goal: 'awareness',
    serviceEmphasis: 'Roof repair',
  };
  const result = svc.evaluate(sameAngle, { batch: [POST] });
  assert.ok(result.axes.topic >= 0.9, `topic axis was ${result.axes.topic}`);
});

test('no comparisons at all means unique, not a crash', () => {
  const result = svc.evaluate(POST, {});
  assert.equal(result.verdict, 'unique');
  assert.equal(result.score, 0);
  assert.equal(result.worst, null);
});

test('empty and malformed candidates never throw', () => {
  for (const bad of [{}, { caption: null }, { caption: '', headline: undefined, hashtags: 'nope' }]) {
    const result = svc.evaluate(bad, { batch: [POST] });
    assert.equal(typeof result.score, 'number');
    assert.ok(Number.isFinite(result.score));
  }
});

test('batch repetition is reported separately from history repetition', () => {
  const fromBatch = svc.evaluate(POST, { batch: [POST], recent: [] });
  assert.equal(fromBatch.worst.source, 'batch');
  const fromRecent = svc.evaluate(POST, { batch: [], recent: [POST] });
  assert.equal(fromRecent.worst.source, 'recent');
});

test('describe explains the problem without leaking the other post', () => {
  const evaluation = svc.evaluate(POST, { batch: [POST] });
  const note = svc.describe(evaluation);
  assert.match(note, /Too similar to another post in this plan/);
  assert.equal(note.includes('Winter is hard on flat roofs'), false);
  assert.ok(note.length <= 500);
  // A unique post has nothing to say.
  assert.equal(svc.describe({ verdict: 'unique' }), null);
  assert.equal(svc.describe(null), null);
});

test('pickBest returns the least repetitive attempt', () => {
  const attempts = [
    { ...POST }, // identical to the batch post
    {
      caption: 'Something entirely new about chimney flashing and lead work in older terraces.',
      headline: 'Lead work explained',
      cta: 'Read more',
      hashtags: ['#leadwork'],
      contentType: 'authority',
      goal: 'education',
      serviceEmphasis: 'Chimney',
    },
  ];
  const best = svc.pickBest(attempts, { batch: [POST] });
  assert.equal(best.candidate.headline, 'Lead work explained');
  assert.ok(best.evaluation.score < DUPLICATION_THRESHOLDS.WARN);
});

test('compareFingerprints is symmetric', () => {
  const a = fingerprint(POST);
  const b = fingerprint({ ...POST, headline: 'Different headline entirely here' });
  assert.equal(compareFingerprints(a, b).score, compareFingerprints(b, a).score);
});

test('a fingerprint can be re-used directly without re-deriving it', () => {
  const fp = fingerprint(POST);
  const fromRaw = svc.evaluate(POST, { batch: [POST] });
  const fromFingerprint = svc.evaluate(fp, { batch: [fp] });
  assert.equal(fromRaw.score, fromFingerprint.score);
});
