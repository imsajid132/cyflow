/**
 * A read-only revision timeline for one planner item.
 *
 * Loads lazily from GET /api/planner/items/:id/revisions and shows what each
 * platform's copy said at each state change. Read-only in C2: restoring an old
 * version is deliberately out of scope, because doing it safely (which revision,
 * which platform, re-validate, re-mark edited) is its own feature and a
 * half-built restore is worse than none.
 *
 * Never renders a prompt or a secret — the API does not return any, and every
 * value goes in through textContent regardless.
 */

import { el, badge } from '../ui.js';
import { platformMark, PLATFORM_LABELS } from '../icons.js';

const TYPE_LABEL = Object.freeze({
  generated: 'Generated',
  retry: 'Retried',
  manual_edit: 'Manually edited',
  approved: 'Approved',
  queued: 'Queued',
});
const TYPE_TONE = Object.freeze({
  generated: 'neutral', retry: 'info', manual_edit: 'info', approved: 'ok', queued: 'ok',
});

function when(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).replace(' ', 'T')}${String(iso).includes('T') ? '' : 'Z'}`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function entry(rev) {
  const label = PLATFORM_LABELS[rev.platform] ?? rev.platform;
  const details = el('details', { className: 'rev-entry' }, [
    el('summary', {}, [
      platformMark(rev.platform, { label, size: 16 }),
      el('span', { className: 'rev-type', text: TYPE_LABEL[rev.revisionType] ?? rev.revisionType }),
      badge(label, TYPE_TONE[rev.revisionType] ?? 'neutral'),
      rev.validationStatus === 'failed' ? badge('was failing', 'warn') : null,
      el('span', { className: 'rev-when', text: when(rev.createdAt) }),
    ]),
    el('p', { className: 'rev-copy', text: rev.postCopy || '(no copy)' }),
    Array.isArray(rev.hashtags) && rev.hashtags.length
      ? el('p', { className: 'rev-tags', text: rev.hashtags.join(' ') })
      : null,
  ]);
  return el('li', {}, [details]);
}

/**
 * @param {string} itemId
 * @param {{ apiRequest, payload }} api
 * @returns {HTMLElement} a <section> that fills itself in when opened
 */
export function revisionTimeline(itemId, api) {
  const host = el('div', { className: 'rev-list' }, [
    el('p', { className: 'card-sub', text: 'Loading history…' }),
  ]);

  const section = el('details', { className: 'rev-timeline' }, [
    el('summary', { text: 'Revision history' }),
    host,
  ]);

  let loaded = false;
  section.addEventListener('toggle', async () => {
    if (!section.open || loaded) return;
    loaded = true;
    const res = await api.apiRequest(`/api/planner/items/${encodeURIComponent(itemId)}/revisions`);
    host.textContent = '';
    if (!res.ok) {
      host.appendChild(el('p', { className: 'card-sub', text: 'History could not be loaded.' }));
      loaded = false; // let a reopen retry
      return;
    }
    const revisions = api.payload(res)?.revisions ?? [];
    if (!revisions.length) {
      host.appendChild(el('p', { className: 'card-sub', text: 'No history yet.' }));
      return;
    }
    host.appendChild(el('ul', { className: 'rev-entries' }, revisions.map(entry)));
  });

  return section;
}

export default { revisionTimeline };
