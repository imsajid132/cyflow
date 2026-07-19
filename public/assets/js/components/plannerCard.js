/**
 * Planner post card + status chip.
 *
 * Shared by the weekly board and the edit drawer. All text goes in via
 * textContent — nothing from a caption or a duplication note ever reaches
 * innerHTML.
 */

import { el, badge, statusChip, STATUS_LABEL } from '../ui.js';
import { platformNames } from '../icons.js';

/*
 * Status labels used to be defined here as a second table. They are now the
 * single map in ui.js, which the queue, calendar, automations and dashboard
 * already read from, so one state cannot be worded two ways.
 */
export const STATUS_LABELS = STATUS_LABEL;

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

/*
 * Status rendering is NOT defined here. It used to be: a second badge-based
 * chip with its own tone table, which meant "Queued" was a blue pill on a
 * planner card and a dot-chip in the Queue. One state, two appearances.
 * Both now come from the shared renderer in ui.js; this re-export exists so
 * the planner pages keep importing it from the component they already use.
 */
export { statusChip };

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

/** Platform names as the server writes them at the start of a failure reason. */
const PLATFORM_NAMES = Object.freeze(['Facebook', 'Instagram', 'Threads']);

/**
 * Which platforms these failure reasons are about.
 *
 * The server writes every reason with its platform first ("Threads has 44
 * words; the minimum is 45"), so this is a prefix check against a fixed list of
 * three, not parsing. A reason it cannot attribute is still SHOWN in full
 * below; it just does not get named in the one-line summary.
 */
function platformsIn(reasons) {
  return PLATFORM_NAMES.filter((name) => reasons.some((r) => String(r).startsWith(name)));
}

/** "Instagram and Threads" — an English list, not "Instagram, Threads". */
function englishList(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Why this post failed, in a sentence, with the exact reasons one click away.
 *
 * The failures were already stored and already precise; nothing rendered them,
 * so the only way to find out why a post would not generate was to open
 * phpMyAdmin and read quality_failures_json. A summary alone would repeat the
 * original mistake of telling the user nothing, and a raw list of validator
 * output as the headline would be shouting at them. So: the sentence is the
 * summary, and the measurements are in the <details>.
 */
function failureDetails(item) {
  const reasons = Array.isArray(item.qualityFailures) ? item.qualityFailures.filter(Boolean) : [];
  if (!reasons.length) return null;

  const named = platformsIn(reasons);
  const summary = named.length
    ? `${englishList(named)} need${named.length === 1 ? 's' : ''} another rewrite.`
    : 'This post needs another rewrite.';

  return el('div', { className: 'planner-failure' }, [
    el('p', { className: 'planner-failure-summary', attrs: { role: 'status' }, text: summary }),
    el('details', { className: 'planner-failure-detail' }, [
      el('summary', { text: `What failed (${reasons.length})` }),
      el('ul', { className: 'planner-failure-list' }, reasons.map((r) => el('li', { text: String(r) }))),
    ]),
  ]);
}

/**
 * One planned post.
 *
 * @param {object} item
 * @param {{ selected, onSelect, onOpen, onApprove, onReject, onRetry }} handlers
 */
/**
 * "Facebook · NYC Waterproofing" — the platform AND the account it posts to.
 *
 * The board used to show only "Facebook", so with more than one Page connected
 * an operator could not tell which one a post was about to go to. The account
 * name comes from `targetAccounts`, which the server resolves from the stored
 * automation-to-account relation; the client never labels a post from anything
 * it was handed by a form.
 *
 * When a platform resolves to no account the label says so, rather than
 * printing a bare "Facebook" that reads like a working destination. These posts
 * cannot be queued, and the card is where an operator finds that out — the old
 * bare label meant Queue refused items the board had shown as ready.
 */
export function platformTargetLabel(item) {
  const accounts = Array.isArray(item?.targetAccounts) ? item.targetAccounts : [];
  const names = platformNames(item?.platformTargets || []);
  const targets = item?.platformTargets || [];
  return targets.map((platform, i) => {
    const label = names[i] || platform;
    const match = accounts.find((a) => a.platform === platform && a.accountName);
    if (match) return `${label} · ${match.accountName}`;
    return `${label} · Account unavailable`;
  }).join(', ');
}

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

  const emptyThumb = (note) => el('div', { className: 'planner-thumb planner-thumb-empty' }, [
    el('span', { className: 'thumb-note', text: note }),
  ]);
  let thumb;
  if (item.media?.publicToken) {
    thumb = el('img', {
      className: 'planner-thumb',
      attrs: { src: `/media/${encodeURIComponent(item.media.publicToken)}`, alt: '', loading: 'lazy' },
    });
    // Matches the queue: an image that cannot load becomes a labelled
    // placeholder, never a silent black rectangle the size of the creative.
    thumb.addEventListener('error', () => {
      thumb.replaceWith(emptyThumb('Image unavailable'));
    }, { once: true });
  } else {
    thumb = emptyThumb('No image');
  }

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
      /*
       * One click, one generation.
       *
       * A retry takes several seconds and, until it returned, this button
       * looked exactly like it had before the click. So people clicked it
       * again, and each click was another full generation: real spend, and two
       * writes racing for the same row. The button hands itself to the handler
       * so the handler can disable it for the duration, and refuses to fire
       * while it is already disabled.
       */
      retryBtn.addEventListener('click', () => {
        if (retryBtn.disabled) return;
        handlers.onRetry?.(item, retryBtn);
      });
      actions.appendChild(retryBtn);
    }
    if (item.approvalStatus !== 'rejected') {
      const rejectBtn = el('button', { className: 'btn btn-ghost btn-sm', text: 'Reject', attrs: { type: 'button' } });
      rejectBtn.addEventListener('click', () => handlers.onReject?.(item));
      actions.appendChild(rejectBtn);
    }
  }

  // platformTargets holds PLATFORM ids. PROVIDER_LABELS is keyed by provider,
  // so it resolved Instagram and Threads by coincidence and missed Facebook,
  // printing the raw lowercase id on the card.
  const platforms = platformTargetLabel(item);

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
    failureDetails(item),
    actions.childNodes.length ? actions : null,
  ]);
}

export default { plannerCard, statusChip, formatSlot, dayKeyOf, dayLabelOf, STATUS_LABELS, CONTENT_TYPE_LABELS, TEMPLATE_LABELS };
