/**
 * Delete-plan flow, shared by the dashboard, history and weekly board.
 *
 * The confirmation states exactly what will happen, because the answer is not
 * the same every time:
 *   - published history  → the plan is ARCHIVED, not deleted
 *   - queued posts       → a plain delete is refused; the user must explicitly
 *                          choose to cancel them
 *   - drafts only        → a straightforward delete
 *
 * The impact is fetched from the server rather than guessed at, so the dialog
 * and the outcome can never disagree.
 */

import * as api from '../api.js';
import { el, toast, confirmModal } from '../ui.js';

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Confirm and delete. Returns true when the plan was deleted or archived.
 *
 * @param {string} runId
 * @param {{ name?, onDone?, navigate? }} opts
 */
export async function deletePlanFlow(runId, { name = 'this plan', onDone } = {}) {
  const impactRes = await api.plannerDeletionImpact(runId);
  if (!impactRes.ok) {
    toast(api.errorMessage(impactRes, 'That plan could not be checked.'), 'err');
    return false;
  }
  const impact = api.payload(impactRes);
  const { counts } = impact;

  // --- a plan with published history is archived, never destroyed ----------
  if (impact.mustArchive) {
    const ok = await confirmModal({
      title: `Archive ${name}?`,
      message: `This plan has ${plural(counts.publishedPosts, 'published post')}, so it cannot be deleted. It will be archived instead: the plan stays readable and its published history is kept.`,
      confirmText: 'Archive plan',
    });
    if (!ok) return false;
    const res = await api.apiRequest(`/api/planner/plans/${encodeURIComponent(runId)}`, {
      method: 'DELETE', body: {},
    });
    if (!res.ok) { toast(api.errorMessage(res, 'The plan could not be archived.'), 'err'); return false; }
    toast('Plan archived.', 'ok');
    onDone?.(api.payload(res));
    return true;
  }

  // --- queued posts need an explicit decision ------------------------------
  if (impact.blockedByQueued) {
    const ok = await confirmModal({
      title: `Cancel ${plural(counts.queuedPosts, 'queued post')} and delete ${name}?`,
      message: `This plan has ${plural(counts.queuedPosts, 'post')} already in your queue. Deleting the plan will cancel ${counts.queuedPosts === 1 ? 'it' : 'them'} first. The cancelled ${counts.queuedPosts === 1 ? 'post stays' : 'posts stay'} in your queue as cancelled, so nothing disappears. Cancel instead from the Queue page if you would rather keep the plan.`,
      confirmText: 'Cancel posts and delete',
      danger: true,
    });
    if (!ok) return false;
    const res = await api.apiRequest(`/api/planner/plans/${encodeURIComponent(runId)}`, {
      method: 'DELETE',
      // Explicit opt-in — never implied by "delete".
      body: { cancelQueued: true },
    });
    if (!res.ok) { toast(api.errorMessage(res, 'The plan could not be deleted.'), 'err'); return false; }
    const body = api.payload(res);
    toast(`Plan deleted. ${plural(body.cancelledPosts, 'queued post')} cancelled.`, 'ok');
    onDone?.(body);
    return true;
  }

  // --- ordinary delete ----------------------------------------------------
  const detail = [];
  if (counts.plannerItems) detail.push(plural(counts.plannerItems, 'planned post'));
  if (counts.draftPosts) detail.push(`${plural(counts.draftPosts, 'draft')} you copied out will be kept`);

  const ok = await confirmModal({
    title: `Delete ${name}?`,
    message: detail.length
      ? `This removes ${detail.join(', ')}. This cannot be undone.`
      : 'This removes the plan. This cannot be undone.',
    confirmText: 'Delete plan',
    danger: true,
  });
  if (!ok) return false;

  const res = await api.apiRequest(`/api/planner/plans/${encodeURIComponent(runId)}`, {
    method: 'DELETE', body: {},
  });
  if (!res.ok) { toast(api.errorMessage(res, 'The plan could not be deleted.'), 'err'); return false; }
  toast('Plan deleted.', 'ok');
  onDone?.(api.payload(res));
  return true;
}

/** A ready-made Delete button wired to the flow. */
export function deletePlanButton(runId, { name, onDone, className = 'btn btn-danger btn-sm', label = 'Delete plan' } = {}) {
  const button = el('button', { className, text: label, attrs: { type: 'button' } });
  button.addEventListener('click', () => deletePlanFlow(runId, { name, onDone }));
  return button;
}

export default { deletePlanFlow, deletePlanButton };
