/**
 * Milestone G acceptance smoke — data export + account deletion.
 *
 * Drives the real app against a review server (fake data, no real provider).
 * Verifies: the Settings privacy + danger-zone cards render; an export is
 * prepared by the durable worker, downloads, and contains no secrets; the
 * deletion gate rejects a wrong password / confirmation; and a confirmed
 * deletion removes the account so a later authed request fails.
 *
 * This DELETES the review user, so it must run against a fresh server.
 * Usage: node tools/account-smoke.mjs [baseUrl]
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4903';
let pass = 0; let fail = 0; const failures = [];
const ok = (c, label) => { if (c) { pass += 1; console.log(`  PASS ${label}`); } else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1280, height: 1000, port: 9906 });
const tick = () => b.evaluate(`fetch('/__review/tick',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json())`);
const csrf = () => b.evaluate(`fetch('/api/csrf-token',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>j.data.csrfToken)`);

try {
  await b.goto(`${BASE}/login`, { waitMs: 800 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1500);

  // --- settings renders the privacy + danger-zone cards --------------------
  await b.goto(`${BASE}/settings`, { waitMs: 1200 });
  const cards = await b.evaluate(`(() => ({
    privacy: /Privacy & your data/.test(document.body.innerText),
    danger: /Danger zone/.test(document.body.innerText),
    exportBtn: !!document.body.innerText.match(/Prepare a copy of my data/),
    deleteBtn: !!document.body.innerText.match(/Delete account/),
  }))()`);
  ok(cards.privacy && cards.danger, 'settings shows the Privacy and Danger-zone cards');
  ok(cards.exportBtn && cards.deleteBtn, 'export and delete actions are present');

  // --- request an export, run the worker, download, scan for secrets -------
  const token = await csrf();
  const post = (path, body) => b.evaluate(`fetch(${JSON.stringify(path)},{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':${JSON.stringify(token)},Accept:'application/json'},body:${JSON.stringify(JSON.stringify(body || {}))}}).then(r=>({status:r.status})).catch(()=>({status:0}))`);
  const reqExport = await post('/api/account/export', {});
  ok(reqExport.status === 202 || reqExport.status === 200, 'export request accepted');
  await tick(); // durable export job builds the archive
  await sleep(300);
  const status = await b.evaluate(`fetch('/api/account/export',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>j.data.export?.status)`);
  ok(status === 'ready', `the worker prepared the export (${status})`);

  const archive = await b.evaluate(`fetch('/api/account/export/download',{headers:{Accept:'application/json'}}).then(r=>r.text())`);
  let parsed = null; try { parsed = JSON.parse(archive); } catch (e) { /* keep null */ }
  ok(parsed && parsed.account && parsed.manifest, 'the downloaded archive is valid and has the account section');
  // Scan the DATA (exclude the README prose that names excluded secrets).
  const dataText = parsed ? JSON.stringify({ ...parsed, README: undefined }) : archive;
  ok(!/password_hash|access_token|refresh_token|encrypted|storage_key|storageKey|provider_response/.test(dataText), 'the archive data contains no secrets');

  // --- deletion gate rejects a wrong password / confirmation ---------------
  const badPw = await post('/api/account/delete', { currentPassword: 'wrong-password', confirmText: 'DELETE' });
  ok(badPw.status === 401 || badPw.status === 400, 'deletion is refused with a wrong password');
  const badConfirm = await post('/api/account/delete', { currentPassword: 'Review-Pass-123456', confirmText: 'nope' });
  ok(badConfirm.status === 400, 'deletion is refused without the typed confirmation');

  // --- a confirmed deletion removes the account ----------------------------
  const del = await post('/api/account/delete', { currentPassword: 'Review-Pass-123456', confirmText: 'DELETE' });
  ok(del.status === 202 || del.status === 200, 'a confirmed deletion is accepted');
  await tick(); // durable deletion job removes the user
  await sleep(300);
  // A previously-authed request now fails: the user row is gone (requireAuth 401s).
  const meStatus = await b.evaluate(`fetch('/api/auth/me',{headers:{Accept:'application/json'}}).then(r=>r.status).catch(()=>0)`);
  ok(meStatus === 401, `the deleted account can no longer authenticate (me → ${meStatus})`);

  const problems = b.problems();
  // 400/401 are deliberately exercised above (rejected gate + post-deletion auth).
  const errs = problems.console.filter((l) => /error/i.test(l) && !/favicon|502|401|400/i.test(l));
  ok(errs.length === 0, `no unexpected console errors${errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''}`);
} finally {
  await b.close();
}

console.log(`\nACCOUNT SMOKE: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);
