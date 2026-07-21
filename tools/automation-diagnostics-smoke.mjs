/**
 * Automation diagnostics banner acceptance (authenticated, headless Chrome).
 *
 * Boot:  node tools/review-server.mjs 4899
 * Run:   node tools/automation-diagnostics-smoke.mjs http://127.0.0.1:4899
 *
 * Seeds three automations whose slot mix forces each diagnostics reason, then
 * asserts the /automations banner distinguishes them, surfaces skipped (past /
 * duplicate) counts, leaks NO internal id, and survives a refresh:
 *   - preparing  (worker still draining): "Only 2 of 7 ... worker is catching up"
 *   - failures   (failed jobs):           "Only 5 of 7 ... 2 failed ... Retry"
 *   - shortfall  (+ skipped dates):       "Only 2 of 7 ... 2 skipped (past or duplicate dates)"
 */
import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4899';
const CREDS = { email: 'review@cyflow.test', password: 'Review-Pass-123456' };
let pass = 0; let fail = 0; const failures = [];
const ok = (c, label, detail = '') => {
  if (c) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; failures.push(label); console.log(`  FAIL ${label}${detail ? `  ${String(detail).slice(0, 200)}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1440, height: 1000, port: 9881 });

// The text of the automation card whose heading contains `name`.
const cardText = (name) => `(() => {
  const cards = [...document.querySelectorAll('.card')];
  const card = cards.find((c) => c.textContent.includes(${JSON.stringify(name)}));
  return card ? card.textContent : null;
})()`;

const seed = (body) => `fetch('/__review/seed-automation-diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(r=>r.json())`;

try {
  await b.goto(`${BASE}/login`, { waitMs: 1000 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','${CREDS.email}'); s('password','${CREDS.password}'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1500);

  // Seed the three diagnostics states.
  const r1 = await b.evaluate(seed({ name: 'ZZ Preparing Buffer', ready: 2, planned: 5 }));
  const r2 = await b.evaluate(seed({ name: 'ZZ Failed Buffer', ready: 5, failed: 2 }));
  const r3 = await b.evaluate(seed({ name: 'ZZ Shortfall Buffer', ready: 2, skipped: 2 }));
  ok(r1?.ok && r2?.ok && r3?.ok, 'seeded three diagnostics automations', JSON.stringify([r1, r2, r3]));

  await b.goto(`${BASE}/automations`, { waitMs: 1500 });

  // --- preparing: worker still draining.
  const prep = await b.evaluate(cardText('ZZ Preparing Buffer'));
  ok(prep && /Only 2 of 7 expected posts are prepared/.test(prep), 'preparing banner: "Only 2 of 7 expected posts are prepared"', prep);
  ok(prep && /still preparing/.test(prep) && /worker is catching up/i.test(prep), 'preparing banner explains worker lag', prep);

  // --- failures: failed jobs, actionable.
  const fails = await b.evaluate(cardText('ZZ Failed Buffer'));
  ok(fails && /Only 5 of 7 expected posts are prepared/.test(fails), 'failures banner: "Only 5 of 7 expected posts are prepared"', fails);
  ok(fails && /2 failed/.test(fails) && /Retry/i.test(fails), 'failures banner names the failed count + Retry', fails);

  // --- shortfall + skipped (past/duplicate) dates.
  const short = await b.evaluate(cardText('ZZ Shortfall Buffer'));
  ok(short && /Only 2 of 7 expected posts are prepared/.test(short), 'shortfall banner: "Only 2 of 7 expected posts are prepared"', short);
  ok(short && /Fewer slots than the horizon expected/.test(short), 'shortfall banner explains the horizon gap', short);
  ok(short && /2 skipped \(past or duplicate dates\)/.test(short), 'shortfall banner surfaces the skipped (past/duplicate) count', short);

  // --- no internal ids anywhere in the seeded banners.
  const allText = await b.evaluate(`document.querySelector('main, #app, body').textContent`);
  ok(!/99000|diag:|automation:\d|run[_ ]?id|plannerRunId|slot[_ ]?id/i.test(allText), 'no internal id (run/slot/automation) leaks into the UI');

  // --- survives a refresh.
  await b.goto(`${BASE}/automations`, { waitMs: 1500 });
  const prep2 = await b.evaluate(cardText('ZZ Preparing Buffer'));
  const short2 = await b.evaluate(cardText('ZZ Shortfall Buffer'));
  ok(prep2 && /Only 2 of 7 expected posts are prepared/.test(prep2), 'preparing banner survives a refresh', prep2);
  ok(short2 && /2 skipped/.test(short2), 'shortfall + skipped survives a refresh', short2);
} catch (e) {
  ok(false, 'smoke threw', String(e && e.message));
} finally {
  await b.close();
}

console.log(`\nAUTOMATION-DIAGNOSTICS SMOKE: ${pass} passed, ${fail} failed`);
if (fail) { console.log('failures:', failures.join('; ')); process.exitCode = 1; }
