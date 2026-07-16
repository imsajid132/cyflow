/**
 * Planner post card + status chip.
 *
 * Shared by the weekly board and the edit drawer. All text goes in via
 * textContent — nothing from a caption or a duplication note ever reaches
 * innerHTML.
 */

import { el, badge } from '../ui.js';
import { PROVIDER_LABELS } from '../icons.js';

export const STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  needs_review: 'Needs review',
  approved: 'Approved',
  queued: 'Queued',
  rejected: 'Rejected',
  // A hard failure is NOT review work. Without this entry the chip rendered the
  // raw key "generation_failed" in neutral grey, at the same visual weight as a
  // draft, which is precisely the mislabelling the status exists to prevent.
  generation_failed: 'Generation failed',
});

/**
 * Labels for what a post IS.
 *
 * Phase 4.8 made `contentType` hold a strategic FORMAT (`educational_insight`,
 * `soft_promo`, …). This map still held only the eight legacy content types, so
 * a card fell through to the raw key and displayed `educational_insight` to the
 * user. Both vocabularies are listed: the formats are what new items store, and
 * the legacy types keep older plans reading correctly.
 */
export const CONTENT_TYPE_LABELS = Object.freeze({
  // Phase 4.8 strategic formats.
  educational_insight: 'Insight',
  quick_tip: 'Quick tip',
  common_mistake: 'Common mistake',
  myth_fact: 'Myth vs fact',
  checklist: 'Checklist',
  comparison: 'Comparison',
  process: 'Process',
  service_benefit: 'Service benefit',
  local_relevance: 'Local',
  faq_answer: 'FAQ',
  authority: 'Authority',
  soft_promo: 'Service',
  // Pre-4.8 content types, so existing plans still read.
  educational: 'Educational',
  promotional: 'Promotional',
  tips: 'Tips',
  cta: 'Call to action',
  proof: 'Proof',
  local: 'Local',
});

/** The strategic pillar a post serves, for the board's badge. */
export const PILLAR_LABELS = Object.freeze({
  educational_insight: 'Educational Insight',
  service_promotion: 'Service Promotion',
  trust_authority: 'Trust and Authority',
  problem_solution: 'Problem and Solution',
  actionable_tips: 'Actionable Tips',
  engagement_local: 'Engagement and Local',
  soft_promo_recap: 'Soft Promotion',
});

/**
 * Layout labels.
 *
 * This listed only the ten pre-4.7.1 templates and had ZERO overlap with the
 * layouts the planner actually assigns, so a card showed no layout name and the
 * edit drawer's layout picker could not even offer the post's own layout:
 * choosing any option silently switched it to a different structure.
 *
 * The current design families come first (they are what the planner selects
 * from); the earlier layouts stay listed because older drafts still render with
 * them and their names must resolve.
 */
export const TEMPLATE_LABELS = Object.freeze({
  // Phase 4.7.1 / 4.8 design families.
  'editorial-insight': 'Editorial Insight',
  'light-editorial': 'Light Editorial',
  'checklist-guide': 'Checklist Guide',
  'comparison-cards': 'Comparison Cards',
  'stat-highlight': 'Stat Highlight',
  'service-authority': 'Service Authority',
  'local-insight': 'Local Insight',
  'numbered-steps': 'Numbered Steps',
  'faq-editorial': 'FAQ Editorial',
  // Earlier layouts, kept so existing drafts still name their design.
  'editorial-premium': 'Clean Editorial Premium',
  'bold-service-promo': 'Bold Service Promo',
  'local-authority': 'Local Business Authority',
  'modern-split': 'Modern Split Layout',
  'minimal-luxury': 'Minimal Luxury Card',
  'geometric-conversion': 'Geometric Conversion Post',
  'checklist-tips': 'Checklist Tips',
  'stat-proof': 'Stat Proof',
  'split-comparison': 'Split Comparison',
  'photo-overlay': 'Photo Overlay Ready',
});

/** Status → visual tone. The label always carries the meaning, never colour alone. */
export function statusChip(status) {
  const tone = {
    approved: 'ok',
    queued: 'info',
    rejected: 'err',
    needs_review: 'warn',
    draft: 'neutral',
    // Red, like a rejection: this post cannot go out as it is.
    generation_failed: 'err',
  }[status] || 'neutral';
  return badge(STATUS_LABELS[status] || status, tone);
}

/** "Mon 14 Jul · 09:00" from a MySQL UTC datetime, rendered in local time. */
export function formatSlot(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(value);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function dayKeyOf(value) {
  if (!value) return 'unscheduled';
  const d = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return 'unscheduled';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayLabelOf(value) {
  if (!value) return 'Unscheduled';
  const d = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return 'Unscheduled';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function truncate(text, max) {
  const s = typeof text === 'string' ? text.trim() : '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * One planned post.
 *
 * @param {object} item
 * @param {{ selected, onSelect, onOpen, onApprove, onReject }} handlers
 */
export function plannerCard(item, handlers = {}) {
  const checkbox = el('input', {
    className: 'card-select',
    attrs: {
      type: 'checkbox',
      'aria-label': `Select the post scheduled for ${formatSlot(item.scheduledFor)}`,
    },
  });
  checkbox.checked = Boolean(handlers.selected);
  checkbox.addEventListener('change', () => handlers.onSelect?.(item.id, checkbox.checked));

  const thumb = item.media?.publicToken
    ? el('img', {
        className: 'planner-thumb',
        attrs: { src: `/media/${encodeURIComponent(item.media.publicToken)}`, alt: '', loading: 'lazy' },
      })
    : el('div', { className: 'planner-thumb planner-thumb-empty' }, [
        el('span', { className: 'thumb-note', text: 'No image' }),
      ]);

  const actions = el('div', { className: 'planner-card-actions' });
  if (item.approvalStatus !== 'queued') {
    const editBtn = el('button', { className: 'btn btn-secondary btn-sm', text: 'Edit', attrs: { type: 'button' } });
    editBtn.addEventListener('click', () => handlers.onOpen?.(item));
    actions.appendChild(editBtn);

    /*
     * A hard failure offers no Approve button. The server refuses it anyway, so
     * showing one only invites a click that produces an error: the card would be
     * promising something the product will not do. What it needs instead is a
     * way forward, which is Edit (already above) or Retry.
     */
    const hardFailed = item.qualityStatus === 'generation_failed'
      || item.approvalStatus === 'generation_failed';
    if (item.approvalStatus !== 'approved' && !hardFailed) {
      const approveBtn = el('button', { className: 'btn btn-primary btn-sm', text: 'Approve', attrs: { type: 'button' } });
      approveBtn.addEventListener('click', () => handlers.onApprove?.(item));
      actions.appendChild(approveBtn);
    }
    if (hardFailed && handlers.onRetry) {
      const retryBtn = el('button', { className: 'btn btn-primary btn-sm', text: 'Retry generation', attrs: { type: 'button' } });
      retryBtn.addEventListener('click', () => handlers.onRetry?.(item));
      actions.appendChild(retryBtn);
    }
    if (item.approvalStatus !== 'rejected') {
      const rejectBtn = el('button', { className: 'btn btn-ghost btn-sm', text: 'Reject', attrs: { type: 'button' } });
      rejectBtn.addEventListener('click', () => handlers.onReject?.(item));
      actions.appendChild(rejectBtn);
    }
  }

  const platforms = (item.platformTargets || [])
    .map((p) => PROVIDER_LABELS[p] || p)
    .join(', ');

  return el('article', {
    className: `planner-card${item.approvalStatus === 'rejected' ? ' is-rejected' : ''}`,
    attrs: { 'data-item': item.id, 'data-status': item.approvalStatus },
  }, [
    el('div', { className: 'planner-card-head' }, [
      checkbox,
      el('span', { className: 'planner-time', text: formatSlot(item.scheduledFor) }),
      el('span', { className: 'spacer' }),
      statusChip(item.approvalStatus),
    ]),
    el('div', { className: 'planner-card-body' }, [
      thumb,
      el('div', { className: 'planner-card-text' }, [
        el('div', { className: 'row', attrs: { style: 'gap:.35rem;flex-wrap:wrap' } }, [
          // The pillar is WHY this post exists on this weekday. It leads,
          // because it is the thing a reviewer is really checking. Absent on
          // pre-4.8 items, which simply show their format as before.
          item.contentPillar
            ? badge(PILLAR_LABELS[item.contentPillar] || item.contentPillar, 'info')
            : null,
          badge(CONTENT_TYPE_LABELS[item.contentType] || item.contentType, 'neutral'),
          item.templateKey
            ? el('span', { className: 'planner-template', text: TEMPLATE_LABELS[item.templateKey] || item.templateKey })
            : null,
        ]),
        el('p', { className: 'planner-headline', text: item.headline || '(no headline)' }),
        el('p', { className: 'planner-caption', text: truncate(item.caption, 160) || '(no post copy yet)' }),
        el('p', { className: 'planner-meta', text: platforms || 'No platforms' }),
      ]),
    ]),
    // A similarity warning is shown in full: it is the reason a human is here.
    item.duplicationNotes
      ? el('p', { className: 'planner-warning', attrs: { role: 'status' }, text: item.duplicationNotes })
      : null,
    actions.childNodes.length ? actions : null,
  ]);
}

export default { plannerCard, statusChip, formatSlot, dayKeyOf, dayLabelOf, STATUS_LABELS, CONTENT_TYPE_LABELS, TEMPLATE_LABELS };
