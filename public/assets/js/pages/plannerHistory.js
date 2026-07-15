/**
 * Plan history — every plan this user has generated.
 */

import * as api from '../api.js';
import { el, card, pageHead, badge, notice, emptyState, formatDate } from '../ui.js';
import { statusChip } from '../components/plannerCard.js';
import { deletePlanButton } from '../components/deletePlan.js';

const RUN_STATUS_TONE = {
  queued: 'ok',
  partially_queued: 'warn',
  review: 'warn',
  generating: 'neutral',
  archived: 'neutral',
  failed: 'err',
};

export async function render(root, ctx) {
  const listHost = el('div', { className: 'stack' });

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Plan history', 'Every plan you have generated.', [
      el('a', { className: 'btn btn-primary', text: 'New plan', attrs: { href: '/planner/new', 'data-link': '' } }),
    ]),
    listHost,
    notice('A plan with published posts is archived rather than deleted, so its history is kept. Queued posts are never removed without asking you first.', 'info'),
  ]));

  async function load() {
    const plans = await api.plannerPlans({ limit: 50 });
    listHost.textContent = '';

    if (!plans.length) {
      listHost.appendChild(card([emptyState({
        title: 'No plans yet',
        subtitle: 'Generate your first week of content.',
        action: el('a', { className: 'btn btn-primary btn-sm', text: 'Generate a plan', attrs: { href: '/planner/new', 'data-link': '' } }),
      })]));
      return;
    }

    for (const plan of plans) {
      const counts = plan.counts || {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);

      // The flow reads the real impact first: a plan with published history is
      // archived, and queued posts require an explicit decision.
      const deleteBtn = deletePlanButton(plan.id, {
        name: plan.name || `Plan ${plan.id}`,
        label: 'Delete',
        onDone: load,
      });

      listHost.appendChild(card([
        el('div', { className: 'list-item' }, [
          el('div', { attrs: { style: 'min-width:0;flex:1' } }, [
            el('div', { className: 'row', attrs: { style: 'gap:.5rem;flex-wrap:wrap' } }, [
              el('span', { className: 'card-title', text: plan.name || `Plan ${plan.id}` }),
              badge(plan.status.replace(/_/g, ' '), RUN_STATUS_TONE[plan.status] || 'neutral'),
            ]),
            el('p', { className: 'card-sub', text: `${plan.startDate} to ${plan.endDate} · ${plan.timezone || 'UTC'} · ${total} post${total === 1 ? '' : 's'}` }),
            el('p', { className: 'card-sub', text: `Created ${formatDate(plan.createdAt)}` }),
            el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap;margin-top:.4rem' } },
              Object.entries(counts).filter(([, n]) => n > 0).map(([status, n]) =>
                el('span', { className: 'row', attrs: { style: 'gap:.25rem' } }, [
                  statusChip(status),
                  el('span', { className: 'card-sub', text: String(n) }),
                ]))),
          ]),
          el('div', { className: 'row', attrs: { style: 'gap:.4rem' } }, [
            el('a', {
              className: 'btn btn-secondary btn-sm',
              text: 'Open',
              attrs: { href: `/planner/week?run=${encodeURIComponent(plan.id)}`, 'data-link': '' },
            }),
            deleteBtn,
          ]),
        ]),
      ]));
    }
  }

  await load();
}
