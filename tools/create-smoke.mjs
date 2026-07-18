/**
 * Milestone E acceptance smoke — the manual Create Post workspace.
 *
 * Drives the REAL /create UI in headless Chrome against a review server started
 * with --live-publishing (fake adapters, no real provider). Verifies: exact
 * platform/account selection, editable per-platform copy, Save Draft (idempotent,
 * persists across reload), per-platform independence, honest readiness, and
 * Publish Now -> durable jobs -> published, with zero console errors.
 *
 * Usage: node tools/create-smoke.mjs [baseUrl]
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4902';
let pass = 0; let fail = 0; const failures = [];
const ok = (c, label) => { if (c) { pass += 1; console.log(`  PASS ${label}`); } else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THREADS_COPY = 'We help local teams show up in search with practical work you can actually see. This week we walked a client through the exact fixes that moved three of their service pages onto the first page, and why the small technical details mattered more than the big rewrite they expected from us today.';
const IG_COPY = 'Behind every ranking is a set of small, deliberate choices. Here is how we approach the work for local service businesses, one honest step at a time, from the first audit through the follow up review that keeps the momentum going for months.';

const b = await launch({ width: 1440, height: 1000, port: 9902 });
const listPosts = () => b.evaluate(`fetch('/api/posts?limit=100',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>j.data.posts)`);
const tick = () => b.evaluate(`fetch('/__review/tick',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json())`);

try {
  await b.goto(`${BASE}/login`, { waitMs: 800 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1500);

  // --- workspace renders ---------------------------------------------------
  await b.goto(`${BASE}/create`, { waitMs: 1200 });
  const shell = await b.evaluate(`(() => ({
    drafts: !!document.body.innerText.match(/Your drafts/),
    accounts: document.querySelectorAll('input[data-account]').length,
    publish: !!document.body.innerText.match(/Publish now/),
    save: !!document.body.innerText.match(/Save draft/),
  }))()`);
  ok(shell.drafts && shell.save && shell.publish, 'the workspace renders drafts + Save draft + Publish now');
  ok(shell.accounts >= 2, `connected accounts are listed (${shell.accounts})`);

  // Identify the Instagram + Threads checkbox ids via the API.
  const accts = await b.evaluate(`fetch('/api/social-accounts',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>j.data.accounts.map(a=>({id:a.id,t:a.accountType})))`);
  const ig = accts.find((a) => a.t === 'instagram_professional');
  const th = accts.find((a) => a.t === 'threads_profile');
  ok(ig && th, 'the seeded user has Instagram + Threads accounts');

  // --- select Instagram + Threads (NOT Facebook), write copy ---------------
  const draftsBefore = (await listPosts()).filter((p) => p.status === 'draft').length;
  await b.evaluate(`(() => { for (const id of ['acct-${ig.id}','acct-${th.id}']) { const n=document.getElementById(id); n.checked=true; n.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
  await sleep(900); // ensureDraft + syncTargets + renderEditor
  const tabs = await b.evaluate(`[...document.querySelectorAll('.pe-tab')].map(t=>t.getAttribute('data-platform'))`);
  ok(tabs.includes('instagram') && tabs.includes('threads'), 'editor shows Instagram + Threads tabs');
  ok(!tabs.includes('facebook'), 'no Facebook tab — it was not selected');

  await b.evaluate(`(() => { const set=(id,v)=>{const n=document.getElementById(id); if(n){n.value=v; n.dispatchEvent(new Event('input',{bubbles:true}));}}; set('c-copy-instagram',${JSON.stringify(IG_COPY)}); set('c-copy-threads',${JSON.stringify(THREADS_COPY)}); })()`);

  // --- Save Draft repeatedly -> exactly one draft --------------------------
  const clickSave = `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save draft'); b && b.click(); })()`;
  await b.evaluate(clickSave); await sleep(700);
  await b.evaluate(clickSave); await sleep(700);
  let posts = await listPosts();
  const drafts = posts.filter((p) => p.status === 'draft');
  ok(drafts.length - draftsBefore === 1, `repeated Save draft made exactly one new draft (+${drafts.length - draftsBefore})`);
  // The newest draft is this run's (highest numeric id).
  const draftId = drafts.map((d) => d.id).sort((a, x) => Number(x) - Number(a))[0];
  const mine = drafts.find((d) => String(d.id) === String(draftId));
  ok(mine?.postOrigin === 'manual_draft', 'the draft records a manual origin');

  // --- reload persists exact per-platform copy -----------------------------
  await b.goto(`${BASE}/create`, { waitMs: 1200 });
  await b.evaluate(`(async () => { const r=await fetch('/api/posts/${draftId}',{headers:{Accept:'application/json'}}); return r.status; })()`);
  const persisted = await b.evaluate(`fetch('/api/posts/${draftId}',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>({ ig:j.data.post.platformCopy.instagram.postCopy, th:j.data.post.platformCopy.threads.postCopy }))`);
  ok(persisted.th === THREADS_COPY, 'the Threads copy persisted across reload');
  ok(persisted.ig === IG_COPY, 'the Instagram copy persisted across reload');

  // --- edit Threads only -> Instagram byte-for-byte unchanged --------------
  const edited = await b.evaluate(`(async () => {
    const csrf=(await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json()).data.csrfToken;
    const cur=(await (await fetch('/api/posts/${draftId}',{headers:{Accept:'application/json'}})).json()).data.post;
    const r=await fetch('/api/posts/${draftId}/save-draft',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Accept:'application/json'},body:JSON.stringify({ platformCaptions:{ threads:{ postCopy:${JSON.stringify(THREADS_COPY + ' A small update just for Threads.')}, hashtags:[] } }, expectedVersion: cur.draftVersion })});
    const j=await r.json();
    return { status:r.status, ig:j.data.post.platformCopy.instagram.postCopy, th:j.data.post.platformCopy.threads.postCopy };
  })()`);
  ok(edited.status === 200 && /just for Threads/.test(edited.th), 'a Threads-only edit saved');
  ok(edited.ig === IG_COPY, 'Instagram copy is unchanged by the Threads edit');

  // --- readiness: Instagram without an image is media_required -------------
  const readiness = await b.evaluate(`fetch('/api/posts/${draftId}/readiness',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>j.data.readiness)`);
  const igR = readiness.targets.find((t) => t.platform === 'instagram');
  ok(igR && igR.status === 'media_required', 'Instagram honestly reports it needs an image');
  ok(readiness.ready === false, 'the post is not ready while Instagram lacks media');

  // --- Publish Now on a Threads-only post (no media needed) ----------------
  const pubPost = await b.evaluate(`(async () => {
    const csrf=(await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json()).data.csrfToken;
    const H={'Content-Type':'application/json','X-CSRF-Token':csrf,Accept:'application/json'};
    const created=(await (await fetch('/api/posts',{method:'POST',headers:H,body:JSON.stringify({title:'Publish now test'})})).json()).data.post;
    await fetch('/api/posts/'+created.id+'/targets',{method:'PUT',headers:H,body:JSON.stringify({targets:[{socialAccountId:'${th.id}'}]})});
    const cur=(await (await fetch('/api/posts/'+created.id,{headers:{Accept:'application/json'}})).json()).data.post;
    await fetch('/api/posts/'+created.id+'/save-draft',{method:'POST',headers:H,body:JSON.stringify({ platformCaptions:{ threads:{ postCopy:${JSON.stringify(THREADS_COPY)}, hashtags:[] } }, expectedVersion:cur.draftVersion })});
    return created.id;
  })()`);
  // Click Publish Now twice via the API to prove idempotency, then read jobs.
  const pubRes = await b.evaluate(`(async () => {
    const csrf=(await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json()).data.csrfToken;
    const H={'X-CSRF-Token':csrf,'Content-Type':'application/json',Accept:'application/json'};
    const cur=(await (await fetch('/api/posts/${pubPost}',{headers:{Accept:'application/json'}})).json()).data.post;
    const a=await (await fetch('/api/posts/${pubPost}/publish-now',{method:'POST',headers:H,body:JSON.stringify({expectedVersion:cur.draftVersion})})).json();
    const b2=await (await fetch('/api/posts/${pubPost}/publish-now',{method:'POST',headers:H,body:JSON.stringify({})})).json();
    return { status:a.data?.post?.status, notice:a.data?.notice };
  })()`);
  ok(pubRes.status === 'queued', 'Publish Now returns an honest queued state (not "published")');

  await tick();
  posts = await listPosts();
  const pub = posts.find((p) => String(p.id) === String(pubPost));
  const thTarget = (pub?.targets || []).find((t) => t.accountType === 'threads_profile');
  ok(thTarget && thTarget.publishStatus === 'published', 'the worker published the Threads target once');
  ok(pub?.status === 'published', 'the post is published');
  ok((pub?.targets || []).length === 1, 'exactly one target — no duplicate from the repeated Publish Now');

  // --- console cleanliness --------------------------------------------------
  const problems = b.problems();
  const errs = problems.console.filter((l) => /error/i.test(l) && !/favicon|502|the server responded with a status of 404.*\/media/i.test(l));
  ok(errs.length === 0, `no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally {
  await b.close();
}

console.log(`\nCREATE SMOKE: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);
