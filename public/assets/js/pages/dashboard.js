/**
 * Dashboard — a focused overview, not a settings dump.
 *
 * Shows only real data: business identity, setup completeness, connected
 * account summary, draft/queued counts, next scheduled posts, and recent
 * activity. No charts, no invented statistics, no publishing progress.
 */

import * as api from '../api.js';
import { el, card, pageHead, badge, statusTone, notice, emptyState, formatDate } from '../ui.js';
import { PROVIDER_LABELS } from '../icons.js';

function statCard(value, label) {
  return card([el('div', { className: 'stat' }, [
    el('span', { className: 'stat-value', text: String(value) }),
    el('span', { className: 'stat-label', text: label }),
  ])]);
}

export async function render(root, ctx) {
  const [state, profile, postsRes, accountsRes] = await Promise.all([
    api.onboardingState(),
    api.businessProfile(),
    api.apiRequest('/api/posts?limit=50'),
    api.apiRequest('/api/social-accounts'),
  ]);
  if (postsRes.unauthorized || accountsRes.unauthorized) { ctx.navigate('/login'); return; }

  const posts = api.payload(postsRes)?.posts || [];
  const accounts = api.payload(accountsRes)?.accounts || [];
  const drafts = posts.filter((p) => p.status === 'draft');
  const queued = posts.filter((p) => p.status === 'queued');
  const activeAccounts = accounts.filter((a) => a.status === 'active');

  const businessName = profile?.businessName || null;
  const greeting = `Welcome back, ${ctx.user?.name || 'there'}`;

  const page = el('div', { className: 'page' }, [
    pageHead(greeting, businessName ? businessName : 'Your workspace overview', [
      el('a', { className: 'btn btn-secondary', text: 'Connect account', attrs: { href: '/connections', 'data-link': '' } }),
      el('a', { className: 'btn btn-primary', text: 'Create post', attrs: { href: '/create', 'data-link': '' } }),
    ]),
  ]);

  // Business setup prompt — existing users are never blocked, just prompted.
  if (state?.needsOnboarding) {
    const alert = el('div', { className: 'notice notice-info' }, [
      el('div', {}, [
        el('strong', { text: 'Complete your business setup' }),
        el('p', { text: 'Add your business details so captions and images match your brand. It takes about a minute.' }),
      ]),
      el('span', { className: 'spacer' }),
      el('a', { className: 'btn btn-primary btn-sm', text: 'Complete setup', attrs: { href: '/onboarding/business', 'data-link': '' } }),
    ]);
    page.appendChild(alert);
  }

  // Business identity summary (only when there is something real to show).
  if (profile && (profile.businessName || profile.logoUrl)) {
    page.appendChild(card([
      el('div', { className: 'row', attrs: { style: 'gap:.9rem' } }, [
        profile.logoUrl
          ? el('img', { attrs: { src: profile.logoUrl, alt: '', width: 44, height: 44, style: 'object-fit:contain;border-radius:8px;background:#fff' } })
          : null,
        el('div', {}, [
          el('div', { className: 'card-title', text: profile.businessName || 'Your business' }),
          el('div', { className: 'card-sub', text: profile.businessCategory || profile.websiteUrl || '' }),
        ]),
        el('span', { className: 'spacer' }),
        el('a', { className: 'btn btn-secondary btn-sm', text: 'Edit brand', attrs: { href: '/brand', 'data-link': '' } }),
      ]),
    ]));
  }

  page.appendChild(el('div', { className: 'grid grid-4' }, [
    statCard(drafts.length, 'Drafts'),
    statCard(queued.length, 'Queued posts'),
    statCard(activeAccounts.length, 'Connected accounts'),
    statCard(profile?.services?.length || 0, 'Services'),
  ]));

  // Connected accounts summary (a compact roll-up, never the full list).
  const byProvider = ['meta', 'instagram', 'threads'].map((p) => ({
    provider: p,
    count: activeAccounts.filter((a) => a.provider === p).length,
  }));
  page.appendChild(card([
    el('div', { className: 'card-head' }, [
      el('span', { className: 'card-title', text: 'Connected accounts' }),
      el('a', { className: 'btn btn-ghost btn-sm', text: 'Manage', attrs: { href: '/connections', 'data-link': '' } }),
    ]),
    activeAccounts.length
      ? el('div', { className: 'row', attrs: { style: 'gap:.5rem' } },
          byProvider.map((b) => badge(`${PROVIDER_LABELS[b.provider]}: ${b.count}`, b.count ? 'ok' : 'neutral')))
      : emptyState({
          title: 'No accounts connected',
          subtitle: 'Connect a Facebook Page, Instagram Professional account, or Threads profile to start scheduling.',
          action: el('a', { className: 'btn btn-primary btn-sm', text: 'Connect an account', attrs: { href: '/connections', 'data-link': '' } }),
        }),
  ]));

  // Next scheduled posts (real rows only).
  const upcoming = queued
    .filter((p) => p.scheduledAtUtc)
    .sort((a, b) => String(a.scheduledAtUtc).localeCompare(String(b.scheduledAtUtc)))
    .slice(0, 5);
  page.appendChild(card([
    el('div', { className: 'card-head' }, [
      el('span', { className: 'card-title', text: 'Next scheduled posts' }),
      el('a', { className: 'btn btn-ghost btn-sm', text: 'View queue', attrs: { href: '/queue', 'data-link': '' } }),
    ]),
    upcoming.length
      ? el('div', { className: 'stack', attrs: { style: 'gap:.5rem' } }, upcoming.map((p) =>
          el('div', { className: 'row' }, [
            badge(p.status, statusTone(p.status)),
            el('span', { text: p.title || '(untitled)', attrs: { style: 'font-weight:600' } }),
            el('span', { className: 'spacer' }),
            el('span', { className: 'card-sub', text: `${formatDate(p.scheduledAtUtc)}${p.originalTimezone ? ` · ${p.originalTimezone}` : ''}` }),
          ]),
        ))
      : emptyState({ title: 'Nothing scheduled yet', subtitle: 'Create a post and schedule it — publishing to providers arrives in a later phase.' }),
  ]));

  // Recent activity = the user's most recent real posts.
  const recent = posts.slice(0, 5);
  page.appendChild(card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Recent activity' })]),
    recent.length
      ? el('div', { className: 'stack', attrs: { style: 'gap:.5rem' } }, recent.map((p) =>
          el('div', { className: 'row' }, [
            badge(p.status, statusTone(p.status)),
            el('span', { text: p.title || '(untitled)' }),
            el('span', { className: 'spacer' }),
            el('span', { className: 'card-sub', text: `Updated ${formatDate(p.updatedAt)}` }),
          ]),
        ))
      : el('p', { className: 'hint', text: 'No activity yet.' }),
  ]));

  page.appendChild(notice('Scheduled posts are saved for a future publishing phase — Cyflow does not publish to providers yet.', 'info'));

  root.appendChild(page);
}
