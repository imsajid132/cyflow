/**
 * Planner dashboard — the primary workflow's front door.
 *
 * Shows the current plan (if any), what the planner is set up to do, and the
 * one action that matters: generate the next stretch of content.
 */

import * as api from '../api.js';
import { el, card, pageHead, badge, notice, emptyState, formatDate } from '../ui.js';
import { platformNames } from '../icons.js';
import { statusChip } from '../components/plannerCard.js';
import { deletePlanButton } from '../components/deletePlan.js';

const CADENCE_LABELS = {
  every_day: 'Every day',
  weekdays: 'Weekdays only',
  selected_weekdays: 'Selected weekdays',
  custom: 'Custom schedule',
};

function statCard(value, label) {
  return card([el('div', { className: 'stat' }, [
    el('span', { className: 'stat-value', text: String(value) }),
    el('span', { className: 'stat-label', text: label }),
  ])]);
}

export async function render(root, ctx) {
  const [prefs, plans, profile, accountsRes] = await Promise.all([
    api.plannerPreferences(),
    api.plannerPlans({ limit: 5 }),
    api.businessProfile(),
    api.apiRequest('/api/social-accounts'),
  ]);
  if (accountsRes.unauthorized) { ctx.navigate('/login'); return; }

  const accounts = (api.payload(accountsRes)?.accounts || []).filter((a) => a.status === 'active');
  const latest = plans[0] || null;

  const page = el('div', { className: 'page' }, [
    pageHead('Auto planner', 'Generate a week of branded posts, review them, then queue the ones you like.', [
      el('a', { className: 'btn btn-secondary', text: 'Plan history', attrs: { href: '/planner/history', 'data-link': '' } }),
      el('a', { className: 'btn btn-primary', text: 'Generate a plan', attrs: { href: '/planner/new', 'data-link': '' } }),
    ]),
  ]);

  // Setup blockers come first — there is no point offering generation the
  // server will refuse.
  if (accounts.length === 0) {
    page.appendChild(el('div', { className: 'notice notice-warn' }, [
      el('div', {}, [
        el('strong', { text: 'Connect an account first' }),
        el('p', { text: 'The planner writes for the platforms you have connected. Connect a Facebook Page, Instagram Professional account, or Threads profile to get started.' }),
      ]),
      el('span', { className: 'spacer' }),
      el('a', { className: 'btn btn-primary btn-sm', text: 'Connect', attrs: { href: '/connections', 'data-link': '' } }),
    ]));
  }
  if (!profile?.businessName) {
    page.appendChild(el('div', { className: 'notice notice-info' }, [
      el('div', {}, [
        el('strong', { text: 'Add your business details' }),
        el('p', { text: 'Plans are written from your business profile. Without it the posts will be generic.' }),
      ]),
      el('span', { className: 'spacer' }),
      el('a', { className: 'btn btn-secondary btn-sm', text: 'Open Brand', attrs: { href: '/brand', 'data-link': '' } }),
    ]));
  }

  // The current plan.
  if (latest) {
    const counts = latest.counts || {};
    page.appendChild(card([
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: latest.name || 'Latest plan' }),
        statusChip(latest.status),
      ]),
      el('p', { className: 'card-sub', text: `${latest.startDate} to ${latest.endDate} · ${latest.timezone || 'UTC'}` }),
      el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap;margin-top:.6rem' } },
        Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([status, n]) => el('span', { className: 'row', attrs: { style: 'gap:.3rem' } }, [
            statusChip(status),
            el('span', { className: 'card-sub', text: String(n) }),
          ]))),
      el('div', { className: 'row', attrs: { style: 'gap:.5rem;margin-top:.8rem' } }, [
        el('a', {
          className: 'btn btn-primary btn-sm',
          text: 'Review this plan',
          attrs: { href: `/planner/week?run=${encodeURIComponent(latest.id)}`, 'data-link': '' },
        }),
        el('span', { className: 'spacer' }),
        deletePlanButton(latest.id, {
          name: latest.name || 'this plan',
          // The dashboard reloads so the card reflects the new state.
          onDone: () => ctx.navigate('/planner'),
        }),
      ]),
    ]));
  } else {
    page.appendChild(card([
      emptyState({
        title: 'No plans yet',
        subtitle: 'Generate your first week of content. You review everything before anything is queued.',
        action: el('a', { className: 'btn btn-primary', text: 'Generate a plan', attrs: { href: '/planner/new', 'data-link': '' } }),
      }),
    ]));
  }

  page.appendChild(el('div', { className: 'grid grid-4' }, [
    statCard(plans.length, 'Plans created'),
    statCard(accounts.length, 'Connected accounts'),
    statCard(prefs?.defaultPlanLength ?? 7, 'Default plan length'),
    statCard(profile?.services?.length || 0, 'Services'),
  ]));

  // What the planner will do next time.
  page.appendChild(card([
    el('div', { className: 'card-head' }, [
      el('span', { className: 'card-title', text: 'Your planner settings' }),
      el('a', { className: 'btn btn-ghost btn-sm', text: 'Change', attrs: { href: '/settings', 'data-link': '' } }),
    ]),
    prefs?.isDefault
      ? el('p', { className: 'hint', text: 'Using the default settings. Adjust them in Settings, or override them each time you generate.' })
      : null,
    el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap' } }, [
      badge(CADENCE_LABELS[prefs?.cadence] || 'Every day', 'neutral'),
      badge(`Times: ${(prefs?.times || ['09:00']).join(', ')}`, 'neutral'),
      badge(prefs?.approvalMode === 'auto_queue' ? 'Auto-queue' : 'Approval required', 'info'),
      badge(`Tone: ${prefs?.tone || 'professional'}`, 'neutral'),
      /*
       * Saved platform defaults are PLATFORM ids, so they need the platform map.
       *
       * The empty case no longer claims "All connected platforms" either: that
       * was the old fallback describing itself, and it is exactly the promise
       * that put Facebook posts in plans nobody asked for. With nothing saved,
       * the wizard now starts with nothing ticked.
       */
      ...(prefs?.platforms?.length
        ? platformNames(prefs.platforms).map((name) => badge(name, 'neutral'))
        : [badge('Chosen per plan', 'neutral')]),
    ]),
    prefs?.autopilotEnabled
      ? el('p', { className: 'hint', attrs: { style: 'margin-top:.6rem' },
          text: `Autopilot is on. The next plan is due ${formatDate(prefs.nextPlanGenerationAt)}, but automatic generation is not running yet — generate manually for now.` })
      : null,
  ]));

  page.appendChild(notice('The planner writes and schedules posts. Cyflow does not publish to Facebook, Instagram, or Threads yet — approved posts wait in the queue for a later phase.', 'info'));

  root.appendChild(page);
}
