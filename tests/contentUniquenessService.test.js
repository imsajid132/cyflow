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
  editorialBody,
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
    // The angle is a genuine repeat: same content type, goal AND service as POST.
    // The CTA now weighs little (it is brand boilerplate), so what pushes this to
    // "review" is the repeated angle — which is exactly what the ordering below
    // asserts must be named first, ahead of the shared CTA.
    contentType: 'educational', // same as POST
    goal: 'awareness', // same as POST
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

test('a shared brand contact footer does not make different-service posts similar', () => {
  /*
   * The staging defect: seven different-service posts that all end with the same
   * "Call (917)... visit site.com" contact footer were flagged as similar,
   * because the footer, the fixed CTA and the reused hashtags were compared as
   * if they were the content. The editorial fingerprint strips the footer and
   * the boilerplate weighs little, so genuinely different posts read as unique.
   */
  const foot = '\n\nCall (917) 415-1383 or visit nyc-waterproofing.com';
  const post = (svc, headline, body, ct, tpl) => ({
    caption: `${body}${foot}`,
    // A genuinely different headline per post, as the real per-service Make
    // output produces. A templated "${svc}: what to know" suffix would make two
    // services in one family ("Basement Waterproofing" / "Foundation
    // Waterproofing") share most headline tokens, which the headline axis is
    // supposed to catch. The footer, not the headline, is the boilerplate here.
    headline,
    cta: 'Book a free quote', // the same fixed brand CTA on every post
    hashtags: ['#waterproofing', '#nyc', '#basement'], // the same brand hashtags
    contentType: ct, goal: 'awareness', serviceEmphasis: svc, format: ct, templateKey: tpl,
  });
  const posts = [
    post('Basement Waterproofing', 'Where basement water actually comes from', 'Water enters through foundation cracks. Sealing the outside stops it at the source before it reaches the slab.', 'service_benefit', 'poster-service'),
    post('French Drain Installation', 'How a french drain keeps the footing dry', 'A French drain carries groundwater away from the footing so it never pools against the wall in the first place.', 'process', 'poster-project'),
    post('Sump Pump Installation', 'Your last line of defence against a flood', 'A sump pump is the last line of defence: it moves water out of the pit before it can rise into the finished space.', 'authority', 'poster-stat'),
    post('Foundation Waterproofing', 'The cracked wall that leaks for years', 'A cracked foundation wall lets moisture wick through the masonry for years before the damp finally shows inside.', 'common_mistake', 'poster-warning'),
    post('Basement Leak Inspection', 'Finding the entry point, not just the stain', 'An inspection finds the entry point, not just the symptom, so the repair addresses where the water actually comes in.', 'quick_tip', 'poster-cheatsheet'),
  ];
  const fps = posts.map((p) => fingerprint(p));
  for (let i = 0; i < fps.length; i += 1) {
    for (let j = i + 1; j < fps.length; j += 1) {
      const r = compareFingerprints(fps[i], fps[j]);
      assert.ok(r.score < 0.45, `posts ${i} and ${j} scored ${r.score} despite different services and topics`);
    }
  }
});

test('the editorial fingerprint still catches a real repeat that keeps the footer', () => {
  // Two posts with the SAME editorial body (only the footer would differ) must
  // still be caught: stripping boilerplate must not blind the detector to a real
  // duplicate.
  const body = 'Water enters through foundation cracks and sealing the outside stops it at the source before it reaches the slab.';
  const a = fingerprint({ caption: `${body}\n\nCall (917) 415-1383`, headline: 'Sealing works', serviceEmphasis: 'Basement Waterproofing' });
  const b = fingerprint({ caption: `${body}\n\nEmail us at hello@site.com`, headline: 'Sealing works', serviceEmphasis: 'Basement Waterproofing' });
  const r = compareFingerprints(a, b);
  assert.ok(r.score >= 0.6, `an identical editorial body must still be caught, scored ${r.score}`);
});

test('a dominant contact footer alone cannot flag two different-service posts', () => {
  /*
   * The isolation case, and the revert anchor for the boilerplate exclusion.
   *
   * Two genuinely different-service posts (basement sealing vs a sump pump)
   * carry the Make contractor footer: phone, email and website on separate
   * lines. That footer is the LONGEST thing on each post, so if it is compared
   * as content it dominates both the caption and the closing-paragraph axes and
   * drags two unrelated posts to "review". Stripping it (editorialBody) leaves
   * only the real, different editorial bodies, which score as unique.
   *
   * Measured: with the footer stripped the pair scores ~0.31 (unique); with it
   * included ~0.53 (review). So reverting either half of the fix — editorialBody
   * no longer stripping, or compareFingerprints no longer reading the editorial
   * trigrams — turns this assertion red. That is the intended teeth.
   */
  const footer = '\n\nCall our crew on (917) 415-1383 any day of the week.'
    + '\nEmail the office at hello@nyc-waterproofing.com.'
    + '\nVisit nyc-waterproofing.com to book a free inspection today.';
  const a = {
    caption: `Sealing a cracked foundation from the outside keeps groundwater from ever reaching the slab.${footer}`,
    headline: 'Where basement water comes from', cta: 'Book a free quote',
    hashtags: ['#waterproofing', '#nyc'], contentType: 'service_benefit', goal: 'awareness',
    serviceEmphasis: 'Basement Waterproofing',
  };
  const b = {
    caption: `A sump pump in the pit clears rising water before it can spread across a finished floor.${footer}`,
    headline: 'How a sump pump protects a finished basement', cta: 'Book a free quote',
    hashtags: ['#waterproofing', '#nyc'], contentType: 'process', goal: 'awareness',
    serviceEmphasis: 'Sump Pump Installation',
  };
  // The footer really is stripped, line by line, leaving only the body.
  assert.equal(editorialBody(a.caption).includes('415-1383'), false, 'the phone line is stripped');
  assert.equal(editorialBody(a.caption).includes('@'), false, 'the email line is stripped');
  assert.equal(editorialBody(a.caption).includes('nyc-waterproofing.com'), false, 'the website line is stripped');
  const result = svc.evaluate(a, { batch: [b] });
  assert.equal(result.verdict, 'unique', `a shared footer alone must not flag different-service posts, scored ${result.score}`);
});
