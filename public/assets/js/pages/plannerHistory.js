/**
 * Plan history — every plan this user has generated.
 */

import * as api from '../api.js';
import { el, card, pageHead, badge, notice, emptyState, toast, confirmModal, formatDate } from '../ui.js';
import { statusChip } from '../components/plannerCard.js';

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
    notice('Deleting a plan does not remove posts it already queued — those stay in your queue.', 'info'),
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

      const deleteBtn = el('button', { className: 'btn btn-danger btn-sm', text: 'Delete', attrs: { type: 'button' } });
      deleteBtn.addEventListener('click', async () => {
        const ok = await confirmModal({
          title: 'Delete this plan?',
          message: 'The plan and its unqueued posts are removed. Posts you already queued stay in your queue.',
          confirmText: 'Delete',
          danger: true,
        });
        if (!ok) return;
        const res = await api.apiRequest(`/api/planner/plans/${encodeURIComponent(plan.id)}`, { method: 'DELETE' });
        if (res.unauthorized) { ctx.navigate('/login'); return; }
        if (!res.ok) { toast(api.errorMessage(res, 'The plan could not be deleted.'), 'err'); return; }
        toast('Plan deleted.', 'ok');
        await load();
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
