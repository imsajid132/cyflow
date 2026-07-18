/**
 * Create Post — the manual content + publishing workspace (Milestone E).
 *
 * One post is the server's source of truth (`post`, carrying `draftVersion` for
 * optimistic concurrency). The user picks exact platforms + accounts, writes copy
 * per platform (optionally with OpenAI help), chooses media, and then takes ONE of
 * three explicit actions: Save Draft, Schedule Later, or Publish Now. Publish Now
 * enqueues durable background jobs and returns an honest queued state — the
 * browser never calls a provider. Readiness is decided by the server and shown per
 * target; the UI never claims a post is ready that the server would reject.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, badge, notice, toast, field, selectField, val,
  setLoading, setFieldError, clearFieldErrors, emptyState, confirmModal, formatDate,
} from '../ui.js';
import { PROVIDER_LABELS, PLATFORM_LABELS } from '../icons.js';
import { platformEditor } from '../components/platformEditor.js';
import { pickMedia } from '../components/mediaPicker.js';

const TONES = ['neutral', 'friendly', 'professional', 'playful', 'bold', 'informative'];
const HASHTAGS = ['none', 'few', 'moderate', 'many'];

const READINESS_LABEL = {
  ready: 'Ready', draft_incomplete: 'Needs copy', validation_failed: 'Copy too long',
  account_required: 'Account needed', reconnect_required: 'Reconnect account',
  media_required: 'Image needed', media_unavailable: 'Image unavailable',
  already_publishing: 'Publishing', immutable_after_submission: 'Published',
};
const READINESS_TONE = (s) => (s === 'ready' ? 'ok' : (s === 'already_publishing' || s === 'immutable_after_submission') ? 'info' : 'warn');

function opts(list) { return list.map((v) => ({ value: v, label: v })); }

export async function render(root, ctx) {
  const [caps, profile, accountsRes, draftsRes] = await Promise.all([
    api.apiRequest('/api/posts/capabilities'),
    api.businessProfile(),
    api.apiRequest('/api/social-accounts'),
    api.apiRequest('/api/posts?limit=50&status=draft'),
  ]);
  if (caps.unauthorized || accountsRes.unauthorized) { ctx.navigate('/login'); return; }

  const capabilities = api.payload(caps) || {};
  const liveEnabled = Boolean(capabilities.publishing?.liveEnabled);
  const accounts = (api.payload(accountsRes)?.accounts || []).filter((a) => a.status === 'active');
  const drafts = api.payload(draftsRes)?.posts || [];

  let post = null;         // the server's post — the single source of truth
  let editor = null;       // the shared per-platform editor (editable)
  let dirty = false;       // unsaved field/copy edits

  const page = el('div', { className: 'page' });
  root.appendChild(page);

  // --- unsaved-change guard (reload / close / back) ------------------------
  const beforeUnload = (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  // Clean the listener up when the SPA swaps this view out.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(page)) { window.removeEventListener('beforeunload', beforeUnload); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function isDirty() { return dirty || (editor && editor.isDirty()); }
  function markClean() { dirty = false; }

  // ---- header + honest global notices -------------------------------------
  page.appendChild(pageHead('Create post',
    'Write each platform’s post, then save a draft, schedule it, or publish now.'));

  if (!accounts.length) {
    page.appendChild(emptyState({
      title: 'Connect an account first',
      subtitle: 'Create Post writes a separate post for each connected Facebook Page, Instagram Professional or Threads account.',
      action: el('a', { className: 'btn btn-primary', text: 'Connect an account', attrs: { href: '/connections', 'data-link': '' } }),
    }));
    return;
  }
  if (!liveEnabled) {
    page.appendChild(notice('Live publishing is turned off, so Publish Now queues a post but nothing is sent to a provider yet.', 'info'));
  }

  // ---- your drafts --------------------------------------------------------
  const draftsHost = el('div', { className: 'stack', attrs: { style: 'gap:.4rem' } });
  function renderDrafts() {
    draftsHost.textContent = '';
    if (!drafts.length) { draftsHost.appendChild(el('p', { className: 'hint', text: 'Saved drafts appear here.' })); return; }
    for (const d of drafts) {
      const openBtn = el('button', { className: 'btn btn-ghost btn-sm', text: 'Open', attrs: { type: 'button' } });
      openBtn.addEventListener('click', () => loadDraft(d.id));
      draftsHost.appendChild(el('div', { className: 'row' }, [
        el('span', { text: d.title || '(untitled)', attrs: { style: 'font-weight:600' } }),
        el('span', { className: 'card-sub', text: d.updatedAt ? formatDate(d.updatedAt) : '' }),
        el('span', { className: 'spacer' }),
        openBtn,
      ]));
    }
  }

  // ---- brief --------------------------------------------------------------
  const briefCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Brief' })]),
    field({ id: 'title', label: 'Post title', hint: 'For your reference only — never published.' }),
    field({ id: 'brief', label: 'What is this post about?', type: 'textarea', attrs: { rows: 3 },
      hint: 'Optional — used only if you ask AI to help write.' }),
    el('div', { className: 'grid grid-3' }, [
      selectField({ id: 'tone', label: 'Tone', options: opts(TONES), value: profile?.defaultTone || 'neutral' }),
      selectField({ id: 'hashtagPreference', label: 'Hashtags', options: opts(HASHTAGS), value: 'moderate' }),
      field({ id: 'language', label: 'Language', value: profile?.defaultLanguage || '' }),
    ]),
  ]);
  briefCard.addEventListener('input', () => { dirty = true; });

  // ---- accounts (exact platform + account selection) ----------------------
  const accountHost = el('div', { className: 'stack', attrs: { style: 'gap:.35rem' } });
  for (const a of accounts) {
    const name = a.displayName || a.username || 'Account';
    const providerLabel = PROVIDER_LABELS[a.provider] || a.provider;
    const input = el('input', { attrs: { type: 'checkbox', id: `acct-${a.id}`, 'data-account': a.id, 'aria-label': `${name} · ${providerLabel}` } });
    input.addEventListener('change', onAccountsChanged);
    accountHost.appendChild(el('label', { className: 'choice-inline', attrs: { for: `acct-${a.id}` } }, [
      input,
      el('span', {}, [
        el('span', { text: name, attrs: { style: 'font-weight:600' } }),
        el('span', { className: 'card-sub', text: ` · ${providerLabel}` }),
      ]),
    ]));
  }
  const accountsCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Where it goes' })]),
    el('p', { className: 'hint', text: 'Each selected account gets its own post. Nothing is auto-selected.' }),
    accountHost,
  ]);

  // ---- per-platform copy editor ------------------------------------------
  const editorHost = el('div', {});
  const aiBtn = el('button', { className: 'btn btn-secondary btn-sm', text: 'Write with AI', attrs: { type: 'button' } });
  aiBtn.addEventListener('click', onGenerate);
  const copyCard = card([
    el('div', { className: 'card-head' }, [
      el('span', { className: 'card-title', text: 'Post copy' }),
      capabilities.openai?.available ? aiBtn : null,
    ]),
    editorHost,
  ]);
  editorHost.appendChild(el('p', { className: 'hint', text: 'Select an account above to start writing.' }));

  // ---- media --------------------------------------------------------------
  const mediaHost = el('div', {});
  const chooseImageBtn = el('button', { className: 'btn btn-secondary btn-sm', text: 'Choose from library', attrs: { type: 'button' } });
  chooseImageBtn.addEventListener('click', onChooseMedia);
  const mediaCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Image' }), chooseImageBtn]),
    el('p', { className: 'hint', text: 'Instagram needs an image. Facebook and Threads can post text only.' }),
    mediaHost,
  ]);

  // ---- readiness + actions ------------------------------------------------
  const readinessHost = el('div', { className: 'stack', attrs: { style: 'gap:.35rem' } });
  const saveBtn = el('button', { className: 'btn btn-secondary', text: 'Save draft', attrs: { type: 'button' } });
  const scheduleBtn = el('button', { className: 'btn btn-secondary', text: 'Schedule later', attrs: { type: 'button' } });
  const publishBtn = el('button', { className: 'btn btn-primary', text: 'Publish now', attrs: { type: 'button' } });
  saveBtn.addEventListener('click', onSaveDraft);
  scheduleBtn.addEventListener('click', onSchedule);
  publishBtn.addEventListener('click', onPublishNow);

  const scheduleFields = el('div', { className: 'grid grid-3', attrs: { hidden: true, id: 'schedule-fields' } }, [
    field({ id: 'scheduledDate', label: 'Date', type: 'date' }),
    field({ id: 'scheduledTime', label: 'Time', type: 'time' }),
    field({ id: 'timezone', label: 'Timezone', value: browserTz() }),
  ]);
  const actionsCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Readiness' })]),
    readinessHost,
    scheduleFields,
    el('div', { className: 'row', attrs: { style: 'gap:.5rem;flex-wrap:wrap;margin-top:.6rem' } }, [saveBtn, scheduleBtn, publishBtn]),
  ]);

  page.append(
    card([el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Your drafts' })]), draftsHost]),
    briefCard, accountsCard, copyCard, mediaCard, actionsCard,
  );
  renderDrafts();
  refreshActionState();

  // ===== behaviour =========================================================

  function browserTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }

  function selectedAccountIds() {
    return [...accountHost.querySelectorAll('input[data-account]')].filter((i) => i.checked).map((i) => i.getAttribute('data-account'));
  }

  function collectFields() {
    return {
      title: val('title') || null, brief: val('brief') || null,
      tone: val('tone') || null, hashtagPreference: val('hashtagPreference') || null,
      language: val('language') || null,
    };
  }

  function applyErrors(res, fallback) {
    const errors = api.fieldErrors(res);
    for (const [f, message] of Object.entries(errors)) setFieldError(f, message);
    toast(api.errorMessage(res, fallback), 'err');
  }

  /** A 409 means another tab moved ahead — reload the post, keep their copy. */
  function isConflict(res) { return res.status === 409; }
  async function handleConflict() {
    toast('This post changed in another tab. Reloading the latest version.', 'warn');
    if (post) await loadDraft(post.id);
  }

  // Single-flight: rapid account toggles (two change events) must create ONE
  // draft, not race two POSTs. Concurrent callers await the same create.
  let draftPromise = null;
  async function ensureDraft() {
    if (post) return post;
    if (draftPromise) return draftPromise;
    draftPromise = (async () => {
      const res = await api.apiRequest('/api/posts', { method: 'POST', body: collectFields() });
      if (res.unauthorized) { ctx.navigate('/login'); return null; }
      if (!res.ok) { applyErrors(res, 'The draft could not be created.'); return null; }
      post = api.payload(res)?.post || null;
      return post;
    })();
    try { return await draftPromise; } finally { draftPromise = null; }
  }

  async function syncTargets() {
    const ids = selectedAccountIds();
    const res = await api.apiRequest(`/api/posts/${post.id}/targets`, {
      method: 'PUT', body: { targets: ids.map((id) => ({ socialAccountId: id })) },
    });
    if (res.unauthorized) { ctx.navigate('/login'); return false; }
    if (!res.ok) { toast(api.errorMessage(res, 'Those accounts could not be selected.'), 'err'); return false; }
    post = api.payload(res)?.post || post;
    return true;
  }

  async function onAccountsChanged() {
    dirty = true;
    if (!selectedAccountIds().length) { post && (await syncTargets()); renderEditor(); refreshActionState(); return; }
    if (!(await ensureDraft())) return;
    if (!(await syncTargets())) return;
    renderEditor();
    await refreshReadiness();
    refreshActionState();
  }

  function renderEditor() {
    editorHost.textContent = '';
    const platforms = post?.platformTargets || [];
    const platformCopy = post?.platformCopy || {};
    if (!platforms.length) { editorHost.appendChild(el('p', { className: 'hint', text: 'Select an account above to start writing.' })); editor = null; return; }
    editor = platformEditor({ platforms, platformCopy, idPrefix: 'c', readOnly: false, onDirtyChange: () => refreshActionState() });
    editorHost.appendChild(editor.node);
  }

  function renderMedia() {
    mediaHost.textContent = '';
    if (post?.media?.publicToken) {
      mediaHost.appendChild(el('div', { className: 'row' }, [
        el('img', { className: 'thumb', attrs: { src: `/media/${encodeURIComponent(post.media.publicToken)}`, alt: post.imageAltText || '', loading: 'lazy', width: '72', height: '72' } }),
        el('span', { className: 'card-sub', text: 'Image attached' }),
      ]));
    } else {
      mediaHost.appendChild(el('p', { className: 'hint', text: 'No image selected.' }));
    }
  }

  async function refreshReadiness() {
    if (!post) return;
    const res = await api.apiRequest(`/api/posts/${post.id}/readiness`);
    if (!res.ok) return;
    const readiness = api.payload(res)?.readiness;
    readinessHost.textContent = '';
    if (!readiness || !readiness.targets.length) { readinessHost.appendChild(el('p', { className: 'hint', text: 'Select an account to see readiness.' })); return; }
    for (const t of readiness.targets) {
      readinessHost.appendChild(el('div', { className: 'row' }, [
        badge(READINESS_LABEL[t.status] || t.status, READINESS_TONE(t.status)),
        el('span', { text: t.accountLabel, attrs: { style: 'font-weight:600' } }),
        el('span', { className: 'spacer' }),
        el('span', { className: 'card-sub', text: t.reason || '' }),
      ]));
    }
  }

  function refreshActionState() {
    const hasTargets = Boolean(post?.platformTargets?.length);
    saveBtn.disabled = !post;
    scheduleBtn.disabled = !hasTargets;
    publishBtn.disabled = !hasTargets;
  }

  async function onGenerate() {
    clearFieldErrors(root);
    if (!(await ensureDraft())) return;
    if (!selectedAccountIds().length) { toast('Select at least one account first.', 'warn'); return; }
    if (!(await syncTargets())) return;
    setLoading(aiBtn, true, 'Writing…');
    try {
      const res = await api.apiRequest(`/api/posts/${post.id}/generate-content`, { method: 'POST' });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) { toast(api.errorMessage(res, 'The copy could not be generated.'), 'err'); return; }
      post = api.payload(res)?.post || post;
      renderEditor();
      await refreshReadiness();
      toast('Draft copy written. Edit each platform as you like.', 'ok');
    } finally { setLoading(aiBtn, false); }
  }

  async function onChooseMedia() {
    if (!(await ensureDraft())) return;
    const picked = await pickMedia({ allowClear: Boolean(post?.media) });
    if (picked === null) return;
    const mediaAssetId = picked.clear ? null : picked.id;
    setLoading(chooseImageBtn, true, 'Attaching…');
    try {
      const res = await api.apiRequest(`/api/posts/${post.id}/select-media`, { method: 'POST', body: { mediaAssetId } });
      if (!res.ok) { toast(api.errorMessage(res, 'The image could not be attached.'), 'err'); return; }
      post = api.payload(res)?.post || post;
      renderMedia();
      await refreshReadiness();
      toast(mediaAssetId ? 'Image attached.' : 'Image removed.', 'ok');
    } finally { setLoading(chooseImageBtn, false); }
  }

  /** Build the save-draft body from the fields + only the platforms the editor changed. */
  function saveBody() {
    const body = { ...collectFields(), expectedVersion: post?.draftVersion };
    if (editor) { const edits = editor.read(); if (Object.keys(edits).length) body.platformCaptions = edits; }
    return body;
  }

  async function onSaveDraft() {
    clearFieldErrors(root);
    if (!(await ensureDraft())) return;
    if (selectedAccountIds().length) { if (!(await syncTargets())) return; }
    setLoading(saveBtn, true, 'Saving…');
    try {
      const res = await api.apiRequest(`/api/posts/${post.id}/save-draft`, { method: 'POST', body: saveBody() });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (isConflict(res)) { await handleConflict(); return; }
      if (!res.ok) { applyErrors(res, 'The draft could not be saved.'); return; }
      post = api.payload(res)?.post || post;
      if (editor) editor.markSaved(post.platformCopy);
      markClean();
      renderMedia();
      await refreshReadiness();
      upsertDraftInList(post);
      toast('Draft saved.', 'ok');
    } finally { setLoading(saveBtn, false); }
  }

  async function onSchedule() {
    const wasHidden = scheduleFields.hidden;
    scheduleFields.hidden = false;
    if (wasHidden) { document.getElementById('scheduledDate')?.focus(); return; } // reveal on first click
    clearFieldErrors(root);
    // Save the latest state first so what schedules is what the user sees.
    if (!(await saveFirst())) return;
    const summary = `Schedule for ${val('scheduledDate') || '—'} ${val('scheduledTime') || ''} (${val('timezone')})?`;
    if (!(await confirmModal({ title: 'Schedule this post?', message: summary, confirmText: 'Schedule' }))) return;
    setLoading(scheduleBtn, true, 'Scheduling…');
    try {
      const res = await api.apiRequest(`/api/posts/${post.id}/schedule`, {
        method: 'POST',
        body: { scheduledDate: val('scheduledDate'), scheduledTime: val('scheduledTime'), timezone: val('timezone'), expectedVersion: post?.draftVersion },
      });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (isConflict(res)) { await handleConflict(); return; }
      if (!res.ok) { applyErrors(res, 'That schedule could not be saved.'); return; }
      markClean();
      toast(api.payload(res)?.notice || 'Post scheduled.', 'ok');
      ctx.navigate('/queue');
    } finally { setLoading(scheduleBtn, false); }
  }

  async function onPublishNow() {
    clearFieldErrors(root);
    if (!(await saveFirst())) return;
    // Explicit confirmation summary of exact accounts + media.
    const targets = (post.platformTargets || []).map((p) => PLATFORM_LABELS[p] || p).join(', ');
    const message = `${liveEnabled ? 'Publish now to' : 'Queue for'} ${targets}. ${post.media ? 'With the attached image. ' : ''}${liveEnabled ? 'Each account publishes independently.' : 'Live publishing is off, so nothing is sent to a provider yet.'}`;
    if (!(await confirmModal({ title: 'Publish now?', message, confirmText: liveEnabled ? 'Publish now' : 'Queue now' }))) return;
    setLoading(publishBtn, true, 'Queueing…');
    try {
      const res = await api.apiRequest(`/api/posts/${post.id}/publish-now`, { method: 'POST', body: { expectedVersion: post?.draftVersion } });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (isConflict(res)) { await handleConflict(); return; }
      if (!res.ok) { applyErrors(res, 'This post is not ready to publish yet.'); await refreshReadiness(); return; }
      markClean();
      toast(api.payload(res)?.notice || 'Queued for publishing.', 'ok');
      ctx.navigate('/queue');
    } finally { setLoading(publishBtn, false); }
  }

  /** Persist the latest copy/fields before a schedule/publish so intent matches. */
  async function saveFirst() {
    if (!(await ensureDraft())) return false;
    if (selectedAccountIds().length) { if (!(await syncTargets())) return false; }
    const res = await api.apiRequest(`/api/posts/${post.id}/save-draft`, { method: 'POST', body: saveBody() });
    if (res.unauthorized) { ctx.navigate('/login'); return false; }
    if (isConflict(res)) { await handleConflict(); return false; }
    if (!res.ok) { applyErrors(res, 'Please check the highlighted fields.'); return false; }
    post = api.payload(res)?.post || post;
    if (editor) editor.markSaved(post.platformCopy);
    markClean();
    return true;
  }

  function upsertDraftInList(p) {
    const i = drafts.findIndex((d) => String(d.id) === String(p.id));
    const row = { id: p.id, title: p.title, updatedAt: p.updatedAt };
    if (i >= 0) drafts[i] = row; else drafts.unshift(row);
    renderDrafts();
  }

  async function loadDraft(id) {
    if (isDirty() && !(await confirmModal({ title: 'Discard unsaved changes?', message: 'This post has unsaved edits. Open the other draft anyway?', confirmText: 'Discard and open', danger: true }))) return;
    const res = await api.apiRequest(`/api/posts/${encodeURIComponent(id)}`);
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) { toast('That draft could not be opened.', 'err'); return; }
    post = api.payload(res)?.post || null;
    if (!post) return;
    // Reflect the loaded post into the form + selections.
    document.getElementById('title').value = post.title || '';
    document.getElementById('brief').value = post.brief || '';
    const targetAccountIds = new Set((post.targets || []).map((t) => String(t.socialAccountId)));
    for (const input of accountHost.querySelectorAll('input[data-account]')) input.checked = targetAccountIds.has(input.getAttribute('data-account'));
    renderEditor(); renderMedia(); await refreshReadiness(); refreshActionState();
    markClean();
    toast('Draft opened.', 'ok');
  }
}
