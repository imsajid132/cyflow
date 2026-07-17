/**
 * Create Post — a guided flow over the existing Phase 4 endpoints.
 *
 * Brief → accounts → generate captions → generate branded image → schedule.
 * Every step reflects real server state. Nothing is faked: captions appear only
 * after OpenAI returns them, the image preview only after HCTI renders one, and
 * scheduling is always described as queued-for-a-future-publishing-phase.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, badge, notice, toast, field, selectField, val,
  setLoading, setFieldError, clearFieldErrors, emptyState, skeleton,
} from '../ui.js';
import { PROVIDER_LABELS, PLATFORM_LABELS } from '../icons.js';
import { platformEditor } from '../components/platformEditor.js';
import { pickMedia } from '../components/mediaPicker.js';

const TONES = ['neutral', 'friendly', 'professional', 'playful', 'bold', 'informative'];
const HASHTAGS = ['none', 'few', 'moderate', 'many'];
const RATIOS = [
  ['square', 'Square · 1080×1080'],
  ['portrait', 'Portrait · 1080×1350'],
  ['landscape', 'Landscape · 1200×630'],
];
const RATIO_LABELS = { square: '1080 × 1080', portrait: '1080 × 1350', landscape: '1200 × 630' };
const BACKGROUNDS = ['light', 'dark', 'gradient-blue', 'gradient-warm', 'neutral'];

function opts(list) {
  return list.map((v) => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }));
}

function checkbox(id, label, checked) {
  const input = el('input', { attrs: { type: 'checkbox', id, 'aria-label': label } });
  input.checked = Boolean(checked);
  return el('label', { className: 'choice-inline', attrs: { for: id } }, [input, el('span', { text: label })]);
}

export async function render(root, ctx) {
  const [caps, profile, accountsRes] = await Promise.all([
    api.apiRequest('/api/posts/capabilities'),
    api.businessProfile(),
    api.apiRequest('/api/social-accounts'),
  ]);
  if (caps.unauthorized || accountsRes.unauthorized) { ctx.navigate('/login'); return; }

  const capabilities = api.payload(caps) || {};
  const accounts = (api.payload(accountsRes)?.accounts || []).filter((a) => a.status === 'active');
  // The server owns the template list; never hardcode slugs here.
  const templates = (capabilities.templates || []).map((t) => ({ value: t.id, label: t.label }));

  let post = null; // the server's draft — the single source of truth on this page

  const page = el('div', { className: 'page' }, [
    pageHead('Create post', 'Write a brief, generate post copy and a branded image, then schedule it.'),
  ]);

  if (!capabilities.openai?.available) {
    page.appendChild(notice('Content generation is unavailable right now. You can still write a brief and save a draft.', 'warn'));
  }
  if (!capabilities.hcti?.verified) {
    page.appendChild(el('div', { className: 'notice notice-warn' }, [
      el('div', {}, [
        el('strong', { text: 'Image generation needs HCTI' }),
        el('p', { text: capabilities.hcti?.configured
          ? 'Your HCTI credentials are saved but not verified yet.'
          : 'Add your HCTI credentials to generate branded images.' }),
      ]),
      el('span', { className: 'spacer' }),
      el('a', { className: 'btn btn-secondary btn-sm', text: 'Open Integrations', attrs: { href: '/integrations', 'data-link': '' } }),
    ]));
  }

  // --- Step 1: the brief ---------------------------------------------------
  const briefCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: '1. Brief' })]),
    field({ id: 'title', label: 'Post title', hint: 'For your reference only — it is never published.' }),
    field({ id: 'brief', label: 'What is this post about?', type: 'textarea',
      attrs: { required: true, rows: 4 },
      hint: 'Describe the offer, update, or message in plain language.' }),
    el('div', { className: 'grid grid-2' }, [
      field({ id: 'brandName', label: 'Brand name', value: profile?.businessName || '' }),
      field({ id: 'callToAction', label: 'Call to action', value: profile?.defaultCallToAction || '' }),
    ]),
    el('div', { className: 'grid grid-3' }, [
      selectField({ id: 'tone', label: 'Tone', options: opts(TONES), value: profile?.defaultTone || 'neutral' }),
      selectField({ id: 'hashtagPreference', label: 'Hashtags', options: opts(HASHTAGS), value: 'moderate' }),
      field({ id: 'language', label: 'Language', value: profile?.defaultLanguage || '' }),
    ]),
    field({ id: 'additionalInstructions', label: 'Anything else?', type: 'textarea' }),
  ]);

  // --- Step 2: accounts ----------------------------------------------------
  const accountHost = el('div', { className: 'stack', attrs: { style: 'gap:.4rem' } });
  if (accounts.length) {
    for (const a of accounts) {
      const name = a.displayName || a.username || 'Account';
      const provider = PROVIDER_LABELS[a.provider] || a.provider;
      accountHost.appendChild(el('label', { className: 'choice-inline', attrs: { for: `acct-${a.id}` } }, [
        el('input', {
          attrs: { type: 'checkbox', id: `acct-${a.id}`, 'data-account': a.id, 'aria-label': `${name} · ${provider}` },
        }),
        el('span', {}, [
          el('span', { text: name, attrs: { style: 'font-weight:600' } }),
          el('span', { className: 'card-sub', text: ` · ${provider}` }),
        ]),
      ]));
    }
  } else {
    accountHost.appendChild(emptyState({
      title: 'No connected accounts',
      subtitle: 'Connect an account before generating post copy. Each platform is written separately.',
      action: el('a', { className: 'btn btn-primary btn-sm', text: 'Connect an account', attrs: { href: '/connections', 'data-link': '' } }),
    }));
  }
  const accountsCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: '2. Where it goes' })]),
    accountHost,
  ]);

  // --- Step 3: captions ----------------------------------------------------
  const captionHost = el('div', {});
  const generateBtn = el('button', { className: 'btn btn-primary', text: 'Generate post copy', attrs: { type: 'button' } });
  const captionsCard = card([
    el('div', { className: 'card-head' }, [
      el('span', { className: 'card-title', text: '3. Post copy' }),
      generateBtn,
    ]),
    captionHost,
  ]);
  captionHost.appendChild(el('p', { className: 'hint', text: 'Post copy appears here once generated.' }));

  // --- Step 4: image -------------------------------------------------------
  const imageHost = el('div', {});
  const imageBtn = el('button', { className: 'btn btn-primary', text: 'Generate image', attrs: { type: 'button' } });
  imageBtn.disabled = true;
  // Choose an uploaded image from the library instead of rendering one. Works
  // without HCTI — an uploaded image needs no rendering.
  const chooseImageBtn = el('button', { className: 'btn btn-secondary', text: 'Choose from library', attrs: { type: 'button' } });
  chooseImageBtn.addEventListener('click', async () => {
    if (!post?.id) { toast('Generate the post copy first so there is a draft to attach to.', 'warn'); return; }
    const picked = await pickMedia({ allowClear: Boolean(post?.media) });
    if (picked === null) return;
    const mediaAssetId = picked.clear ? null : picked.id;
    setLoading(chooseImageBtn, true, 'Attaching…');
    try {
      const res = await api.apiRequest(`/api/posts/${encodeURIComponent(post.id)}/select-media`, {
        method: 'POST', body: { mediaAssetId },
      });
      if (!res.ok) { toast(api.errorMessage(res, 'The image could not be attached.'), 'err'); return; }
      post = api.payload(res)?.post ?? post;
      toast(mediaAssetId ? 'Image attached.' : 'Image removed.', 'ok');
      renderImage();
    } finally {
      setLoading(chooseImageBtn, false);
    }
  });
  const imageCard = card([
    el('div', { className: 'card-head' }, [
      el('span', { className: 'card-title', text: '4. Branded image' }),
      el('div', { className: 'row', attrs: { style: 'gap:.4rem' } }, [chooseImageBtn, imageBtn]),
    ]),
    el('div', { className: 'grid grid-3' }, [
      selectField({ id: 'template', label: 'Template', options: templates, value: templates[0]?.value }),
      selectField({ id: 'aspectRatio', label: 'Size', options: opts(RATIOS), value: 'square' }),
      selectField({ id: 'backgroundStyle', label: 'Background', options: opts(BACKGROUNDS), value: 'light' }),
    ]),
    el('div', { className: 'row', attrs: { style: 'gap:1rem;flex-wrap:wrap' } }, [
      checkbox('includeLogo', 'Show logo', Boolean(profile?.logoUrl)),
      checkbox('includeWebsite', 'Show website', Boolean(profile?.websiteUrl)),
      checkbox('includePhone', 'Show phone', false),
    ]),
    el('p', { className: 'hint', text: 'Images use your brand colours, fonts, and logo from the Brand page.' }),
    imageHost,
  ]);
  if (!post?.media) {
    imageHost.appendChild(el('p', { className: 'hint', text: 'Your rendered image appears here.' }));
  }

  // --- Step 5: schedule ----------------------------------------------------
  const scheduleBtn = el('button', { className: 'btn btn-primary', text: 'Schedule post', attrs: { type: 'button' } });
  const scheduleHost = el('div', {});
  const tz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  })();
  const scheduleCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: '5. Schedule' })]),
    el('div', { className: 'grid grid-3' }, [
      field({ id: 'scheduledDate', label: 'Date', type: 'date' }),
      field({ id: 'scheduledTime', label: 'Time', type: 'time' }),
      field({ id: 'timezone', label: 'Timezone', value: tz }),
    ]),
    el('div', { className: 'row' }, [scheduleBtn]),
    scheduleHost,
    notice('Scheduling saves the post for a future publishing phase. Cyflow does not publish to Facebook, Instagram, or Threads yet.', 'info'),
  ]);

  page.append(briefCard, accountsCard, captionsCard, imageCard, scheduleCard);
  root.appendChild(page);

  // --- behaviour -----------------------------------------------------------

  function collectFields() {
    const includeLogo = document.getElementById('includeLogo')?.checked ?? false;
    const includeWebsite = document.getElementById('includeWebsite')?.checked ?? false;
    const includePhone = document.getElementById('includePhone')?.checked ?? false;
    return {
      title: val('title') || null,
      brief: val('brief'),
      brandName: val('brandName') || null,
      callToAction: val('callToAction') || null,
      language: val('language') || null,
      tone: val('tone') || null,
      hashtagPreference: val('hashtagPreference') || null,
      additionalInstructions: val('additionalInstructions') || null,
      template: val('template'),
      aspectRatio: val('aspectRatio'),
      backgroundStyle: val('backgroundStyle'),
      includeLogo, includeWebsite, includePhone,
    };
  }

  function selectedAccountIds() {
    return [...accountHost.querySelectorAll('input[data-account]')]
      .filter((i) => i.checked)
      .map((i) => i.getAttribute('data-account'));
  }

  function applyErrors(res, fallback) {
    const errors = api.fieldErrors(res);
    let first = null;
    for (const [f, message] of Object.entries(errors)) {
      setFieldError(f, message);
      if (!first) first = f;
    }
    if (first) document.getElementById(first)?.focus();
    toast(api.errorMessage(res, fallback), 'err');
  }

  /** Create the draft on first use, then keep it updated. */
  async function ensureDraft() {
    const fields = collectFields();
    if (!fields.brief) {
      setFieldError('brief', 'Tell us what the post is about');
      document.getElementById('brief')?.focus();
      return null;
    }
    const res = post
      ? await api.apiRequest(`/api/posts/${post.id}`, { method: 'PATCH', body: fields })
      : await api.apiRequest('/api/posts', { method: 'POST', body: fields });
    if (res.unauthorized) { ctx.navigate('/login'); return null; }
    if (!res.ok) { applyErrors(res, 'Please check the highlighted fields.'); return null; }
    post = api.payload(res)?.post || null;
    return post;
  }

  async function syncTargets() {
    const ids = selectedAccountIds();
    if (!ids.length) {
      toast('Select at least one connected account.', 'err');
      return false;
    }
    const res = await api.apiRequest(`/api/posts/${post.id}/targets`, {
      method: 'PUT',
      body: { targets: ids.map((id) => ({ socialAccountId: id })) },
    });
    if (res.unauthorized) { ctx.navigate('/login'); return false; }
    if (!res.ok) { toast(api.errorMessage(res, 'Those accounts could not be selected.'), 'err'); return false; }
    post = api.payload(res)?.post || post;
    return true;
  }

  function renderCaptions() {
    captionHost.textContent = '';
    // The server resolves per-platform copy for the SELECTED platforms (derived
    // from the post's target accounts). Rendered through the SAME shared editor
    // the Weekly Board uses, so tabs, official marks, measurements and
    // selected-platforms-only behaviour are identical across the two surfaces.
    const platformCopy = post?.platformCopy || {};
    const platforms = post?.platformTargets || Object.keys(platformCopy);
    if (!platforms.length || !Object.keys(platformCopy).length) {
      captionHost.appendChild(el('p', { className: 'hint', text: 'Post copy appears here once generated.' }));
      return;
    }
    /*
     * Read-only here in C2. Create Post's full per-platform manual editing and
     * save is part of Milestone E (the Publish/Draft workspace), where a
     * scheduled-post platform-copy save path is built. Showing an editable field
     * with no save behind it would be a worse affordance than an honest,
     * consistent read-only view.
     */
    const editor = platformEditor({ platforms, platformCopy, idPrefix: 'c', readOnly: true });
    captionHost.appendChild(editor.node);
    if (post?.imageHeadline) {
      captionHost.appendChild(el('p', { className: 'hint', text: `Image headline: ${post.imageHeadline}` }));
      imageBtn.disabled = false;
    }
  }

  /** Framed preview with the template it was rendered from. */
  function renderImage() {
    imageHost.textContent = '';
    if (!post?.media?.publicToken) return;

    const ratio = post.aspectRatio || 'square';
    const templateLabel = templates.find((t) => t.value === post.template)?.label || post.template || '';

    const frame = el('div', { className: `preview-frame preview-${ratio}` });
    const img = el('img', {
      className: 'preview-img',
      attrs: {
        src: `/media/${encodeURIComponent(post.media.publicToken)}`,
        alt: post.imageAltText || 'Generated post image',
      },
    });
    // The frame holds the space while the render loads, so nothing jumps.
    frame.classList.add('is-loading');
    img.addEventListener('load', () => frame.classList.remove('is-loading'), { once: true });
    img.addEventListener('error', () => {
      frame.classList.remove('is-loading');
      frame.textContent = '';
      frame.appendChild(el('p', { className: 'preview-failed', text: 'The image could not be displayed. Generate it again.' }));
    }, { once: true });
    frame.appendChild(img);

    imageHost.appendChild(el('div', { className: 'preview' }, [
      frame,
      el('div', { className: 'preview-meta' }, [
        templateLabel ? badge(templateLabel, 'info') : null,
        el('span', { className: 'card-sub', text: RATIO_LABELS[ratio] || '' }),
        el('span', { className: 'spacer' }),
        el('a', {
          className: 'btn btn-ghost btn-sm',
          text: 'Open full size',
          attrs: {
            href: `/media/${encodeURIComponent(post.media.publicToken)}`,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
        }),
      ]),
    ]));
  }

  /** Placeholder that reserves the preview's space while HCTI renders. */
  function renderImageLoading() {
    imageHost.textContent = '';
    const ratio = val('aspectRatio') || 'square';
    imageHost.appendChild(el('div', { className: 'preview' }, [
      el('div', { className: `preview-frame preview-${ratio} is-loading`, attrs: { 'aria-hidden': 'true' } }),
      el('span', { className: 'sr-only', text: 'Rendering your image…' }),
    ]));
  }

  generateBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    setLoading(generateBtn, true, 'Generating…');
    try {
      if (!(await ensureDraft())) return;
      if (!(await syncTargets())) return;
      captionHost.textContent = '';
      captionHost.appendChild(skeleton({ lines: 3 }));
      const res = await api.apiRequest(`/api/posts/${post.id}/generate-content`, { method: 'POST' });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        captionHost.textContent = '';
        captionHost.appendChild(notice(api.errorMessage(res, 'The captions could not be generated. Please try again.'), 'err'));
        return;
      }
      post = api.payload(res)?.post || post;
      renderCaptions();
      toast('Post copy generated.', 'ok');
    } finally {
      setLoading(generateBtn, false);
    }
  });

  imageBtn.addEventListener('click', async () => {
    setLoading(imageBtn, true, 'Rendering…');
    renderImageLoading();
    try {
      if (!post) return;
      // Persist the chosen template/toggles before rendering.
      const patch = await api.apiRequest(`/api/posts/${post.id}`, { method: 'PATCH', body: collectFields() });
      if (patch.unauthorized) { ctx.navigate('/login'); return; }
      if (patch.ok) post = api.payload(patch)?.post || post;

      const res = await api.apiRequest(`/api/posts/${post.id}/generate-image`, { method: 'POST' });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        imageHost.textContent = '';
        imageHost.appendChild(notice(api.errorMessage(res, 'The image could not be generated. Please try again.'), 'err'));
        return;
      }
      post = api.payload(res)?.post || post;
      renderImage();
      toast('Image generated.', 'ok');
    } finally {
      setLoading(imageBtn, false);
    }
  });

  scheduleBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    scheduleHost.textContent = '';
    setLoading(scheduleBtn, true, 'Scheduling…');
    try {
      if (!post) {
        scheduleHost.appendChild(notice('Generate post copy first so there is something to schedule.', 'warn'));
        return;
      }
      if (!(await syncTargets())) return;
      const res = await api.apiRequest(`/api/posts/${post.id}/schedule`, {
        method: 'POST',
        body: { scheduledDate: val('scheduledDate'), scheduledTime: val('scheduledTime'), timezone: val('timezone') },
      });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) { applyErrors(res, 'That schedule could not be saved.'); return; }
      const body = api.payload(res) || {};
      post = body.post || post;
      scheduleHost.appendChild(notice(body.post?.notice || 'Your post is queued for a future publishing phase.', 'ok'));
      toast('Post queued.', 'ok');
      ctx.navigate('/queue');
    } finally {
      setLoading(scheduleBtn, false);
    }
  });
}
