/**
 * C3 browser smoke: the Media Library, upload security, and reuse, driven
 * through the REAL app in headless Chrome. Produces screenshots for a human look
 * and asserts the security-critical behaviours end to end:
 *   - a valid PNG/JPEG/WebP uploads and renders from its token URL;
 *   - a fake MIME, a bad signature and a GIF are refused with safe reasons;
 *   - the token content route serves bytes with nosniff + a real image type;
 *   - path traversal on the token route cannot read an arbitrary file;
 *   - no storage key or filesystem path is ever present in an API response;
 *   - the picker reuses an owned asset on the Weekly Board.
 *
 * Usage: node tools/media-smoke.mjs [port] [outDir]
 */

import { launch } from './cdp.mjs';
import { pngBytes, jpegBytes, webpBytes, gifBytes } from '../tests/helpers/imageBytes.js';

const PORT = Number(process.argv[2] || 4880);
const OUT = process.argv[3] || '.';
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0; let fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log(`  PASS ${label}`); } else { fail += 1; console.log(`  FAIL ${label}`); } };

const b = await launch({ width: 1440, height: 1000, port: 9880 });

/** Upload bytes via fetch inside the page; returns { status, body }. */
async function uploadInPage(browser, bytesB64, filename, contentType) {
  return browser.evaluate(`(async () => {
    const csrf = (await (await fetch('/api/csrf-token', { headers: { Accept: 'application/json' } })).json()).data.csrfToken;
    const bin = atob(${JSON.stringify(bytesB64)});
    const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append('image', new File([arr], ${JSON.stringify(filename)}, { type: ${JSON.stringify(contentType)} }));
    const r = await fetch('/api/media', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrf, Accept: 'application/json' } });
    let body = null; try { body = await r.json(); } catch {}
    return JSON.stringify({ status: r.status, body });
  })()`).then(JSON.parse);
}

try {
  // --- sign in -------------------------------------------------------------
  await b.goto(`${BASE}/login`, { waitMs: 1200 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await new Promise((r) => setTimeout(r, 1500));

  // --- empty state ---------------------------------------------------------
  await b.goto(`${BASE}/media`, { waitMs: 1500 });
  const emptyText = await b.evaluate('document.body.innerText');
  ok(/media/i.test(emptyText), 'media page renders');
  await b.screenshot(`${OUT}/media-1-empty.png`);

  // --- valid uploads (three formats) --------------------------------------
  const u1 = await uploadInPage(b, pngBytes(1080, 1080).toString('base64'), 'square.png', 'image/png');
  ok(u1.status === 201 && u1.body?.data?.media?.width === 1080, `PNG 1080x1080 uploads (status ${u1.status})`);
  const u2 = await uploadInPage(b, jpegBytes(800, 600).toString('base64'), 'photo.jpg', 'image/jpeg');
  ok(u2.status === 201 && u2.body?.data?.media?.mimeType === 'image/jpeg', `JPEG uploads (status ${u2.status})`);
  const u3 = await uploadInPage(b, webpBytes(600, 400).toString('base64'), 'art.webp', 'image/webp');
  ok(u3.status === 201 && u3.body?.data?.media?.mimeType === 'image/webp', `WebP uploads (status ${u3.status})`);

  // No storage key or filesystem path leaks in any of the responses.
  const leak = JSON.stringify([u1, u2, u3]);
  ok(!/storage_key|storageKey/.test(leak), 'no storage key in upload responses');
  ok(!/[A-Za-z]:\\\\|\/tmp\/|cyflow-media/.test(leak), 'no filesystem path in upload responses');

  // --- render the grid -----------------------------------------------------
  await b.goto(`${BASE}/media`, { waitMs: 1600 });
  const grid = await b.evaluate(`(() => {
    const tiles = [...document.querySelectorAll('.media-card, .media-tile, [data-media]')];
    const badges = [...document.querySelectorAll('.badge, .media-source, .pill')].map(n => n.textContent.trim());
    const imgs = [...document.querySelectorAll('img')].filter(i => /\\/media\\//.test(i.getAttribute('src')||''));
    return JSON.stringify({ tiles: tiles.length, uploadedBadge: badges.some(t => /upload/i.test(t)), imgs: imgs.length });
  })()`).then(JSON.parse);
  ok(grid.tiles >= 3, `grid shows the uploaded assets (${grid.tiles})`);
  ok(grid.imgs >= 3, `token-URL thumbnails render (${grid.imgs})`);
  await b.screenshot(`${OUT}/media-2-grid.png`);

  // list JSON never carries a storage key
  const listJson = await b.evaluate(`fetch('/api/media',{headers:{Accept:'application/json'}}).then(r=>r.text())`);
  ok(!/storage_key|storageKey/.test(listJson), 'no storage key in list JSON');

  // --- upload security refusals -------------------------------------------
  const fakeMime = await uploadInPage(b, pngBytes(64, 64).toString('base64'), 'x.jpg', 'image/jpeg');
  ok(fakeMime.status === 400 && /does not match/i.test(JSON.stringify(fakeMime.body)), 'fake MIME (png-as-jpeg) refused');
  const badSig = await uploadInPage(b, Buffer.from('this is definitely not an image at all').toString('base64'), 'x.png', 'image/png');
  ok(badSig.status === 400, 'bad signature refused');
  const gif = await uploadInPage(b, gifBytes().toString('base64'), 'x.gif', 'image/gif');
  ok(gif.status === 400 && /GIF/i.test(JSON.stringify(gif.body)), 'GIF refused with a named reason');

  // --- token content route: headers + traversal ---------------------------
  const token = u1.body.data.media.publicToken;
  const served = await b.evaluate(`(async () => {
    const r = await fetch('/media/' + ${JSON.stringify(token)});
    return JSON.stringify({ status: r.status, ct: r.headers.get('content-type'), nosniff: r.headers.get('x-content-type-options'), cd: r.headers.get('content-disposition'), len: r.headers.get('content-length') });
  })()`).then(JSON.parse);
  ok(served.status === 200 && /image\/png/.test(served.ct), 'token route serves image/png');
  ok(served.nosniff === 'nosniff', 'token route sets X-Content-Type-Options: nosniff');
  ok(/inline/.test(served.cd || ''), 'token route serves inline (not as a download)');

  for (const evil of ['/media/..%2f..%2f..%2fetc%2fpasswd', '/media/....//....//etc/passwd', '/media/' + encodeURIComponent('../../../../etc/passwd')]) {
    const r = await b.evaluate(`(async () => { const res = await fetch(${JSON.stringify(evil)}); const t = await res.text(); return JSON.stringify({ status: res.status, hasRoot: /root:.*:0:0:/.test(t) }); })()`).then(JSON.parse);
    ok(r.status >= 400 && !r.hasRoot, `traversal refused: ${evil}`);
  }

  // --- reuse on the Weekly Board ------------------------------------------
  await b.goto(`${BASE}/planner/week`, { waitMs: 2000 });
  const itemId = await b.evaluate(`(() => { const c=document.querySelector('[data-item]'); return c?c.getAttribute('data-item'):null; })()`);
  if (itemId) {
    await b.evaluate(`(() => { const c=document.querySelector('[data-item="${itemId}"]'); [...c.querySelectorAll('button')].find(x=>x.textContent.trim()==='Edit')?.click(); })()`);
    await new Promise((r) => setTimeout(r, 700));
    const opened = await b.evaluate(`(() => { const btn=[...document.querySelectorAll('.drawer button')].find(x=>/Choose image|Replace image/.test(x.textContent)); if(btn){btn.click(); return true;} return false; })()`);
    ok(opened, 'Weekly Board drawer exposes a Choose/Replace image control');
    const picker = await b.evaluate(`(() => new Promise(res=>{const t=Date.now();const iv=setInterval(()=>{const m=document.querySelector('.media-picker');if(m||Date.now()-t>4000){clearInterval(iv);res(!!m);}},100);}))()`);
    ok(picker, 'media picker opens');
    // Actually VISIBLE, not merely present: the shared modal host defaults to
    // [hidden] (display:none !important), so a picker appended without clearing
    // it would be in the DOM yet invisible. Assert real visibility.
    const visible = await b.evaluate(`(() => {
      const m = document.querySelector('.media-picker'); if (!m) return false;
      const host = document.getElementById('modal-host');
      const cs = getComputedStyle(host);
      return !host.hidden && cs.display !== 'none' && m.getClientRects().length > 0;
    })()`);
    ok(visible, 'media picker is actually visible to the user (host not [hidden])');
    await b.screenshot(`${OUT}/media-3-picker.png`);
    const before = await b.evaluate(`fetch('/api/planner/plans',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(p=>p.data.plans[0].id).then(rid=>fetch('/api/planner/plans/'+rid,{headers:{Accept:'application/json'}})).then(r=>r.json()).then(pl=>{const i=pl.data.items.find(x=>String(x.id)==='${itemId}');return i.media?.publicToken||''})`);
    await b.evaluate(`(() => { document.querySelector('.media-picker-tile')?.click(); })()`);
    await new Promise((r) => setTimeout(r, 1400));
    const after = await b.evaluate(`fetch('/api/planner/plans',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(p=>p.data.plans[0].id).then(rid=>fetch('/api/planner/plans/'+rid,{headers:{Accept:'application/json'}})).then(r=>r.json()).then(pl=>{const i=pl.data.items.find(x=>String(x.id)==='${itemId}');return i.media?.publicToken||''})`);
    ok(after && after !== before, 'selecting from the library attaches the uploaded image to the item');
  } else {
    console.log('  (no seeded plan item; run with --with-editor-plan for the reuse check)');
  }

  // --- mobile --------------------------------------------------------------
  await b.setViewport(390, 844);
  await b.goto(`${BASE}/media`, { waitMs: 1500 });
  await b.screenshot(`${OUT}/media-4-mobile.png`);
  const overflow = await b.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2');
  ok(overflow, 'no horizontal overflow on mobile (390px)');

  // --- console cleanliness -------------------------------------------------
  const problems = b.problems();
  const realErrors = problems.console.filter((l) => !/favicon|Download the React|502|dev-only/i.test(l));
  ok(realErrors.length === 0, `no console errors (${realErrors.length})${realErrors.length ? ': ' + realErrors.join(' | ') : ''}`);
} finally {
  await b.close();
}

console.log(`\nMEDIA SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
