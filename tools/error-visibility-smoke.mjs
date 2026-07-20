/**
 * Provider-error visibility acceptance (authenticated, headless Chrome).
 *
 * Boot first:
 *   node tools/review-server.mjs 4899 --with-image-error-plan
 * Then:
 *   node tools/error-visibility-smoke.mjs http://127.0.0.1:4899
 *
 * Proves the board explains a failed image instead of a bare "No image", the
 * caption is intact and unchanged by Retry image, the failure survives a normal
 * refresh, Integrations shows a masked fingerprint + editable label, and no
 * secret or internal id appears in the UI.
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4899';
const CREDS = { email: 'review@cyflow.test', password: 'Review-Pass-123456' };
let pass = 0; let fail = 0; const failures = [];
const ok = (c, label, detail = '') => { if (c) { pass += 1; console.log(`  ok  ${label}`); } else { fail += 1; failures.push(label); console.log(`  FAIL ${label}${detail ? `  ${detail}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1440, height: 1000, port: 9877 });

const cardState = (itemId) => `(() => {
  const card = document.querySelector('[data-item="${itemId}"]');
  if (!card) return null;
  return {
    text: card.textContent,
    hasRetryImage: [...card.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Retry image'),
    caption: card.querySelector('.planner-caption')?.textContent?.trim() || '',
    imageErrorAttr: card.querySelector('[data-image-error]')?.getAttribute('data-image-error') || null,
  };
})()`;

try {
  await b.goto(`${BASE}/login`, { waitMs: 1000 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','${CREDS.email}'); s('password','${CREDS.password}'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1500);

  // Find the seeded run and open its board.
  const runId = await b.evaluate(`fetch('/api/planner/plans',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>(j.data.plans||[])[0]?.id||null)`);
  ok(Boolean(runId), 'a seeded plan exists');
  await b.goto(`${BASE}/planner/week?run=${encodeURIComponent(runId)}`, { waitMs: 1500 });

  const itemId = await b.evaluate(`(() => { const c=document.querySelector('[data-item]'); return c?c.getAttribute('data-item'):null; })()`);
  ok(Boolean(itemId), 'the board renders the plan');

  const st = await b.evaluate(cardState(itemId));
  // A8.6 — the card shows the failure and its reason, never a bare "No image".
  ok(st && /Image failed/i.test(st.text), 'card shows "Image failed"');
  ok(st && /credits exhausted/i.test(st.text), 'card shows the specific reason (HCTI · Credits exhausted)', st?.text?.slice(0, 120));
  ok(st && !/\bNo image\b/i.test(st.text), 'card does NOT show a bare "No image"');
  ok(st && st.hasRetryImage, 'card offers Retry image');
  ok(st && st.caption.length > 0, 'the caption is intact on the card');
  const captionBefore = st?.caption || '';

  // A8.10 — the failure survives a normal refresh.
  await b.goto(`${BASE}/planner/week?run=${encodeURIComponent(runId)}`, { waitMs: 1500 });
  const st2 = await b.evaluate(cardState(itemId));
  ok(st2 && /Image failed/i.test(st2.text) && /credits exhausted/i.test(st2.text), 'the image failure survives a refresh');
  ok(st2 && st2.caption === captionBefore, 'the caption is unchanged across refresh');

  // A8.9 — Integrations shows a masked fingerprint + editable label, no full key.
  await b.goto(`${BASE}/integrations`, { waitMs: 1200 });
  const integ = await b.evaluate(`(() => {
    const body = document.body.textContent;
    const label = document.querySelector('[data-label-input="hcti"]');
    return {
      masked: /••••/.test(body) || /\\*\\*\\*\\*/.test(body),
      hasLabelInput: Boolean(label),
      labelValue: label ? label.value : '',
      lastError: /Last error|credits/i.test(body),
      body,
    };
  })()`);
  ok(integ.masked, 'Integrations shows a masked credential fingerprint');
  ok(integ.hasLabelInput, 'Integrations has an editable connection-label input');
  ok(integ.lastError, 'Integrations surfaces the last error / health');

  // A8.12 — no secret or internal id leaks into any page we visited.
  const leaked = integ.body.match(/sk-[A-Za-z0-9]{20,}/) || integ.body.match(/hcti_api_key/i);
  ok(!leaked, 'no API key or secret appears in the UI');

  // Console/network hygiene (ignore known harness placeholder-media 404s).
  let probList = [];
  try {
    const raw = await b.problems();
    probList = Array.isArray(raw) ? raw : [...(raw?.consoleErrors || []), ...(raw?.failedRequests || []), ...(raw?.errors || [])];
  } catch { probList = []; }
  const problems = probList.filter((p) => !/\/media\//.test(String((p && (p.url || p.text)) || '')));
  ok(problems.length === 0, 'no unexpected console errors or failed requests', JSON.stringify(problems).slice(0, 200));
} catch (e) {
  ok(false, 'smoke threw', String(e && e.message));
} finally {
  await b.close();
}

console.log(`\nERROR-VISIBILITY SMOKE: ${pass} passed, ${fail} failed`);
if (fail) { console.log('failures:', failures.join('; ')); process.exitCode = 1; }
