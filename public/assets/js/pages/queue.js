/**
 * Queue — every post the user owns, filterable by status.
 *
 * Only real server state is shown. There is no publishing progress to display,
 * because Cyflow does not publish yet; queued means "saved for a future phase".
 */

import * as api from '../api.js';
import { el, card, pageHead, badge, statusTone, notice, emptyState, toast, formatDate, confirmModal } from '../ui.js';
import { PROVIDER_LABELS } from '../icons.js';

const FILTERS = [
  ['all', 'All'],
  ['draft', 'Drafts'],
  ['queued', 'Queued'],
  ['cancelled', 'Cancelled'],
  ['failed', 'Failed'],
];

function targetSummary(post) {
  const targets = post.targets || [];
  if (!targets.length) return 'No accounts selected';
  const names = targets.map((t) => t.displayName || t.username || PROVIDER_LABELS[t.provider] || 'Account');
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
}

export async function render(root, ctx) {
  let posts = [];
  let filter = 'all';

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

  function row(post) {
    const actions = el('div', { className: 'row', attrs: { style: 'gap:.4rem' } });
    if (['draft', 'queued', 'retrying', 'processing'].includes(post.status)) {
      const cancelBtn = el('button', { className: 'btn btn-secondary btn-sm', text: 'Cancel', attrs: { type: 'button' } });
      cancelBtn.addEventListener('click', async () => {
        const ok = await confirmModal({
          title: 'Cancel this post?',
          message: 'It will not be scheduled. You can still edit it as a draft.',
          confirmText: 'Cancel post',
          danger: true,
        });
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
        const ok = await confirmModal({
          title: 'Delete this post?',
          message: 'This permanently removes the draft and its generated content.',
          confirmText: 'Delete',
          danger: true,
        });
        if (!ok) return;
        const res = await api.apiRequest(`/api/posts/${post.id}`, { method: 'DELETE' });
        if (res.unauthorized) { ctx.navigate('/login'); return; }
        if (!res.ok) { toast(api.errorMessage(res, 'That post could not be deleted.'), 'err'); return; }
        toast('Post deleted.', 'ok');
        await load();
      });
      actions.appendChild(deleteBtn);
    }

    return card([
      el('div', { className: 'list-item' }, [
        post.media?.publicToken
          ? el('img', {
              className: 'thumb',
              attrs: { src: `/media/${encodeURIComponent(post.media.publicToken)}`, alt: '', loading: 'lazy' },
            })
          : el('div', { className: 'thumb thumb-empty', attrs: { 'aria-hidden': 'true' } }),
        el('div', { attrs: { style: 'min-width:0' } }, [
          el('div', { className: 'row', attrs: { style: 'gap:.5rem' } }, [
            el('span', { className: 'card-title', text: post.title || '(untitled)' }),
            badge(post.status, statusTone(post.status)),
          ]),
          el('p', { className: 'card-sub', text: targetSummary(post) }),
          el('p', { className: 'card-sub', text: post.scheduledAtUtc
            ? `Scheduled ${formatDate(post.scheduledAtUtc)}${post.originalTimezone ? ` · ${post.originalTimezone}` : ''}`
            : `Updated ${formatDate(post.updatedAt)}` }),
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
      const btn = el('button', {
        className: 'tab',
        text: `${label} (${count})`,
        attrs: { type: 'button', role: 'tab', 'aria-selected': filter === value ? 'true' : 'false' },
      });
      btn.addEventListener('click', () => { filter = value; renderTabs(); renderList(); });
      tabs.appendChild(btn);
    }
  }

  async function load() {
    const res = await api.apiRequest('/api/posts?limit=100');
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    posts = api.payload(res)?.posts || [];
    renderTabs();
    renderList();
  }

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Queue', 'Everything you have drafted, queued, or cancelled.', [
      el('a', { className: 'btn btn-primary', text: 'Create post', attrs: { href: '/create', 'data-link': '' } }),
    ]),
    tabs,
    listHost,
    notice('Queued posts are stored for a future publishing phase. Cyflow does not post to providers yet.', 'info'),
  ]));

  await load();
}
