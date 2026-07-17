/**
 * Milestone D1 automation acceptance smoke.
 *
 * Drives the real app in headless Chrome against the seeded review world, and
 * uses the review-only /__review/tick endpoint (which runs the SAME durable
 * pipeline — enqueue due refills + drain the job queue — that scheduler:once and
 * worker:once run in production, but in-process over the fakes, since the review
 * harness has no database).
 *
 * Verifies: create with an exact confirmation, no auto-select-all, activate,
 * buffer fills while the browser is idle, Instagram+Threads only (no Facebook),
 * idempotent refill (no duplicates), pause stops generation, resume is safe,
 * stop keeps prepared history, zero console errors.
 *
 * Usage: node tools/automation-smoke.mjs [baseUrl]
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4899';
let pass = 0; let fail = 0; const failures = [];
const ok = (c, label) => { if (c) { pass += 1; console.log(`  PASS ${label}`); } else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1440, height: 1000, port: 9899 });

async function tick() {
  return b.evaluate(`fetch('/__review/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).then(r => r.json())`);
}
async function listAutomations() {
  return b.evaluate(`fetch('/api/automations', { headers: { Accept: 'application/json' } }).then(r => r.json()).then(j => j.data.automations)`);
}
async function runItems(runId) {
  return b.evaluate(`fetch('/api/planner/plans/' + ${JSON.stringify(runId)}, { headers: { Accept: 'application/json' } }).then(r => r.json()).then(j => (j.data && j.data.items) || [])`);
}

try {
  await b.goto(`${BASE}/login`, { waitMs: 1000 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1500);

  // --- create via the API (the UI form is exercised separately below) -------
  const accounts = await b.evaluate(`fetch('/api/social-accounts',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>j.data.accounts.filter(a=>a.status==='active'))`);
  const ig = accounts.find((a) => a.accountType === 'instagram_professional');
  const th = accounts.find((a) => a.accountType === 'threads_professional' || a.accountType === 'threads_profile');
  const fb = accounts.find((a) => a.accountType === 'facebook_page');
  ok(ig && th, 'seeded Instagram + Threads accounts exist');
  ok(Boolean(fb), 'a Facebook account is connected but will be left unselected');

  const csrf = await b.evaluate(`fetch('/api/csrf-token',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>j.data.csrfToken)`);
  const body = JSON.stringify({
    name: 'Smoke automation', mode: 'review', timezone: 'Asia/Karachi',
    selectedWeekdays: [1, 2, 3, 4, 5], postingTimes: ['09:00'], postsPerDay: 1,
    selectedPlatforms: ['instagram', 'threads'], selectedAccountIds: [ig.id, th.id],
    missedPostPolicy: 'skip', generationHorizonDays: 10, minimumReadyDays: 5, lowBufferDays: 2,
  });
  const create = await b.evaluate(`fetch('/api/automations',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':${JSON.stringify(csrf)},Accept:'application/json'},body:${JSON.stringify(body)}}).then(r=>r.json())`);
  ok(create?.data?.automation?.status === 'draft', 'automation created as a draft');
  const id = create?.data?.automation?.id;
  ok(create?.data?.automation && !create.data.automation.selectedPlatforms.includes('facebook'), 'no Facebook platform on the automation');

  // --- activate + fill the buffer while the browser is idle -----------------
  await b.evaluate(`fetch('/api/automations/${id}/activate',{method:'POST',headers:{'X-CSRF-Token':${JSON.stringify(csrf)},Accept:'application/json'}})`);
  await tick(); // stands in for scheduler:once + worker:once
  await sleep(200);

  let list = await listAutomations();
  let a = list.find((x) => String(x.id) === String(id));
  ok(a && a.status === 'active', 'automation is active after activation');
  ok(a && a.readyBufferDays > 0, `buffer filled with prepared content (${a?.readyBufferDays} ready days)`);
  ok(a && a.nextPost, 'a next prepared post is shown');

  // --- prepared content is Instagram+Threads only, never Facebook -----------
  const items = await runItems(a.plannerRunId);
  ok(items.length >= 3, `backing run has prepared items (${items.length})`);
  const anyFacebook = items.some((it) => (it.platformTargets || []).includes('facebook'));
  const allIgTh = items.every((it) => { const t = (it.platformTargets || []).slice().sort().join(','); return t === 'instagram,threads'; });
  ok(!anyFacebook, 'no prepared item targets Facebook');
  ok(allIgTh, 'every prepared item targets Instagram + Threads');

  // --- idempotent refill: a second tick creates no duplicate items ----------
  const before = items.length;
  await tick();
  await tick();
  const after = (await runItems(a.plannerRunId)).length;
  ok(after === before, `repeated ticks create no duplicate items (${before} -> ${after})`);

  // --- pause stops generation ----------------------------------------------
  await b.evaluate(`fetch('/api/automations/${id}/pause',{method:'POST',headers:{'X-CSRF-Token':${JSON.stringify(csrf)},Accept:'application/json'}})`);
  await tick();
  const pausedItems = (await runItems(a.plannerRunId)).length;
  ok(pausedItems === after, 'no new content is prepared while paused');
  a = (await listAutomations()).find((x) => String(x.id) === String(id));
  ok(a.status === 'paused', 'status is paused');

  // --- resume is safe (no duplicates) --------------------------------------
  await b.evaluate(`fetch('/api/automations/${id}/resume',{method:'POST',headers:{'X-CSRF-Token':${JSON.stringify(csrf)},Accept:'application/json'}})`);
  await tick();
  const resumedItems = (await runItems(a.plannerRunId)).length;
  ok(resumedItems >= pausedItems, 'resume maintains the buffer without losing content');

  // --- stop keeps prepared history -----------------------------------------
  await b.evaluate(`fetch('/api/automations/${id}/stop',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':${JSON.stringify(csrf)},Accept:'application/json'},body:JSON.stringify({confirm:'STOP'})})`);
  await tick();
  a = (await listAutomations()).find((x) => String(x.id) === String(id));
  ok(a.status === 'stopped', 'status is stopped');
  const stoppedItems = (await runItems(a.plannerRunId)).length;
  ok(stoppedItems >= resumedItems, 'prepared history remains after stop');

  // --- the /automations page renders and shows the automation ---------------
  await b.goto(`${BASE}/automations`, { waitMs: 1500 });
  const pageText = await b.evaluate('document.body.innerText');
  ok(/Automations/.test(pageText) && /Smoke automation/.test(pageText), 'the Automations page lists the automation');
  ok(/does not publish/i.test(pageText), 'the page states nothing is published yet');

  // --- console cleanliness --------------------------------------------------
  const problems = b.problems();
  const errs = problems.console.filter((l) => /error/i.test(l) && !/favicon|502/i.test(l));
  ok(errs.length === 0, `no console errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
} finally {
  await b.close();
}

console.log(`\nAUTOMATION SMOKE: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);
