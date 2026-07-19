/**
 * automationReleaseCandidate.e2e — the release acceptance journey, in a real
 * browser, against the real application and a real MariaDB.
 *
 * Every other browser suite in this project drives an app wired to in-memory
 * fakes. This one drives the real repositories, so what it proves about
 * persistence, ownership and idempotency is proved against actual SQL. Only the
 * external network boundaries are stubbed, and the provider stubs THROW if
 * called, so "zero provider calls" is evidence rather than an assumption.
 *
 * Start the server first (see tools/release-e2e-server.mjs), then:
 *   node tools/automation-release-candidate-e2e.mjs http://127.0.0.1:4980
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4980';

let pass = 0; let fail = 0; const failures = [];
const ok = (c, label) => {
  if (c) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(b, expr, { timeoutMs = 12000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { if (await b.evaluate(expr)) return true; } catch { /* navigating */ }
    if (Date.now() > deadline) return false;
    await sleep(150);
  }
}
const SETTLED = `Boolean(document.querySelector('h1')) && document.querySelectorAll('.skeleton').length === 0`;
const j = async (b, expr) => JSON.parse(await b.evaluate(expr));
const text = (b) => b.evaluate('document.body.innerText');

const state = async (b) => j(b, `fetch('/__e2e/state').then(r=>r.json()).then(s=>JSON.stringify(s))`);

const clickText = (sel, t) => `(() => {
  const n = [...document.querySelectorAll(${JSON.stringify(sel)})]
    .find((e) => (e.textContent || '').trim().toLowerCase().includes(${JSON.stringify(t.toLowerCase())}));
  if (!n) return false; n.scrollIntoView({block:'center'}); n.click(); return true;
})()`;

const EDITED = {
  headline: 'Check Basement Moisture Early',
  subheadline: 'Understand visible warning signs before damage grows.',
  altText: 'Basement wall being inspected for visible moisture and water stains',
  postCopy: 'Basement moisture can appear as damp walls, water stains, peeling paint, musty odors, or small wet areas near the floor. These signs do not always mean the same problem, so the affected area should be checked before a repair is recommended.\n\nA basement moisture inspection can help identify visible leaks, cracks, drainage concerns, and other possible water-entry points. NYC Waterproofing helps property owners understand the practical options available.',
  hashtags: '#BasementWaterproofing #BasementMoisture #NYCWaterproofing',
};

const b = await launch({ width: 1440, height: 900, port: 9940 });

try {
  const seeded = await (async () => {
    await b.goto(`${BASE}/login`, { waitMs: 800 });
    return state(b);
  })();
  console.log(`== run ${seeded.runId}, items ${seeded.july19} and ${seeded.july26} ==\n`);

  // ---------------------------------------------------------------- login
  console.log('== Login ==');
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));};
    s('email','release@example.test'); s('password','Release-Pass-123456'); document.querySelector('form').requestSubmit(); return true; })()`);
  await sleep(2000);
  ok(!/\/login/.test(await b.evaluate('location.pathname')), 'a real user logs in against MariaDB');

  // ------------------------------------------------- View upcoming / board
  console.log('== Weekly board ==');
  await b.goto(`${BASE}/planner/week?run=${seeded.runId}`, { waitMs: 500 });
  const loaded = await waitFor(b, SETTLED);
  ok(loaded, 'the board opens by direct URL, with no hard refresh');
  ok(!/could not be loaded/i.test(await text(b)), 'no page-load error');

  // A normal reload must work: this is the Ctrl+F5 case.
  await b.goto(`${BASE}/planner/week?run=${seeded.runId}`, { waitMs: 500 });
  await waitFor(b, SETTLED);
  ok(!/could not be loaded/i.test(await text(b)), 'a normal refresh works');

  const board = await text(b);
  ok(/Facebook · NYC Waterproofing/.test(board), 'the card shows "Facebook · NYC Waterproofing"');
  ok(/Jul 19 to Jul 26/.test(board), 'the header shows "Jul 19 to Jul 26"');
  for (const wrong of ['Jul 18 to Jul 25', 'null to null', 'undefined', 'Invalid Date']) {
    ok(!board.includes(wrong), `the header never shows "${wrong}"`);
  }

  // -------------------------------------------------------------- editing
  console.log('== Edit ==');
  const opened = await b.evaluate(clickText('.planner-card button', 'Edit'));
  ok(opened && await waitFor(b, `document.querySelector('.drawer:not([hidden])') !== null`), 'the edit drawer opens');
  ok(/Facebook · NYC Waterproofing/.test(await text(b)), 'the drawer shows "Facebook · NYC Waterproofing"');

  await b.evaluate(`(() => {
    const set = (id, v) => { const n = document.getElementById(id); if (!n) return false;
      n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); return true; };
    set('d-headline', ${JSON.stringify(EDITED.headline)});
    set('d-subheadline', ${JSON.stringify(EDITED.subheadline)});
    set('d-alt', ${JSON.stringify(EDITED.altText)});
    const copy = document.querySelector('.drawer textarea[id*="copy"], .drawer .pe-copy, .drawer textarea');
    if (copy) { copy.value = ${JSON.stringify(EDITED.postCopy)}; copy.dispatchEvent(new Event('input', { bubbles: true })); }
    const tags = [...document.querySelectorAll('.drawer input')].find((i) => /hashtag/i.test(i.id + i.name + (i.placeholder || '')));
    if (tags) { tags.value = ${JSON.stringify(EDITED.hashtags)}; tags.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  })()`);
  await b.evaluate(clickText('.drawer button', 'Save changes'));
  await sleep(2500);
  ok(/Saved\./.test(await text(b)) || !(await b.evaluate(`document.querySelector('.drawer:not([hidden])') !== null`)),
    'the save reports success only after the server confirms');

  // A normal reload, then read it back — the exact case that failed on staging.
  await b.goto(`${BASE}/planner/week?run=${seeded.runId}`, { waitMs: 500 });
  await waitFor(b, SETTLED);
  const afterReload = await text(b);
  ok(afterReload.includes(EDITED.headline), 'the edited headline survives a reload');
  ok(!/Austin SEO in 2026/.test(afterReload), 'the original SEO/Austin headline is gone');

  const persisted = await j(b, `fetch('/api/planner/plans/${seeded.runId}').then(r=>r.json())
    .then(p => { const i = p.data.items.find(x => String(x.id) === '${seeded.july26}');
      return JSON.stringify({ h: i.headline, s: i.subheadline, a: i.altText, c: i.platformCopy.facebook.postCopy }); })`);
  ok(persisted.h === EDITED.headline, 'headline persisted');
  ok(persisted.s === EDITED.subheadline, 'subheadline persisted');
  ok(persisted.a === EDITED.altText, 'alt text persisted');
  ok(persisted.c.includes('Basement moisture'), 'post copy persisted');
  ok(!/Austin|SEO/i.test(persisted.c), 'the SEO/Austin copy is gone from the database');

  const afterEdit = await state(b);
  ok(afterEdit.manualEditRevisions === 1, `exactly one manual_edit revision (${afterEdit.manualEditRevisions})`);

  // ------------------------------------------------------ reject / approve
  console.log('== Reject and approve ==');
  const act = async (itemId, status) => b.evaluate(`(async () => {
    const t = (await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json()).data.csrfToken;
    const r = await fetch('/api/planner/items/${itemId}/status', { method:'POST',
      headers:{'Content-Type':'application/json','X-CSRF-Token':t}, body: JSON.stringify({ status: '${status}' }) });
    return r.status;
  })()`);
  ok(Number(await act(seeded.july19, 'rejected')) === 200, 'the July 19 item is rejected');
  ok(Number(await act(seeded.july26, 'approved')) === 200, 'the July 26 item is approved');

  await b.goto(`${BASE}/planner/week?run=${seeded.runId}`, { waitMs: 500 });
  await waitFor(b, SETTLED);
  const statuses = await j(b, `fetch('/api/planner/plans/${seeded.runId}').then(r=>r.json())
    .then(p => JSON.stringify(Object.fromEntries(p.data.items.map(i => [String(i.id), i.approvalStatus]))))`);
  ok(statuses[seeded.july19] === 'rejected', 'the rejection persists after reload');
  ok(statuses[seeded.july26] === 'approved', 'the approval persists after reload');

  // ---------------------------------------------------------------- queue
  console.log('== Queue ==');
  const queue = async () => b.evaluate(`(async () => {
    const t = (await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json()).data.csrfToken;
    const r = await fetch('/api/planner/plans/${seeded.runId}/queue', { method:'POST',
      headers:{'Content-Type':'application/json','X-CSRF-Token':t}, body:'{}' });
    return r.status;
  })()`);
  ok(Number(await queue()) === 200, 'queue approved posts succeeds');

  let after = await state(b);
  ok(after.scheduledPosts === 1, `exactly one scheduled post in MariaDB (${after.scheduledPosts})`);
  ok(after.targets === 1, `exactly one account target in MariaDB (${after.targets})`);

  // Repeat through the same supported path: no duplicate.
  await queue();
  after = await state(b);
  ok(after.scheduledPosts === 1, `repeating the action creates no duplicate (${after.scheduledPosts})`);
  ok(after.targets === 1, `and no duplicate target (${after.targets})`);

  await b.goto(`${BASE}/queue`, { waitMs: 500 });
  await waitFor(b, SETTLED);
  const queuePage = await text(b);
  ok(/Facebook · NYC Waterproofing/.test(queuePage), 'the queue card shows "Facebook · NYC Waterproofing"');
  ok(queuePage.includes(EDITED.headline) || /Basement/i.test(queuePage), 'the queued post carries the edited content');
  ok(!/Austin SEO in 2026/.test(queuePage), 'the rejected SEO item is not in the queue');

  // ------------------------------------------------------ provider safety
  console.log('== Provider safety ==');
  const finalState = await state(b);
  ok(finalState.providerCalls.facebook === 0, `Facebook publish calls: ${finalState.providerCalls.facebook}`);
  ok(finalState.providerCalls.instagram === 0, `Instagram publish calls: ${finalState.providerCalls.instagram}`);
  ok(finalState.providerCalls.threads === 0, `Threads publish calls: ${finalState.providerCalls.threads}`);

  // ---------------------------------------------------------------- logout
  console.log('== Logout ==');
  await b.evaluate(`(async () => {
    const t = (await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json()).data.csrfToken;
    await fetch('/api/auth/logout', { method:'POST', headers:{'X-CSRF-Token':t} });
  })()`);
  await b.goto(`${BASE}/planner/week?run=${seeded.runId}`, { waitMs: 1200 });
  ok(/\/login/.test(await b.evaluate('location.pathname')), 'authenticated pages are closed after logout');

  // ------------------------------------------------------------- hygiene
  console.log('== Hygiene ==');
  const problems = b.problems();
  const errors = problems.console.filter((c) => c.startsWith('error'));
  ok(errors.length === 0, `no console errors (${errors.length})`);
  const limited = problems.network.filter((n) => n.startsWith('HTTP 429'));
  ok(limited.length === 0, `no assertion distorted by rate limiting (${limited.length})`);
} finally {
  await b.close();
}

console.log(`\nRELEASE CANDIDATE E2E: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
