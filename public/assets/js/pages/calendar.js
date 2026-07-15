/**
 * Calendar — a month view of scheduled posts.
 *
 * Every cell is built from real posts. Days with nothing scheduled stay empty;
 * no placeholder or sample content is ever drawn.
 */

import * as api from '../api.js';
import { el, card, pageHead, badge, statusTone, notice, emptyState, formatDate } from '../ui.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** Parse a MySQL UTC datetime into a local Date. */
function toLocalDate(value) {
  if (!value) return null;
  const s = String(value);
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function render(root, ctx) {
  const res = await api.apiRequest('/api/posts?limit=100');
  if (res.unauthorized) { ctx.navigate('/login'); return; }
  const posts = (api.payload(res)?.posts || []).filter((p) => p.scheduledAtUtc && p.status !== 'cancelled');

  // Group scheduled posts by local calendar day.
  const byDay = new Map();
  for (const post of posts) {
    const d = toLocalDate(post.scheduledAtUtc);
    if (!d) continue;
    const key = dayKey(d);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({ post, date: d });
  }

  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth();

  const gridHost = el('div', {});
  const label = el('h2', { className: 'card-title' });

  function renderMonth() {
    label.textContent = `${MONTHS[month]} ${year}`;
    gridHost.textContent = '';

    const grid = el('div', { className: 'cal-grid' });
    for (const name of DAY_NAMES) {
      grid.appendChild(el('div', { className: 'cal-head', text: name }));
    }

    const first = new Date(year, month, 1);
    // Monday-first offset.
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < offset; i++) {
      grid.appendChild(el('div', { className: 'cal-day', attrs: { 'data-outside': 'true', 'aria-hidden': 'true' } }));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const entries = byDay.get(dayKey(date)) || [];
      const cell = el('div', {
        className: 'cal-day',
        attrs: {
          'data-today': dayKey(date) === dayKey(today) ? 'true' : null,
          role: 'group',
          'aria-label': `${day} ${MONTHS[month]}: ${entries.length} scheduled`,
        },
      }, [
        el('span', { className: 'cal-daynum', text: String(day) }),
      ]);
      for (const { post, date: at } of entries.slice(0, 3)) {
        cell.appendChild(el('span', {
          className: `cal-pill cal-pill-${post.status === 'queued' ? 'queued' : 'draft'}`,
          text: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} ${post.title || '(untitled)'}`,
          attrs: { title: post.title || '(untitled)' },
        }));
      }
      if (entries.length > 3) {
        cell.appendChild(el('span', { className: 'cal-daynum', text: `+${entries.length - 3} more` }));
      }
      grid.appendChild(cell);
    }
    gridHost.appendChild(grid);
  }

  const prev = el('button', { className: 'btn btn-secondary btn-sm', text: '‹ Previous', attrs: { type: 'button' } });
  const next = el('button', { className: 'btn btn-secondary btn-sm', text: 'Next ›', attrs: { type: 'button' } });
  prev.addEventListener('click', () => {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
    renderMonth();
  });
  next.addEventListener('click', () => {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    renderMonth();
  });

  // A chronological list beside the grid — the accessible, scannable view.
  const upcoming = posts
    .map((p) => ({ p, d: toLocalDate(p.scheduledAtUtc) }))
    .filter((x) => x.d && x.d.getTime() >= Date.now())
    .sort((a, b) => a.d - b.d)
    .slice(0, 10);

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Calendar', 'When your scheduled posts are due, in your local time.', [
      el('a', { className: 'btn btn-primary', text: 'Create post', attrs: { href: '/create', 'data-link': '' } }),
    ]),
    card([
      el('div', { className: 'card-head' }, [
        label,
        el('div', { className: 'row', attrs: { style: 'gap:.4rem' } }, [prev, next]),
      ]),
      gridHost,
    ]),
    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Upcoming' })]),
      upcoming.length
        ? el('div', { className: 'stack', attrs: { style: 'gap:.5rem' } }, upcoming.map(({ p }) =>
            el('div', { className: 'row' }, [
              badge(p.status, statusTone(p.status)),
              el('span', { text: p.title || '(untitled)', attrs: { style: 'font-weight:600' } }),
              el('span', { className: 'spacer' }),
              el('span', { className: 'card-sub', text: formatDate(p.scheduledAtUtc) }),
            ]),
          ))
        : emptyState({
            title: 'Nothing scheduled',
            subtitle: 'Schedule a post and it will appear on this calendar.',
            action: el('a', { className: 'btn btn-primary btn-sm', text: 'Create post', attrs: { href: '/create', 'data-link': '' } }),
          }),
    ]),
    notice('The calendar shows when posts are due. Automatic publishing arrives in a later phase.', 'info'),
  ]));

  renderMonth();
}
