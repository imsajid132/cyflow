/**
 * Dashboard — what needs you, and what happens next.
 *
 * Every number here is read from a real API. There are no charts, no reach or
 * engagement figures, no invented trends: if there is nothing real to show, the
 * card explains the empty state instead. The publishing lines say exactly what
 * is true right now, including when live publishing is turned off.
 */

import * as api from '../api.js';
import { el, card, pageHead, notice, emptyState, formatDate, statusChip } from '../ui.js';
import { PROVIDER_LABELS, PLATFORM_LABELS } from '../icons.js';

/** A compact "label + value" figure. Values are real or an honest dash. */
function figure(value, label, href = null, sub = null) {
  const body = el('div', { className: 'stat' }, [
    el('span', { className: 'stat-value', text: value === null || value === undefined ? '—' : String(value) }),
    el('span', { className: 'stat-label', text: label }),
    sub ? el('span', { className: 'hint', text: sub }) : null,
  ]);
  return href
    ? el('a', { className: 'card card-hover dash-figure', attrs: { href, 'data-link': '' } }, [body])
    : card([body], 'dash-figure');
}

/** One row in the attention list: what is wrong, and where to fix it. */
function attentionRow(text, actionLabel, href) {
  return el('li', { className: 'attn-item' }, [
    el('span', { className: 'attn-dot', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'attn-text', text }),
    el('a', { className: 'btn btn-secondary btn-sm', text: actionLabel, attrs: { href, 'data-link': '' } }),
  ]);
}

/** The local wall-clock a post is due, preferring the exact saved intent. */
function localWhen(post) {
  if (post.scheduledLocalDate && post.scheduledLocalTime) {
    return `${post.scheduledLocalDate} at ${String(post.scheduledLocalTime).slice(0, 5)}${post.originalTimezone ? ` (${post.originalTimezone})` : ''}`;
  }
  if (post.scheduledAtUtc) {
    return `${formatDate(post.scheduledAtUtc)}${post.originalTimezone ? ` (${post.originalTimezone})` : ''}`;
  }
  return 'Not scheduled';
}

export async function render(root, ctx) {
  /*
   * Deliberately does NOT call /health. That endpoint is an operations probe
   * that legitimately answers 503 when the database is unreachable, so a
   * user-facing page hanging off it would log a console error every time the
   * system was degraded — exactly when the page needs to stay calm. Everything
   * shown below comes from endpoints that answer 200 for a signed-in user.
   */
  const [state, profile, postsRes, accountsRes, automationsRes, capsRes] = await Promise.all([
    api.onboardingState(),
    api.businessProfile(),
    api.apiRequest('/api/posts?limit=100'),
    api.apiRequest('/api/social-accounts'),
    api.apiRequest('/api/automations'),
    api.apiRequest('/api/posts/capabilities'),
  ]);
  if (postsRes.unauthorized || accountsRes.unauthorized) { ctx.navigate('/login'); return; }

  const posts = api.payload(postsRes)?.posts || [];
  const accounts = api.payload(accountsRes)?.accounts || [];
  const automations = api.payload(automationsRes)?.automations || [];
  const caps = api.payload(capsRes) || {};

  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const staleAccounts = accounts.filter((a) => a.status !== 'active');
  const drafts = posts.filter((p) => p.status === 'draft');
  const scheduled = posts.filter((p) => p.scheduledAtUtc && ['queued', 'processing', 'retrying'].includes(p.status));
  const activeAutomations = automations.filter((a) => a.status === 'active');
  const attentionAutomations = automations.filter((a) => a.status === 'attention_needed');

  // Targets that stalled or failed. One account failing is never a success.
  const troubledTargets = posts.flatMap((p) => (p.targets || [])
    .filter((t) => ['attention_needed', 'failed'].includes(t.publishStatus))
    .map((t) => ({ post: p, target: t })));

  const liveEnabled = Boolean(caps.publishing?.liveEnabled);
  const openaiReady = Boolean(caps.openai?.available);
  const hctiReady = Boolean(caps.hcti?.verified);

  const minBuffer = activeAutomations.length
    ? Math.min(...activeAutomations.map((a) => a.readyBufferDays ?? 0)) : null;

  const nextPost = scheduled
    .slice()
    .sort((a, b) => String(a.scheduledAtUtc).localeCompare(String(b.scheduledAtUtc)))[0] || null;

  const page = el('div', { className: 'page' }, [
    pageHead(
      `Welcome back, ${ctx.user?.name || 'there'}`,
      profile?.businessName || 'Your workspace at a glance',
      [el('a', { className: 'btn btn-primary', text: 'Create post', attrs: { href: '/create', 'data-link': '' } })],
    ),
  ]);

  if (state?.needsOnboarding) {
    page.appendChild(el('div', { className: 'notice notice-info' }, [
      el('div', {}, [
        el('strong', { text: 'Finish your business setup' }),
        el('p', { text: 'Add your business details so your post copy and images match your brand.' }),
      ]),
      el('span', { className: 'spacer' }),
      el('a', { className: 'btn btn-primary btn-sm', text: 'Finish setup', attrs: { href: '/onboarding/business', 'data-link': '' } }),
    ]));
  }

  // --- what needs you ------------------------------------------------------
  const attention = [];
  if (!activeAccounts.length) {
    attention.push(attentionRow('No accounts are connected, so nothing can be published yet.', 'Connect', '/connections'));
  }
  if (staleAccounts.length) {
    attention.push(attentionRow(`${staleAccounts.length} account${staleAccounts.length === 1 ? '' : 's'} need reconnecting.`, 'Reconnect', '/connections'));
  }
  if (troubledTargets.length) {
    const one = troubledTargets.length === 1;
    attention.push(attentionRow(
      `${troubledTargets.length} post${one ? '' : 's'} did not go out and ${one ? 'needs' : 'need'} a look.`,
      'Open queue', '/queue'));
  }
  for (const a of attentionAutomations) {
    attention.push(attentionRow(a.attentionReason || `"${a.name}" has paused and needs attention.`, 'Review', '/automations'));
  }
  if (minBuffer !== null && minBuffer <= 3) {
    attention.push(attentionRow(`Your prepared content runs out in ${minBuffer} day${minBuffer === 1 ? '' : 's'}.`, 'Top up', '/automations'));
  }

  page.appendChild(card([
    el('div', { className: 'card-head' }, [el('h2', { className: 'card-title', text: 'Needs your attention' })]),
    attention.length
      ? el('ul', { className: 'attn-list' }, attention)
      : el('p', { className: 'dash-allclear', text: 'Nothing needs you right now. Everything we can check looks healthy.' }),
  ]));

  // --- the numbers that lead somewhere -------------------------------------
  page.appendChild(el('div', { className: 'grid grid-4' }, [
    figure(scheduled.length, 'Scheduled posts', '/queue'),
    figure(drafts.length, 'Drafts', '/create'),
    figure(activeAccounts.length, 'Connected accounts', '/connections'),
    figure(minBuffer === null ? null : minBuffer, 'Days of content ready', '/automations',
      minBuffer === null ? 'No active automation' : null),
  ]));

  // --- what happens next ---------------------------------------------------
  const upcoming = scheduled
    .slice()
    .sort((a, b) => String(a.scheduledAtUtc).localeCompare(String(b.scheduledAtUtc)))
    .slice(0, 5);
  page.appendChild(card([
    el('div', { className: 'card-head' }, [
      el('h2', { className: 'card-title', text: 'What happens next' }),
      el('a', { className: 'btn btn-ghost btn-sm', text: 'Open queue', attrs: { href: '/queue', 'data-link': '' } }),
    ]),
    upcoming.length
      ? el('ul', { className: 'lane' }, upcoming.map((p) => el('li', { className: 'lane-row' }, [
        statusChip(p.status),
        el('span', { className: 'lane-title', text: p.title || 'Untitled post' }),
        el('span', { className: 'lane-meta', text: (p.platformTargets || []).map((x) => PLATFORM_LABELS[x] || x).join(', ') }),
        el('span', { className: 'spacer' }),
        el('span', { className: 'lane-when', text: localWhen(p) }),
      ])))
      : emptyState({
        title: 'Nothing is scheduled',
        subtitle: 'Write a post and schedule it, or let an automation prepare a week for you.',
        action: el('a', { className: 'btn btn-primary btn-sm', text: 'Create post', attrs: { href: '/create', 'data-link': '' } }),
      }),
  ]));

  // --- setup + publishing readiness ---------------------------------------
  const readyRow = (label, ok, okText, offText, href, action) => el('li', { className: 'lane-row' }, [
    statusChip(ok ? 'published' : 'draft', ok ? okText : offText),
    el('span', { className: 'lane-title', text: label }),
    el('span', { className: 'spacer' }),
    el('a', { className: 'btn btn-ghost btn-sm', text: action, attrs: { href, 'data-link': '' } }),
  ]);

  page.appendChild(card([
    el('div', { className: 'card-head' }, [el('h2', { className: 'card-title', text: 'Your setup' })]),
    el('ul', { className: 'lane' }, [
      readyRow('Connected accounts', activeAccounts.length > 0,
        `${activeAccounts.length} connected`, 'None connected', '/connections', 'Manage'),
      // Named by what they let the user do, not by the vendor behind them. The
      // vendor names belong on /integrations, where the keys are entered.
      readyRow('AI writing help', openaiReady, 'Ready', 'Not set up', '/integrations', 'Set up'),
      readyRow('Branded image rendering', hctiReady, 'Ready', 'Not set up', '/integrations', 'Set up'),
    ]),
    liveEnabled
      ? notice('Live publishing is on. Scheduled posts are sent to your connected accounts in the background.', 'info')
      : notice('Live publishing is turned off, so nothing is sent to your accounts yet. You can still write, schedule and review everything.', 'info'),
  ]));

  // --- recent activity -----------------------------------------------------
  const recent = posts.slice(0, 5);
  page.appendChild(card([
    el('div', { className: 'card-head' }, [el('h2', { className: 'card-title', text: 'Recent activity' })]),
    recent.length
      ? el('ul', { className: 'lane' }, recent.map((p) => el('li', { className: 'lane-row' }, [
        statusChip(p.status),
        el('span', { className: 'lane-title', text: p.title || 'Untitled post' }),
        el('span', { className: 'spacer' }),
        el('span', { className: 'lane-when', text: `Updated ${formatDate(p.updatedAt)}` }),
      ])))
      : el('p', { className: 'hint', text: 'Your posts will appear here once you create one.' }),
  ]));

  root.appendChild(page);
}
