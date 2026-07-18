/**
 * Queue — every post the user owns, with REAL per-target publishing state (D2).
 *
 * Each selected account is a target with its own status: one platform can be
 * published while another is retrying or failed. The post-level badge never
 * hides a target that still needs attention. Live publishing is gated behind a
 * flag; when it is off, the queue says so plainly rather than implying a post
 * will go out.
 */

import * as api from '../api.js';
import { el, card, pageHead, notice, emptyState, toast, formatDate, confirmModal, statusChip } from '../ui.js';
import { PROVIDER_LABELS, PLATFORM_LABELS } from '../icons.js';

const FILTERS = [
  ['all', 'All'],
  ['draft', 'Drafts'],
  ['queued', 'Queued'],
  ['processing', 'Publishing'],
  ['partial', 'Partial'],
  ['published', 'Published'],
  ['failed', 'Failed'],
  ['cancelled', 'Cancelled'],
];

const ACCOUNT_PLATFORM = { facebook_page: 'facebook', instagram_professional: 'instagram', threads_profile: 'threads' };

/*
 * Status is rendered through the shared statusChip so the Queue, Calendar,
 * Automations, Create Post and the Dashboard cannot describe the same state in
 * different words. The local tone/label maps this file used to carry were a
 * second status system and are gone.
 */

/**
 * A post thumbnail that degrades honestly. If the image is missing or cannot be
 * loaded, the tile becomes a neutral placeholder rather than a black square.
 */
function thumbnail(post) {
  if (!post.media?.publicToken) {
    return el('div', { className: 'thumb thumb-empty', attrs: { 'aria-hidden': 'true' } });
  }
  const img = el('img', {
    className: 'thumb',
    attrs: { src: `/media/${encodeURIComponent(post.media.publicToken)}`, alt: '', loading: 'lazy' },
  });
  img.addEventListener('error', () => {
    const fallback = el('div', {
      className: 'thumb thumb-empty',
      attrs: { title: 'This image is unavailable', 'aria-hidden': 'true' },
    });
    img.replaceWith(fallback);
  }, { once: true });
  return img;
}

export async function render(root, ctx) {
  let posts = [];
  let filter = 'all';
  let liveEnabled = false;

  const listHost = el('div', { className: 'stack' });
  const tabs = el('div', { className: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Filter posts by status' } });

  function renderList() {
    listHost.textContent = '';
    const visible = filter === 'all' ? posts : posts.filter((p) => p.status === filter);
    if (!visible.length) {
      listHost.appendChild(emptyState({
        title: filter === 'all' ? 'No posts yet' : `No ${filter} posts`,
        subtitle: 'Create a post to see it here.',
        action: el('a', { className: 'btn btn-primary btn-sm', text: 'Create post', attrs: { href: '/create', 'data-link': '' } }),
      }));
      return;
    }
    for (const post of visible) listHost.appendChild(row(post));
  }

  /** One account's publish status, plus its safe action (retry / view / reason). */
  function targetRow(post, target) {
    const platform = ACCOUNT_PLATFORM[target.accountType] || target.provider;
    const name = target.displayName || target.username || PROVIDER_LABELS[target.provider] || 'Account';
    const ps = target.publishStatus || 'scheduled';
    const bits = [
      // Same "Platform · Account" form as the weekly board card and the edit
      // drawer. Three surfaces described the same target three ways, and an
      // operator with more than one Page connected could not match them up.
      el('span', { className: 'chip' }, [el('span', { text: `${PLATFORM_LABELS[platform] || platform} · ${name}` })]),
      statusChip(ps),
    ];
    if (ps === 'published' && target.remotePostUrl) {
      bits.push(el('a', { className: 'btn btn-ghost btn-sm', text: 'View', attrs: { href: target.remotePostUrl, target: '_blank', rel: 'noopener noreferrer' } }));
    }
    if (['failed', 'attention_needed'].includes(ps)) {
      if (target.attentionReason) bits.push(el('span', { className: 'card-sub', text: target.attentionReason }));
      const retry = el('button', { className: 'btn btn-secondary btn-sm', text: 'Retry', attrs: { type: 'button' } });
      retry.addEventListener('click', async () => {
        const res = await api.apiRequest(`/api/publish/targets/${target.id}/retry`, { method: 'POST' });
        if (!res.ok) { toast(api.errorMessage(res, 'That target could not be retried.'), 'err'); return; }
        toast('Retry scheduled.', 'ok');
        await load();
      });
      bits.push(retry);
    }
    if (['scheduled', 'retry_scheduled', 'publishing', 'reconciling', 'submitted'].includes(ps)) {
      const cancel = el('button', { className: 'btn btn-ghost btn-sm', text: 'Cancel', attrs: { type: 'button' } });
      cancel.addEventListener('click', async () => {
        const res = await api.apiRequest(`/api/publish/targets/${target.id}/cancel`, { method: 'POST' });
        if (!res.ok) { toast(api.errorMessage(res, 'That target could not be cancelled.'), 'err'); return; }
        toast('Target cancelled.', 'ok');
        await load();
      });
      bits.push(cancel);
    }
    return el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap;align-items:center' } }, bits);
  }

  function row(post) {
    const actions = el('div', { className: 'row', attrs: { style: 'gap:.4rem' } });
    if (['draft', 'queued', 'retrying', 'processing'].includes(post.status)) {
      const cancelBtn = el('button', { className: 'btn btn-secondary btn-sm', text: 'Cancel post', attrs: { type: 'button' } });
      cancelBtn.addEventListener('click', async () => {
        const ok = await confirmModal({ title: 'Cancel this post?', message: 'It will not be scheduled. Published targets are not affected.', confirmText: 'Cancel post', danger: true });
        if (!ok) return;
        const res = await api.apiRequest(`/api/posts/${post.id}/cancel`, { method: 'POST' });
        if (res.unauthorized) { ctx.navigate('/login'); return; }
        if (!res.ok) { toast(api.errorMessage(res, 'That post could not be cancelled.'), 'err'); return; }
        toast('Post cancelled.', 'ok');
        await load();
      });
      actions.appendChild(cancelBtn);
    }
    if (post.status === 'draft' || post.status === 'cancelled') {
      const deleteBtn = el('button', { className: 'btn btn-danger btn-sm', text: 'Delete', attrs: { type: 'button' } });
      deleteBtn.addEventListener('click', async () => {
        const ok = await confirmModal({ title: 'Delete this post?', message: 'This permanently removes the draft and its generated content.', confirmText: 'Delete', danger: true });
        if (!ok) return;
        const res = await api.apiRequest(`/api/posts/${post.id}`, { method: 'DELETE' });
        if (res.unauthorized) { ctx.navigate('/login'); return; }
        if (!res.ok) { toast(api.errorMessage(res, 'That post could not be deleted.'), 'err'); return; }
        toast('Post deleted.', 'ok');
        await load();
      });
      actions.appendChild(deleteBtn);
    }

    const targets = post.targets || [];
    const targetHost = targets.length
      ? el('div', { className: 'stack', attrs: { style: 'gap:.3rem;margin-top:.4rem' } }, targets.map((t) => targetRow(post, t)))
      : el('p', { className: 'card-sub', text: 'No accounts selected' });

    return card([
      el('div', { className: 'list-item' }, [
        thumbnail(post),
        el('div', { attrs: { style: 'min-width:0;flex:1' } }, [
          el('div', { className: 'row', attrs: { style: 'gap:.5rem' } }, [
            el('span', { className: 'card-title', text: post.title || 'Untitled post' }),
            statusChip(post.status),
          ]),
          el('p', { className: 'card-sub', text: post.scheduledAtUtc
            ? `Scheduled ${formatDate(post.scheduledAtUtc)}${post.originalTimezone ? ` · ${post.originalTimezone}` : ''}`
            : `Updated ${formatDate(post.updatedAt)}` }),
          targetHost,
        ]),
        el('span', { className: 'spacer' }),
        actions,
      ]),
    ]);
  }

  function renderTabs() {
    tabs.textContent = '';
    for (const [value, label] of FILTERS) {
      const count = value === 'all' ? posts.length : posts.filter((p) => p.status === value).length;
      const btn = el('button', { className: 'tab', text: `${label} (${count})`, attrs: { type: 'button', role: 'tab', 'aria-selected': filter === value ? 'true' : 'false' } });
      btn.addEventListener('click', () => { filter = value; renderTabs(); renderList(); });
      tabs.appendChild(btn);
    }
  }

  async function load() {
    const [res, caps] = await Promise.all([
      api.apiRequest('/api/posts?limit=100'),
      api.apiRequest('/api/posts/capabilities'),
    ]);
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    posts = api.payload(res)?.posts || [];
    liveEnabled = Boolean(api.payload(caps)?.publishing?.liveEnabled);
    renderTabs();
    renderList();
    renderNotice();
  }

  const noticeHost = el('div', {});
  function renderNotice() {
    noticeHost.textContent = '';
    noticeHost.appendChild(liveEnabled
      ? notice('Live publishing is enabled. Each account publishes independently; a failed target can be retried on its own.', 'info')
      : notice('Live publishing is turned off. Posts are prepared and queued but nothing is sent to Facebook, Instagram, or Threads yet.', 'warn'));
  }

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Queue', 'Every post you have drafted, queued, or published, with per-account status.', [
      el('a', { className: 'btn btn-primary', text: 'Create post', attrs: { href: '/create', 'data-link': '' } }),
    ]),
    tabs,
    listHost,
    noticeHost,
  ]));

  await load();
}
