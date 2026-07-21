/**
 * Provider-error E2E acceptance (authenticated, headless Chrome), ONE scenario
 * per run, driven by the SAME REVIEW_ERR_* env the review server reads. The
 * expected safe label / message / retryable are derived from the production
 * model (userMessageFor / shortCategoryLabel / isRetryableCategory), so the test
 * proves the UI matches the model, not a hand-written copy of it.
 *
 * Boot:  REVIEW_ERR_KIND=image REVIEW_ERR_CATEGORY=rate_limited REVIEW_ERR_STATUS=429 \
 *        node tools/review-server.mjs 4899 --with-image-error-plan
 * Run:   REVIEW_ERR_KIND=image REVIEW_ERR_CATEGORY=rate_limited REVIEW_ERR_STATUS=429 \
 *        node tools/provider-error-e2e-smoke.mjs http://127.0.0.1:4899
 *
 * Asserts, per scenario: the inline card error, the provider name, the safe
 * category, the retryable flag, the recommended action, persistence across a
 * refresh, NO secret / DB id / raw provider body, the correct card state (no
 * bare "No image" for a known image failure), and — for image failures — that
 * Retry image leaves the caption byte-identical and the service/headline/CTA/
 * hashtags and the Exact-Make day type untouched.
 */
import { launch } from './cdp.mjs';
import { userMessageFor, shortCategoryLabel, isRetryableCategory } from '../src/utils/providerErrors.js';
import { PROVIDER_NAMES } from '../src/config/constants.js';

const BASE = process.argv[2] || 'http://127.0.0.1:4899';
const CREDS = { email: 'review@cyflow.test', password: 'Review-Pass-123456' };

const KIND = process.env.REVIEW_ERR_KIND || 'image';
const PROVIDER = process.env.REVIEW_ERR_PROVIDER || (KIND === 'content' ? PROVIDER_NAMES.OPENAI : PROVIDER_NAMES.HCTI);
const CATEGORY = process.env.REVIEW_ERR_CATEGORY || 'credits_exhausted';
const rawStatus = process.env.REVIEW_ERR_STATUS;
const STATUS = (rawStatus && rawStatus !== 'null') ? Number(rawStatus) : null;
const EXPECT = {
  message: userMessageFor(PROVIDER, CATEGORY),
  shortLabel: shortCategoryLabel(CATEGORY),
  retryable: isRetryableCategory(CATEGORY),
  providerUpper: PROVIDER.toUpperCase(),
};
const TAG = `[${KIND}:${PROVIDER}:${CATEGORY}${STATUS ? `:${STATUS}` : ''}]`;

let pass = 0; let fail = 0; const failures = [];
const ok = (c, label, detail = '') => {
  if (c) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; failures.push(label); console.log(`  FAIL ${label}${detail ? `  ${String(detail).slice(0, 160)}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Secrets / internal-id / raw-body patterns that must NEVER reach the UI or API.
const SECRET = /(sk-[A-Za-z0-9]{16,})|(v1:[A-Za-z0-9+/=_-]{6,})|Authorization|Bearer\s|hcti_api_key|"stack"|"raw"|access_token|refresh_token/i;

const b = await launch({ width: 1440, height: 1000, port: 9879 });

const cardState = (itemId) => `(() => {
  const card = document.querySelector('[data-item="${itemId}"]');
  if (!card) return null;
  return {
    text: card.textContent,
    hasRetryImage: [...card.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Retry image'),
    hasRetry: [...card.querySelectorAll('button')].some((x) => /^Retry/.test(x.textContent.trim())),
    status: card.querySelector('.status')?.textContent?.trim() || '',
    caption: card.querySelector('.planner-caption')?.textContent?.trim() || '',
  };
})()`;

const apiItem = (runId, itemId) => `fetch('/api/planner/plans/${encodeURIComponent(runId)}',{headers:{Accept:'application/json'}})
  .then(r=>r.json()).then(j=>{ const d=j.data||{}; const items=(d.items)||(d.plan&&d.plan.items)||[]; return items.find(x=>String(x.id)==='${itemId}')||null; })`;

try {
  await b.goto(`${BASE}/login`, { waitMs: 1000 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','${CREDS.email}'); s('password','${CREDS.password}'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1500);

  const runId = await b.evaluate(`fetch('/api/planner/plans',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>(j.data.plans||[])[0]?.id||null)`);
  ok(Boolean(runId), `${TAG} a seeded plan exists`);
  await b.goto(`${BASE}/planner/week?run=${encodeURIComponent(runId)}`, { waitMs: 1500 });
  const itemId = await b.evaluate(`(() => { const c=document.querySelector('[data-item]'); return c?c.getAttribute('data-item'):null; })()`);
  ok(Boolean(itemId), `${TAG} the board renders the plan`);

  const st = await b.evaluate(cardState(itemId));
  const item = await b.evaluate(apiItem(runId, itemId));
  ok(Boolean(item), `${TAG} the item is served by the board API`);

  if (KIND === 'image') {
    // --- correct card state: an explained image failure, never a bare "No image".
    ok(/Image failed/i.test(st.text), `${TAG} card shows "Image failed"`, st.text);
    ok(!/\bNo image\b/i.test(st.text), `${TAG} card does NOT show a bare "No image"`);
    ok(st.text.includes(EXPECT.providerUpper), `${TAG} card names the provider (${EXPECT.providerUpper})`, st.text);
    ok(st.text.includes(EXPECT.shortLabel), `${TAG} card shows the safe category label "${EXPECT.shortLabel}"`, st.text);
    ok(st.hasRetryImage, `${TAG} card offers Retry image`);
    ok(st.caption.length > 0, `${TAG} the caption is intact on the card`);

    // --- the API's safe error object matches the production model exactly.
    const err = item.image && item.image.error;
    ok(item.image && item.image.status === 'failed', `${TAG} API image.status === failed`, JSON.stringify(item.image));
    ok(err && err.category === CATEGORY, `${TAG} API error.category === ${CATEGORY}`, JSON.stringify(err));
    ok(err && err.shortLabel === EXPECT.shortLabel, `${TAG} API error.shortLabel === "${EXPECT.shortLabel}"`, JSON.stringify(err));
    ok(err && err.message === EXPECT.message, `${TAG} API error.message is the safe model message (recommended action included)`, JSON.stringify(err));
    ok(err && err.retryable === EXPECT.retryable, `${TAG} API error.retryable === ${EXPECT.retryable}`, JSON.stringify(err));
    if (STATUS != null) ok(err && Number(err.httpStatus) === STATUS, `${TAG} API error.httpStatus === ${STATUS}`, JSON.stringify(err));
    // no raw body / secret / internal-only keys in the safe error object.
    const errKeys = err ? Object.keys(err) : [];
    ok(!errKeys.some((k) => /^(id|itemId|userId|stack|raw|response|body)$/i.test(k)), `${TAG} error object exposes no DB id / raw body`, JSON.stringify(errKeys));
  } else {
    // --- OpenAI content generation failure: "Generation failed" + safe reason.
    ok(/Generation failed/i.test(st.status) || /Generation failed/i.test(st.text), `${TAG} card shows "Generation failed"`, st.text);
    ok(st.text.includes(EXPECT.message) || st.text.toLowerCase().includes('openai'), `${TAG} card shows the safe OpenAI reason`, st.text);
    ok(st.hasRetry, `${TAG} card offers Retry`);
    ok(['generation_failed'].includes(item.qualityStatus) || ['generation_failed'].includes(item.approvalStatus), `${TAG} API item is generation_failed`, JSON.stringify({ q: item.qualityStatus, a: item.approvalStatus }));
    const reasons = JSON.stringify(item.qualityFailures || []);
    ok(reasons.includes(EXPECT.message) || /openai/i.test(reasons), `${TAG} the safe reason carries the OpenAI message`, reasons);
  }

  // --- no secret / raw body anywhere in the served item JSON.
  ok(!SECRET.test(JSON.stringify(item)), `${TAG} the item JSON carries no secret, token or raw provider body`);

  // --- the failure survives a normal refresh.
  await b.goto(`${BASE}/planner/week?run=${encodeURIComponent(runId)}`, { waitMs: 1500 });
  const st2 = await b.evaluate(cardState(itemId));
  const stillFailed = KIND === 'image'
    ? /Image failed/i.test(st2.text) && st2.text.includes(EXPECT.shortLabel)
    : /Generation failed/i.test(st2.status) || /Generation failed/i.test(st2.text);
  ok(stillFailed, `${TAG} the failure survives a refresh`, st2.text);

  // --- Retry image invariance (image scenarios only): caption + copy + parity intact.
  if (KIND === 'image') {
    const before = await b.evaluate(apiItem(runId, itemId));
    // Click Retry image on the card.
    await b.evaluate(`(() => { const card=document.querySelector('[data-item="${itemId}"]'); const btn=[...card.querySelectorAll('button')].find(x=>x.textContent.trim()==='Retry image'); if (btn) btn.click(); })()`);
    await sleep(1800);
    const after = await b.evaluate(apiItem(runId, itemId));
    ok(after && after.caption === before.caption, `${TAG} Retry image leaves the caption byte-identical`);
    ok(JSON.stringify(after.hashtags || after.platformCopy?.instagram?.hashtags || null) === JSON.stringify(before.hashtags || before.platformCopy?.instagram?.hashtags || null), `${TAG} Retry image does not change the hashtags`);
    ok((after.headline ?? null) === (before.headline ?? null), `${TAG} Retry image does not change the headline`);
    ok((after.serviceEmphasis ?? after.assignment?.serviceEmphasis ?? null) === (before.serviceEmphasis ?? before.assignment?.serviceEmphasis ?? null), `${TAG} Retry image does not change the assigned service`);
    // Exact-Make parity is not flipped to a generic pillar by a provider failure.
    const dayTypeBefore = before.assignment?.dayType || before.fingerprint?.assignment?.dayType || null;
    const dayTypeAfter = after.assignment?.dayType || after.fingerprint?.assignment?.dayType || null;
    ok(dayTypeBefore == null || dayTypeAfter === dayTypeBefore, `${TAG} a provider failure does not flip Exact Make Parity to generic (day type preserved)`, `${dayTypeBefore} -> ${dayTypeAfter}`);
  }

  // --- Integrations page: masked fingerprint, no secret.
  await b.goto(`${BASE}/integrations`, { waitMs: 1000 });
  const integBody = await b.evaluate(`document.body.textContent`);
  ok(!SECRET.test(integBody), `${TAG} no secret appears on Integrations`);
} catch (e) {
  ok(false, `${TAG} smoke threw`, String(e && e.message));
} finally {
  await b.close();
}

console.log(`\nPROVIDER-ERROR E2E ${TAG}: ${pass} passed, ${fail} failed`);
if (fail) { console.log('failures:', failures.join('; ')); process.exitCode = 1; }
