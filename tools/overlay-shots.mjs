/**
 * Overlay screenshot pass — captures the states that route-level shots miss.
 *
 * tools/app-shots.mjs photographs routes at rest. The states a user actually
 * makes decisions in are overlays: the confirmation before something is
 * deleted, the drawer they edit in, the picker stacked over that drawer, the
 * toast that tells them what happened. Milestone F2 shipped without ever
 * looking at those, and this closes that gap.
 *
 * Everything is captured at a TRUE viewport. 200% zoom is emulated by halving
 * the CSS viewport, which is what the layout actually responds to.
 *
 * Usage: node tools/overlay-shots.mjs <baseUrl> <outDir>
 * Expects a FRESH review server started with:
 *   --with-editor-plan --live-publishing --placeholder-media
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4941';
const OUT = process.argv[3] || '.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(br, expr, { timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { if (await br.evaluate(expr)) return true; } catch { /* navigating */ }
    if (Date.now() > deadline) return false;
    await sleep(150);
  }
}
const SETTLED = `Boolean(document.querySelector('h1')) && document.querySelectorAll('.skeleton').length === 0`;
const clickText = (sel, text) => `(() => {
  const n = [...document.querySelectorAll(${JSON.stringify(sel)})]
    .find((e) => (e.textContent || '').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!n) return false;
  n.focus(); n.click(); return true;
})()`;

const shots = [];
async function shot(br, name, tag) {
  const file = `${OUT}/ovl-${name}-${tag}.png`;
  await br.screenshot(file);
  shots.push(`${name} @ ${tag}`);
  console.log(` shot ${name.padEnd(26)} ${tag}`);
}

const b = await launch({ width: 1440, height: 900, port: 9915 });
try {
  await b.goto(`${BASE}/login`, { waitMs: 900 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1600);

  const post = (p, body) => b.evaluate(`fetch(${JSON.stringify(p)},{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(body || {}))}}).then(r=>r.json()).catch(e=>({err:String(e)}))`);
  await post('/__review/publish-script', { script: {} });
  await post('/__review/seed-publish', { title: 'Autumn service reminder' });
  await post('/__review/tick', {});
  await post('/__review/seed-publish', { title: 'New team announcement', threadsFail: true });
  await post('/__review/tick', {});
  await b.evaluate(`(async () => {
    const r = await fetch('/api/csrf-token',{headers:{Accept:'application/json'}});
    const csrf = (await r.json())?.data?.csrfToken;
    if (csrf) await fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({title:'Draft: overlay fixture'})});
  })()`);
  await sleep(600);

  // --- destructive confirmation, desktop and every mobile width -------------
  for (const [w, h, tag] of [[1440, 900, '1440x900'], [430, 932, '430x932'], [390, 844, '390x844'], [360, 800, '360x800']]) {
    await b.setViewport(w, h);
    await b.goto(`${BASE}/queue`, { waitMs: 350 });
    await waitFor(b, `document.querySelectorAll('.status').length > 0`);
    await b.evaluate(clickText('button', 'Delete'));
    await waitFor(b, `document.querySelector('#modal-host [role="dialog"]') !== null`);
    await shot(b, 'confirm-delete', tag);
    await b.press('Escape');
    await sleep(200);
  }

  // --- toast, desktop and mobile -------------------------------------------
  for (const [w, h, tag] of [[1440, 900, '1440x900'], [360, 800, '360x800']]) {
    await b.setViewport(w, h);
    await b.goto(`${BASE}/queue`, { waitMs: 350 });
    await waitFor(b, `document.querySelectorAll('.status').length > 0`);
    await b.evaluate(`(() => { window.__ui?.toast?.('Draft saved.', 'ok'); return true; })()`);
    // The app module is not on window, so raise a toast the way the app does:
    // through a real action that always produces one.
    await b.evaluate(clickText('button', 'Cancel post'));
    const dlg = await waitFor(b, `document.querySelector('#modal-host [role="dialog"]') !== null`, { timeoutMs: 3000 });
    if (dlg) {
      await b.evaluate(`(() => { const d=document.querySelector('#modal-host [role="dialog"]');
        [...d.querySelectorAll('button')].find(x=>/cancel post|confirm/i.test(x.textContent))?.click(); return true; })()`);
      await sleep(900);
    }
    await shot(b, 'toast-after-action', tag);
  }

  // --- toast raised WHILE a dialog is open (the stacking fix) ---------------
  await b.setViewport(1440, 900);
  await b.goto(`${BASE}/queue`, { waitMs: 350 });
  await waitFor(b, `document.querySelectorAll('.status').length > 0`);
  await b.evaluate(clickText('button', 'Delete'));
  await waitFor(b, `document.querySelector('#modal-host [role="dialog"]') !== null`);
  await b.evaluate(`(() => {
    const host = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast toast-ok';
    t.textContent = 'A result raised while a dialog is open.';
    host.appendChild(t);
    return true;
  })()`);
  await sleep(200);
  await shot(b, 'toast-over-modal', '1440x900');
  await b.press('Escape');
  await sleep(200);

  // --- weekly board drawer, and the media picker stacked over it ------------
  for (const [w, h, tag] of [[1440, 900, '1440x900'], [390, 844, '390x844']]) {
    await b.setViewport(w, h);
    await b.goto(`${BASE}/planner/week`, { waitMs: 350 });
    await waitFor(b, `document.querySelectorAll('.planner-card').length > 0`);
    await b.evaluate(clickText('.planner-card button', 'Edit'));
    await waitFor(b, `document.querySelector('.drawer:not([hidden])') !== null`);
    await shot(b, 'drawer-edit', tag);

    if (await b.evaluate(clickText('.drawer button', 'image'))) {
      await sleep(700);
      if (await b.evaluate(`document.querySelector('#modal-host [role="dialog"]') !== null`)) {
        await shot(b, 'drawer-plus-media-picker', tag);
        await b.press('Escape');
        await sleep(300);
      }
    }
    await b.press('Escape');
    await sleep(300);
  }

  // --- empty / attention / publishing-disabled -----------------------------
  await b.setViewport(1440, 900);
  await b.goto(`${BASE}/calendar`, { waitMs: 350 });
  await waitFor(b, SETTLED);
  await shot(b, 'empty-state-calendar', '1440x900');

  await b.goto(`${BASE}/dashboard`, { waitMs: 350 });
  await waitFor(b, SETTLED);
  await shot(b, 'attention-state-dashboard', '1440x900');

  await b.goto(`${BASE}/settings`, { waitMs: 350 });
  await waitFor(b, SETTLED);
  await shot(b, 'settings-privacy', '1440x900');

  // --- 200% zoom (a 1440x900 window at 200% is a 720x450 CSS viewport) ------
  for (const route of ['/dashboard', '/create', '/queue', '/calendar', '/settings']) {
    await b.setViewport(720, 450);
    await b.goto(`${BASE}${route}`, { waitMs: 350 });
    await waitFor(b, SETTLED);
    await shot(b, `zoom200${route.replace(/\//g, '-')}`, '720x450');
  }

  // A confirmation at 200% zoom: the state most likely to be clipped.
  await b.goto(`${BASE}/queue`, { waitMs: 350 });
  await waitFor(b, `document.querySelectorAll('.status').length > 0`);
  await b.evaluate(clickText('button', 'Delete'));
  await waitFor(b, `document.querySelector('#modal-host [role="dialog"]') !== null`);
  await shot(b, 'zoom200-confirm-delete', '720x450');
  await b.press('Escape');

  const problems = b.problems();
  const errors = problems.console.filter((c) => c.startsWith('error'));
  const limits = problems.network.filter((n) => n.startsWith('HTTP 429'));
  console.log(`\n${shots.length} screenshots written to ${OUT}`);
  console.log(errors.length ? `CONSOLE ERRORS: ${errors.length}` : 'console clean');
  if (limits.length) console.log(`RATE LIMITED: ${limits.length} x 429 — results may be unrepresentative`);
} finally {
  await b.close();
}
