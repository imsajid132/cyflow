/**
 * Weekly review board.
 *
 * The primary workflow's main screen: every generated post, grouped by day,
 * with an edit drawer, per-card actions and bulk controls.
 *
 * Edits are sent field-by-field and the server records which fields a human
 * touched, so regenerating one thing never discards another.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, badge, notice, toast, emptyState, skeleton,
  field, selectField, val, setLoading, confirmModal, clear,
} from '../ui.js';
import { platformNames } from '../icons.js';
import {
  plannerCard, statusChip, dayKeyOf, dayLabelOf, formatSlot, TEMPLATE_LABELS,
} from '../components/plannerCard.js';
import { deletePlanButton } from '../components/deletePlan.js';

const TEMPLATE_OPTIONS = Object.entries(TEMPLATE_LABELS).map(([value, label]) => ({ value, label }));
const BACKGROUNDS = ['light', 'dark', 'gradient-blue', 'gradient-warm', 'neutral'];

export async function render(root, ctx) {
  const params = new URLSearchParams(window.location.search);
  let runId = params.get('run');

  // No run in the URL: fall back to the most recent plan.
  if (!runId) {
    const plans = await api.plannerPlans({ limit: 1 });
    if (!plans.length) {
      root.appendChild(el('div', { className: 'page' }, [
        pageHead('Weekly board', 'Review your generated posts.'),
        card([emptyState({
          title: 'No plan to review',
          subtitle: 'Generate a plan and its posts will appear here.',
          action: el('a', { className: 'btn btn-primary', text: 'Generate a plan', attrs: { href: '/planner/new', 'data-link': '' } }),
        })]),
      ]));
      return;
    }
    runId = plans[0].id;
  }

  const selected = new Set();
  let plan = null;

  const boardHost = el('div', {});
  const summaryHost = el('div', {});
  const drawer = el('aside', { className: 'drawer', attrs: { hidden: true, 'aria-label': 'Edit planned post' } });
  const bulkHost = el('div', { className: 'planner-bulk' });

  const page = el('div', { className: 'page' }, [
    pageHead('Weekly board', 'Review, edit and approve. Nothing is queued until you say so.', [
      el('a', { className: 'btn btn-secondary', text: 'All plans', attrs: { href: '/planner/history', 'data-link': '' } }),
      el('a', { className: 'btn btn-secondary', text: 'New plan', attrs: { href: '/planner/new', 'data-link': '' } }),
    ]),
    summaryHost,
    bulkHost,
    boardHost,
    notice('Queued posts are stored for a future publishing phase. Cyflow does not post to providers yet.', 'info'),
  ]);
  root.appendChild(page);
  root.appendChild(drawer);

  boardHost.appendChild(skeleton({ lines: 4 }));

  async function load() {
    const res = await api.plannerPlan(runId);
    if (res.unauthorized) { ctx.navigate('/login'); return false; }
    if (!res.ok) {
      clear(boardHost);
      boardHost.appendChild(notice(api.errorMessage(res, 'That plan could not be loaded.'), 'err'));
      return false;
    }
    plan = api.payload(res);
    // Drop selections for cards that no longer exist.
    for (const id of [...selected]) {
      if (!plan.items.some((i) => i.id === id)) selected.delete(id);
    }
    renderSummary();
    renderBulk();
    renderBoard();
    // The drawer is part of the view, not a snapshot taken when it opened. If
    // the board is refreshing, so is it.
    refreshDrawer();
    return true;
  }

  function renderSummary() {
    clear(summaryHost);
    const counts = plan.counts || {};
    summaryHost.appendChild(card([
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: plan.run.name || 'Plan' }),
        badge(plan.run.status.replace(/_/g, ' '), plan.run.status === 'queued' ? 'ok' : 'warn'),
        el('span', { className: 'spacer' }),
        deletePlanButton(plan.run.id, {
          name: plan.run.name || 'this plan',
          onDone: () => ctx.navigate('/planner/history'),
        }),
      ]),
      el('p', {
        className: 'card-sub',
        text: `${plan.run.startDate} to ${plan.run.endDate} · ${plan.run.timezone || 'UTC'} · ${plan.run.postsPerDay || 1} post${(plan.run.postsPerDay || 1) === 1 ? '' : 's'} per day · ${plan.items.length} total`,
      }),
      el('div', { className: 'row', attrs: { style: 'gap:.5rem;flex-wrap:wrap;margin-top:.5rem' } },
        Object.entries(counts).filter(([, n]) => n > 0).map(([status, n]) =>
          el('span', { className: 'row', attrs: { style: 'gap:.3rem' } }, [statusChip(status), el('span', { className: 'card-sub', text: String(n) })]))),
      plan.run.generationNotes
        ? el('p', { className: 'hint', attrs: { style: 'margin-top:.6rem' }, text: plan.run.generationNotes })
        : null,
    ]));
  }

  /** Posts the generator could not write. They are not review work. */
  const hardFailedItems = () => (plan?.items || []).filter(
    (i) => i.qualityStatus === 'generation_failed' || i.approvalStatus === 'generation_failed',
  );

  function renderBulk() {
    clear(bulkHost);
    const count = selected.size;
    const failed = hardFailedItems();
    // Selecting a failed card and pressing Approve is a request the server
    // refuses item by item. The button should not offer it in the first place.
    const selectionHasFailures = failed.some((i) => selected.has(i.id));

    const selectAll = el('button', {
      className: 'btn btn-ghost btn-sm',
      text: count ? 'Clear selection' : 'Select all',
      attrs: { type: 'button' },
    });
    selectAll.addEventListener('click', () => {
      if (count) selected.clear();
      else for (const item of plan.items) if (item.approvalStatus !== 'queued') selected.add(item.id);
      renderBulk();
      renderBoard();
    });

    /*
     * "Approve all" over a plan with unwritable posts in it.
     *
     * The server has always refused these one by one, so the button "worked":
     * it approved what it could and quietly skipped the rest. But it was still
     * offering to approve posts that do not exist as usable copy, and a user
     * who presses Approve all reasonably believes the plan is now approved.
     * Nothing about the word "all" was true.
     *
     * With a failure outstanding it is disabled and says why. Individual
     * passing cards still have their own Approve button, so the plan is not
     * held hostage by one bad post.
     */
    const blocked = count === 0 ? failed.length > 0 : selectionHasFailures;
    const approveSelected = el('button', {
      className: 'btn btn-primary btn-sm',
      text: count ? `Approve ${count} selected` : 'Approve all',
      attrs: { type: 'button' },
    });
    approveSelected.disabled = blocked;
    if (blocked) {
      approveSelected.setAttribute(
        'title',
        count
          ? 'Some selected posts could not be generated. Retry, edit or remove them first.'
          : 'Some posts could not be generated. Retry, edit or remove them first.',
      );
    }
    approveSelected.addEventListener('click', () => {
      if (approveSelected.disabled) return;
      bulkStatus('approved');
    });

    const rejectSelected = el('button', { className: 'btn btn-secondary btn-sm', text: 'Reject selected', attrs: { type: 'button' } });
    rejectSelected.disabled = count === 0;
    rejectSelected.addEventListener('click', () => bulkStatus('rejected'));

    const removeRejected = el('button', { className: 'btn btn-ghost btn-sm', text: 'Remove rejected', attrs: { type: 'button' } });
    removeRejected.disabled = !(plan.counts?.rejected > 0);
    removeRejected.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Remove rejected posts?',
        message: 'They are deleted from this plan. Approved and queued posts are untouched.',
        confirmText: 'Remove',
        danger: true,
      });
      if (!ok) return;
      const res = await api.apiRequest(`/api/planner/plans/${encodeURIComponent(runId)}/remove-rejected`, { method: 'POST', body: {} });
      if (!res.ok) { toast(api.errorMessage(res, 'They could not be removed.'), 'err'); return; }
      toast('Rejected posts removed.', 'ok');
      await load();
    });

    const queueBtn = el('button', { className: 'btn btn-primary btn-sm', text: 'Queue approved posts', attrs: { type: 'button' } });
    queueBtn.disabled = !(plan.counts?.approved > 0);
    queueBtn.addEventListener('click', async () => {
      const n = plan.counts.approved;
      const ok = await confirmModal({
        title: `Queue ${n} approved post${n === 1 ? '' : 's'}?`,
        message: 'They move into your queue at their scheduled times. Cyflow does not publish to providers yet. This stores them for a later phase.',
        confirmText: 'Queue them',
      });
      if (!ok) return;
      setLoading(queueBtn, true, 'Queueing…');
      try {
        const res = await api.apiRequest(`/api/planner/plans/${encodeURIComponent(runId)}/queue`, { method: 'POST', body: { itemIds: [] } });
        if (!res.ok) { toast(api.errorMessage(res, 'They could not be queued.'), 'err'); return; }
        const body = api.payload(res);
        toast(`${body.queued.length} post${body.queued.length === 1 ? '' : 's'} queued.`, 'ok');
        if (body.skipped?.length) {
          summaryHost.appendChild(notice(
            `${body.skipped.length} post${body.skipped.length === 1 ? ' was' : 's were'} skipped: ${[...new Set(body.skipped.map((s) => s.reason))].join('; ')}.`,
            'warn',
          ));
        }
        await load();
      } finally {
        setLoading(queueBtn, false);
      }
    });

    bulkHost.appendChild(el('div', { className: 'row', attrs: { style: 'gap:.5rem;flex-wrap:wrap' } }, [
      selectAll,
      approveSelected,
      rejectSelected,
      removeRejected,
      el('span', { className: 'spacer' }),
      queueBtn,
    ]));

    // Say WHY the button is dead, next to the button. A disabled control with
    // no explanation is just a broken one.
    if (failed.length) {
      bulkHost.appendChild(notice(
        `${failed.length} post${failed.length === 1 ? '' : 's'} could not be generated, so this plan cannot be approved in one go. `
        + `Retry ${failed.length === 1 ? 'it' : 'them'}, edit ${failed.length === 1 ? 'it' : 'them'} by hand, or reject `
        + `${failed.length === 1 ? 'it' : 'them'}. The posts that worked can still be approved individually.`,
        'warn',
      ));
    }
  }

  async function bulkStatus(status) {
    const itemIds = [...selected];
    const res = await api.apiRequest(`/api/planner/plans/${encodeURIComponent(runId)}/bulk-status`, {
      method: 'POST',
      body: { status, itemIds },
    });
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) { toast(api.errorMessage(res, 'That could not be applied.'), 'err'); return; }
    const body = api.payload(res);
    toast(`${body.updated.length} post${body.updated.length === 1 ? '' : 's'} ${status}.`, 'ok');
    if (body.skipped?.length) {
      toast(`${body.skipped.length} skipped: ${[...new Set(body.skipped.map((s) => s.reason))].join('; ')}.`, 'err');
    }
    selected.clear();
    await load();
  }

  function renderBoard() {
    clear(boardHost);
    if (!plan.items.length) {
      boardHost.appendChild(card([emptyState({
        title: 'This plan has no posts',
        subtitle: 'Generate a new plan to start again.',
        action: el('a', { className: 'btn btn-primary btn-sm', text: 'New plan', attrs: { href: '/planner/new', 'data-link': '' } }),
      })]));
      return;
    }

    // Grouped by day — the unit a person actually reviews in.
    const days = new Map();
    for (const item of plan.items) {
      const key = dayKeyOf(item.scheduledFor);
      if (!days.has(key)) days.set(key, { label: dayLabelOf(item.scheduledFor), items: [] });
      days.get(key).items.push(item);
    }

    for (const [key, day] of days) {
      boardHost.appendChild(el('section', { className: 'planner-day', attrs: { 'data-day': key } }, [
        el('div', { className: 'planner-day-head' }, [
          el('h2', { className: 'planner-day-title', text: day.label }),
          el('span', { className: 'card-sub', text: `${day.items.length} post${day.items.length === 1 ? '' : 's'}` }),
        ]),
        el('div', { className: 'planner-day-grid' }, day.items.map((item) =>
          plannerCard(item, {
            selected: selected.has(item.id),
            onSelect: (id, on) => { if (on) selected.add(id); else selected.delete(id); renderBulk(); },
            onOpen: openDrawer,
            onApprove: (i) => setStatus(i, 'approved'),
            onReject: (i) => setStatus(i, 'rejected'),
            // A hard-failed card offers Retry instead of Approve. The retry
            // re-validates server-side: if the new copy is still invalid the
            // card stays failed rather than being quietly released. The button
            // comes through so it can show that it is working and refuse to be
            // clicked twice.
            onRetry: (i, btn) => retryGeneration(i, btn),
          }))),
      ]));
    }
  }

  /*
   * Items with a retry in flight.
   *
   * The button disables itself, but the button is not the whole story: every
   * load() rebuilds the board, so the element that was clicked is gone by the
   * time the request returns. Tracking the ITEM means a second click cannot get
   * through on a freshly-rendered button either.
   *
   * The server refuses concurrent retries per item anyway. This is the half
   * that stops the user seeing a rejection they caused by double-clicking, and
   * it keeps one click to one toast.
   */
  const retrying = new Set();

  /**
   * Retry a post the generator could not write.
   *
   * `force: true` because a hard-failed post has nothing worth protecting: the
   * copy is invalid by definition, so there is no user edit to discard. The
   * server re-validates the result, so a retry that fails again stays failed.
   */
  async function retryGeneration(item, btn) {
    if (retrying.has(item.id)) return;
    retrying.add(item.id);
    setLoading(btn, true, 'Retrying…');
    try {
      const res = await api.apiRequest(
        `/api/planner/items/${encodeURIComponent(item.id)}/regenerate`,
        { method: 'POST', body: { target: 'caption', force: true } },
      );
      if (!res.ok) {
        toast(api.errorMessage(res, 'That retry did not work. Try again shortly.'), 'err');
        return;
      }
      const updated = api.payload(res)?.item;
      if (updated?.qualityStatus === 'generation_failed') {
        toast('The retry still could not produce a usable post. Try editing it instead.', 'warn');
      } else {
        toast('Post copy regenerated.', 'ok');
      }
      await load();
    } finally {
      // The board has re-rendered, so `btn` is usually detached by now; calling
      // setLoading on it is harmless and matters in the paths where it is not.
      retrying.delete(item.id);
      setLoading(btn, false);
    }
  }

  async function setStatus(item, status) {
    const res = await api.apiRequest(`/api/planner/items/${encodeURIComponent(item.id)}/status`, {
      method: 'POST', body: { status },
    });
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) { toast(api.errorMessage(res, 'That could not be applied.'), 'err'); return; }
    await load();
  }

  // --- edit drawer ---------------------------------------------------------

  /*
   * Which item the drawer is showing, by ID — never the item OBJECT.
   *
   * openDrawer() used to capture the item by value in its closure, so after a
   * regeneration the board re-rendered from fresh data while the open drawer
   * kept displaying the copy it had been handed minutes earlier. The card said
   * one thing and the drawer said another, and the drawer was wrong.
   *
   * Holding an id instead means there is one source of truth (`plan.items`) and
   * the drawer is re-rendered from it, like the board is.
   */
  let openItemId = null;

  function closeDrawer() {
    openItemId = null;
    drawer.hidden = true;
    clear(drawer);
    document.removeEventListener('keydown', onDrawerKey);
  }
  function onDrawerKey(e) {
    if (e.key === 'Escape') closeDrawer();
  }

  /**
   * Re-render an open drawer from the latest plan data.
   *
   * Called after every reload. If the item it was showing is gone (deleted, or
   * removed with the rejected ones), the drawer closes rather than displaying a
   * post that no longer exists.
   */
  function refreshDrawer() {
    if (!openItemId) return;
    const latest = plan?.items?.find((i) => i.id === openItemId);
    if (!latest) { closeDrawer(); return; }
    openDrawer(latest);
  }

  function openDrawer(item) {
    openItemId = item.id;
    clear(drawer);
    drawer.hidden = false;
    document.addEventListener('keydown', onDrawerKey);

    const closeBtn = el('button', { className: 'btn btn-ghost btn-sm', text: 'Close', attrs: { type: 'button' } });
    closeBtn.addEventListener('click', closeDrawer);

    const preview = item.media?.publicToken
      ? el('img', {
          className: 'drawer-preview',
          attrs: { src: `/media/${encodeURIComponent(item.media.publicToken)}`, alt: item.altText || 'Generated post image' },
        })
      : el('div', { className: 'drawer-preview drawer-preview-empty' }, [
          el('span', { className: 'card-sub', text: 'No image yet' }),
        ]);

    const saveBtn = el('button', { className: 'btn btn-primary', text: 'Save changes', attrs: { type: 'button' } });
    const regenCaptionBtn = el('button', { className: 'btn btn-secondary btn-sm', text: 'Regenerate post copy', attrs: { type: 'button' } });
    const regenImageBtn = el('button', { className: 'btn btn-secondary btn-sm', text: 'Regenerate image', attrs: { type: 'button' } });
    const duplicateBtn = el('button', { className: 'btn btn-ghost btn-sm', text: 'Copy to manual draft', attrs: { type: 'button' } });
    const deleteBtn = el('button', { className: 'btn btn-danger btn-sm', text: 'Delete', attrs: { type: 'button' } });

    saveBtn.addEventListener('click', async () => {
      setLoading(saveBtn, true, 'Saving…');
      try {
        const body = {
          caption: val('d-caption'),
          headline: val('d-headline'),
          subheadline: val('d-subheadline'),
          altText: val('d-alt'),
          templateKey: val('d-template'),
          backgroundStyle: val('d-background'),
        };
        const when = val('d-when');
        if (when) body.scheduledFor = new Date(when).toISOString();
        const res = await api.apiRequest(`/api/planner/items/${encodeURIComponent(item.id)}`, { method: 'PATCH', body });
        if (!res.ok) { toast(api.errorMessage(res, 'Your changes could not be saved.'), 'err'); return; }
        toast('Saved.', 'ok');
        closeDrawer();
        await load();
      } finally {
        setLoading(saveBtn, false);
      }
    });

    regenCaptionBtn.addEventListener('click', async () => {
      // The server refuses to overwrite an edited caption without confirmation.
      const doRegen = async (force) => api.apiRequest(
        `/api/planner/items/${encodeURIComponent(item.id)}/regenerate`,
        { method: 'POST', body: { target: 'caption', force } },
      );
      setLoading(regenCaptionBtn, true, 'Writing…');
      try {
        let res = await doRegen(false);
        if (res.status === 409) {
          const ok = await confirmModal({
            title: 'Discard your post copy?',
            message: api.errorMessage(res, 'You have edited this caption. Regenerating replaces it.'),
            confirmText: 'Regenerate anyway',
            danger: true,
          });
          if (!ok) return;
          res = await doRegen(true);
        }
        if (!res.ok) { toast(api.errorMessage(res, 'The post copy could not be regenerated.'), 'err'); return; }
        const updated = api.payload(res)?.item;
        if (updated?.qualityStatus === 'generation_failed') {
          toast('That rewrite still could not produce a usable post. Try editing it instead.', 'warn');
        } else {
          toast('Post copy regenerated.', 'ok');
        }
        /*
         * Stay open and re-render from the reloaded plan, rather than closing.
         * Closing hid the very thing the user asked for, and it was masking the
         * bug where the drawer's captured item went stale: you could not see the
         * drawer disagreeing with the card if the drawer was never on screen.
         */
        await load();
      } finally {
        setLoading(regenCaptionBtn, false);
      }
    });

    regenImageBtn.addEventListener('click', async () => {
      setLoading(regenImageBtn, true, 'Rendering…');
      try {
        const res = await api.apiRequest(`/api/planner/items/${encodeURIComponent(item.id)}/regenerate`, {
          method: 'POST', body: { target: 'image' },
        });
        if (!res.ok) { toast(api.errorMessage(res, 'The image could not be regenerated.'), 'err'); return; }
        toast('Image regenerated.', 'ok');
        closeDrawer();
        await load();
      } finally {
        setLoading(regenImageBtn, false);
      }
    });

    duplicateBtn.addEventListener('click', async () => {
      const res = await api.apiRequest(`/api/planner/items/${encodeURIComponent(item.id)}/duplicate`, { method: 'POST', body: {} });
      if (!res.ok) { toast(api.errorMessage(res, 'It could not be copied.'), 'err'); return; }
      toast('Copied to a manual draft.', 'ok');
    });

    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Delete this post?',
        message: 'It is removed from the plan. This cannot be undone.',
        confirmText: 'Delete',
        danger: true,
      });
      if (!ok) return;
      const res = await api.apiRequest(`/api/planner/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (!res.ok) { toast(api.errorMessage(res, 'It could not be deleted.'), 'err'); return; }
      toast('Post deleted.', 'ok');
      closeDrawer();
      await load();
    });

    // datetime-local wants local wall time, not the UTC string we store.
    const localWhen = item.scheduledFor
      ? (() => {
          const d = new Date(`${item.scheduledFor.replace(' ', 'T')}Z`);
          const pad = (n) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        })()
      : '';

    drawer.append(
      el('div', { className: 'drawer-head' }, [
        el('h2', { className: 'card-title', text: 'Edit post' }),
        el('span', { className: 'spacer' }),
        statusChip(item.approvalStatus),
        closeBtn,
      ]),
      el('div', { className: 'drawer-body' }, [
        preview,
        item.duplicationNotes ? notice(item.duplicationNotes, 'warn') : null,
        el('p', { className: 'card-sub', text: `${formatSlot(item.scheduledFor)} · ${platformNames(item.platformTargets).join(', ')}` }),
        field({ id: 'd-caption', label: 'Post copy', type: 'textarea', value: item.caption || '', attrs: { rows: 6 } }),
        field({ id: 'd-headline', label: 'Image headline', value: item.headline || '' }),
        field({ id: 'd-subheadline', label: 'Image subheadline', value: item.subheadline || '' }),
        field({ id: 'd-alt', label: 'Image alt text', value: item.altText || '' }),
        el('div', { className: 'grid grid-2' }, [
          selectField({ id: 'd-template', label: 'Template', options: TEMPLATE_OPTIONS, value: item.templateKey || 'editorial-premium' }),
          selectField({
            id: 'd-background', label: 'Background',
            options: BACKGROUNDS.map((b) => ({ value: b, label: b })),
            value: item.backgroundStyle || 'light',
          }),
        ]),
        field({ id: 'd-when', label: 'Scheduled for', type: 'datetime-local', value: localWhen }),
        item.editedFields?.length
          ? el('p', { className: 'hint', text: `You have edited: ${item.editedFields.join(', ')}. Regenerating will not overwrite these.` })
          : null,
      ]),
      el('div', { className: 'drawer-foot' }, [
        saveBtn,
        regenCaptionBtn,
        regenImageBtn,
        el('span', { className: 'spacer' }),
        duplicateBtn,
        deleteBtn,
      ]),
    );
    drawer.querySelector('#d-caption')?.focus();
  }

  await load();
}
