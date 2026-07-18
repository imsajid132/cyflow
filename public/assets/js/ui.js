/**
 * UI kit: safe DOM builders, toasts, accessible modals, skeletons, badges,
 * empty states, and form helpers.
 *
 * All text goes in via textContent — untrusted values are NEVER passed to
 * innerHTML. The only markup created here is authored in this file.
 */

/** Create an element. `text` is set with textContent (always safe). */
export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.html === true && opts.trustedSvg) node.innerHTML = opts.trustedSvg; // local, authored SVG only
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === false || v == null) continue;
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (opts.on) for (const [evt, fn] of Object.entries(opts.on)) node.addEventListener(evt, fn);
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  if (node) node.textContent = '';
}

/** Page header with an optional actions row. */
export function pageHead(title, subtitle, actions = []) {
  return el('div', { className: 'page-head' }, [
    el('div', {}, [
      el('h1', { text: title }),
      subtitle ? el('p', { className: 'sub', text: subtitle }) : null,
    ]),
    actions.length ? el('div', { className: 'page-actions' }, actions) : null,
  ]);
}

export function card(children, className = '') {
  return el('div', { className: `card ${className}`.trim() }, children);
}

export function badge(text, tone = 'neutral') {
  const map = { ok: 'badge-ok', warn: 'badge-warn', err: 'badge-err', info: 'badge-info', neutral: 'badge-neutral' };
  return el('span', { className: `badge ${map[tone] || map.neutral}`, text });
}

/** Status → tone. Never relies on colour alone (the label carries meaning). */
export function statusTone(status) {
  if (status === 'active' || status === 'queued' || status === 'published' || status === 'completed') return 'ok';
  if (status === 'failed' || status === 'revoked' || status === 'error' || status === 'partial') return 'err';
  return 'warn';
}

/**
 * The one human label for every post/automation state. Plain language only: a
 * business owner reads these, not an engineer. Nothing here claims a post was
 * published unless the provider actually confirmed it, and a partial result is
 * never dressed up as success.
 */
export const STATUS_LABEL = Object.freeze({
  draft: 'Draft',
  waiting_approval: 'Waiting for approval',
  scheduled: 'Scheduled',
  queued: 'Queued for publishing',
  processing: 'Working on it',
  publishing: 'Publishing',
  submitted: 'Sent, confirming',
  reconciling: 'Confirming',
  published: 'Published',
  partial: 'Partly published',
  retry_scheduled: 'Will try again',
  retrying: 'Will try again',
  failed: 'Failed',
  cancelled: 'Cancelled',
  attention_needed: 'Needs attention',
  paused: 'Paused',
  skipped: 'Skipped',
  active: 'Active',
  stopped: 'Stopped',
  // Planner approval states. These live in the same map as the publishing
  // states on purpose: "Queued" must read and look identical whether the user
  // is looking at a planner card or the queue.
  needs_review: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
  generation_failed: 'Generation failed',
  // Plan run states.
  partially_queued: 'Partly queued',
  review: 'Needs review',
  generating: 'Generating',
  archived: 'Archived',
});

/**
 * The single status chip used across Queue, Calendar, Automations, Create Post
 * and the Dashboard. Carries a dot AND a label, so status never depends on
 * colour alone.
 */
export function statusChip(status, overrideLabel = null) {
  const key = String(status || '').toLowerCase();
  return el('span', {
    className: 'status',
    text: overrideLabel || STATUS_LABEL[key] || (status ? String(status) : 'Unknown'),
    attrs: { 'data-status': key },
  });
}

export function notice(message, tone = 'info') {
  const map = { ok: 'notice-ok', warn: 'notice-warn', err: 'notice-err', info: 'notice-info' };
  return el('div', { className: `notice ${map[tone] || map.info}`, attrs: { role: 'status' }, text: message });
}

export function emptyState({ title, subtitle, action = null }) {
  return el('div', { className: 'empty' }, [
    el('p', { className: 'empty-title', text: title }),
    subtitle ? el('p', { className: 'empty-sub', text: subtitle }) : null,
    action,
  ]);
}

export function skeleton({ lines = 3, card: asCard = true } = {}) {
  const body = el('div', {}, Array.from({ length: lines }, (_, i) =>
    el('div', { className: 'skeleton skeleton-line', attrs: { style: `width:${[92, 74, 58][i % 3]}%` } }),
  ));
  body.setAttribute('aria-hidden', 'true');
  const wrap = el('div', {}, [body]);
  wrap.appendChild(el('span', { className: 'sr-only', text: 'Loading…' }));
  return asCard ? card([wrap]) : wrap;
}

// --- toasts ---------------------------------------------------------------

export function toast(message, tone = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const map = { ok: 'toast-ok', err: 'toast-err', info: 'toast-info' };
  const node = el('div', { className: `toast ${map[tone] || map.info}` }, [
    el('span', { text: message }),
    el('button', {
      className: 'toast-close',
      text: '✕',
      attrs: { type: 'button', 'aria-label': 'Dismiss' },
      on: { click: () => node.remove() },
    }),
  ]);
  host.appendChild(node);
  setTimeout(() => node.remove(), 5000);
}

// --- overlay scroll lock --------------------------------------------------

/*
 * While an overlay is open the page behind it must not scroll: a wheel or a
 * swipe over the backdrop used to move the list underneath, so closing the
 * dialog returned the user somewhere they had not chosen to be.
 *
 * Depth-counted, because overlays nest (the media picker opens over the edit
 * drawer). Closing the inner one must not unlock the page while the outer one
 * is still open. The previous inline value is restored rather than cleared, so
 * this cannot quietly take ownership of a style it did not set.
 */
let scrollDepth = 0;
let previousOverflow = '';

export function lockScroll() {
  if (scrollDepth === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollDepth += 1;
}

export function unlockScroll() {
  scrollDepth = Math.max(0, scrollDepth - 1);
  if (scrollDepth === 0) document.body.style.overflow = previousOverflow;
}

// --- modal ----------------------------------------------------------------

/**
 * Accessible confirmation modal: focus trap, Escape to cancel, restores focus.
 * @returns {Promise<boolean>}
 */
export function confirmModal({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const host = document.getElementById('modal-host');
    const previous = document.activeElement;
    clear(host);
    host.hidden = false;

    lockScroll();

    const close = (result) => {
      host.hidden = true;
      clear(host);
      document.removeEventListener('keydown', onKey);
      host.removeEventListener('click', onBackdrop);
      unlockScroll();
      if (previous && previous.focus) previous.focus();
      resolve(result);
    };
    /*
     * Not `{ once: true }`. A click anywhere inside the dialog also bubbles to
     * the host, which consumed the one-shot listener without closing anything,
     * so backdrop-dismiss stopped working after the user's first click.
     */
    function onBackdrop(e) { if (e.target === host) close(false); }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Tab') {
        const focusables = host.querySelectorAll('button');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    const confirmBtn = el('button', {
      className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
      text: confirmText,
      attrs: { type: 'button' },
      on: { click: () => close(true) },
    });
    const cancelBtn = el('button', {
      className: 'btn btn-secondary', text: 'Cancel',
      attrs: { type: 'button' }, on: { click: () => close(false) },
    });
    const dialog = el('div', {
      className: 'modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
    }, [
      el('h2', { text: title, attrs: { id: 'modal-title' } }),
      el('p', { className: 'card-sub', text: message }),
      el('div', { className: 'modal-actions' }, [cancelBtn, confirmBtn]),
    ]);
    host.appendChild(dialog);
    host.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    /*
     * A destructive dialog opens with Cancel focused, not Delete.
     *
     * It used to focus the confirm button always, so "Delete this post?" opened
     * with Delete already focused and a single Enter destroyed the post. The
     * safe option takes the default; confirming is a deliberate act.
     */
    (danger ? cancelBtn : confirmBtn).focus();
  });
}

// --- forms ----------------------------------------------------------------

export function field({ id, label, type = 'text', value = '', hint, ...rest }) {
  const input = el(type === 'textarea' ? 'textarea' : 'input', {
    className: type === 'textarea' ? 'textarea' : 'input',
    attrs: { id, name: id, ...(type === 'textarea' ? {} : { type }), ...(rest.attrs || {}) },
  });
  input.value = value == null ? '' : String(value);
  return el('div', { className: 'field' }, [
    el('label', { className: 'label', text: label, attrs: { for: id } }),
    input,
    hint ? el('p', { className: 'hint', text: hint }) : null,
    el('p', { className: 'field-error', attrs: { id: `${id}-error`, hidden: true } }),
  ]);
}

export function selectField({ id, label, options, value, hint }) {
  const select = el('select', { className: 'select', attrs: { id, name: id } },
    options.map((o) => {
      const opt = el('option', { text: typeof o === 'string' ? o : o.label, attrs: { value: typeof o === 'string' ? o : o.value } });
      if ((typeof o === 'string' ? o : o.value) === value) opt.selected = true;
      return opt;
    }),
  );
  return el('div', { className: 'field' }, [
    el('label', { className: 'label', text: label, attrs: { for: id } }),
    select,
    hint ? el('p', { className: 'hint', text: hint }) : null,
    el('p', { className: 'field-error', attrs: { id: `${id}-error`, hidden: true } }),
  ]);
}

/** Link a validation message to its field (aria-invalid + aria-describedby). */
export function setFieldError(id, message) {
  const input = document.getElementById(id);
  const error = document.getElementById(`${id}-error`);
  if (!input || !error) return;
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', `${id}-error`);
    error.textContent = message;
    error.hidden = false;
  } else {
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    error.hidden = true;
  }
}

export function clearFieldErrors(root = document) {
  root.querySelectorAll('.field-error').forEach((n) => { n.textContent = ''; n.hidden = true; });
  root.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
}

export function val(id) {
  const node = document.getElementById(id);
  return node ? node.value : '';
}

export function setLoading(button, loading, loadingText) {
  if (!button) return;
  if (loading) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (loadingText) button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.label) {
      button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
  }
}

/** Steps indicator: "Step N of total". */
export function steps(current, total = 3, labels = []) {
  const items = [];
  for (let i = 1; i <= total; i++) {
    items.push(el('span', {
      className: 'step-dot',
      text: String(i),
      attrs: { 'data-state': i === current ? 'active' : i < current ? 'done' : 'todo', 'aria-hidden': 'true' },
    }));
    if (i < total) items.push(el('span', { className: 'step-bar', attrs: { 'aria-hidden': 'true' } }));
  }
  return el('div', { className: 'stack', attrs: { style: 'gap:.4rem' } }, [
    el('div', { className: 'steps' }, items),
    el('p', { className: 'step-label', text: `Step ${current} of ${total}${labels[current - 1] ? ` · ${labels[current - 1]}` : ''}` }),
  ]);
}

/** Format a UTC datetime for display in local time. */
export function formatDate(value) {
  if (!value) return '—';
  try {
    const s = String(value);
    const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return s;
    // toLocaleString() gives "1/1/2026, 5:00:00 AM": ambiguous day/month order
    // and seconds nobody scheduled to. A post time is minute-precision.
    return d.toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

export default { el, clear, pageHead, card, badge, notice, emptyState, skeleton, toast, confirmModal, field, selectField, setFieldError, val, setLoading, steps, formatDate };
