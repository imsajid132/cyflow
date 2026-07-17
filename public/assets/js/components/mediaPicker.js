/**
 * A modal that lets the user pick one image from their media library.
 *
 * Resolves to the chosen asset ({ id, url, ... }), to the sentinel { clear: true }
 * when they choose "Use no image", or null when they cancel. Reused by the
 * Weekly Board drawer and Create Post so there is one picker, not two.
 *
 * It reads the same /api/media the library page does and renders from token
 * URLs; it never touches storage paths or keys. Built on the app's existing
 * modal host and classes.
 */

import * as api from '../api.js';
import { el, toast } from '../ui.js';

export async function pickMedia({ allowClear = true } = {}) {
  const res = await api.apiRequest('/api/media');
  if (!res.ok) {
    toast(api.errorMessage(res, 'Your media could not be loaded.'), 'err');
    return null;
  }
  const assets = api.payload(res)?.media || [];
  const host = document.getElementById('modal-host');
  if (!host) return null;

  return new Promise((resolve) => {
    let settled = false;
    // Capture the trigger so focus returns exactly where it left, the way
    // confirmModal does. A keyboard user must not be dropped to the top of the
    // document when the dialog closes.
    const previous = document.activeElement;
    const done = (value) => {
      if (settled) return;
      settled = true;
      host.textContent = '';
      host.hidden = true; // restore the shared modal host to its hidden state
      document.removeEventListener('keydown', onKey, true);
      if (previous && typeof previous.focus === 'function') previous.focus();
      resolve(value);
    };

    const grid = el('div', { className: 'media-grid media-picker-grid' },
      assets.length
        ? assets.map((a) => {
          const tile = el('button', {
            className: 'media-picker-tile',
            attrs: { type: 'button', 'data-media': a.id, title: a.altText || a.originalFilename || 'image' },
          }, [el('img', { className: 'media-tile-img', attrs: { src: a.url, alt: a.altText || 'Library image', loading: 'lazy' } })]);
          tile.addEventListener('click', () => done(a));
          return tile;
        })
        : [el('p', { className: 'hint', text: 'You have no images yet. Upload one in the Media library first.' })]);

    const actions = el('div', { className: 'modal-actions' }, [
      allowClear ? el('button', { className: 'btn btn-ghost btn-sm', text: 'Use no image', attrs: { type: 'button' } }) : null,
      el('button', { className: 'btn btn-secondary', text: 'Cancel', attrs: { type: 'button' } }),
    ]);
    const buttons = [...actions.querySelectorAll('button')];
    const cancelBtn = buttons[buttons.length - 1];
    if (allowClear) buttons[0].addEventListener('click', () => done({ clear: true }));
    cancelBtn.addEventListener('click', () => done(null));

    const dialog = el('div', {
      className: 'modal media-picker',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'media-picker-title' },
    }, [
      el('h2', { attrs: { id: 'media-picker-title' }, text: 'Choose an image' }),
      grid,
      actions,
    ]);

    host.textContent = '';
    host.hidden = false; // the shared host defaults to [hidden]; reveal it to show the picker
    host.appendChild(dialog);
    host.addEventListener('click', (e) => { if (e.target === host) done(null); }, { once: true });
    // Escape to cancel; Tab is trapped inside the dialog so focus cannot walk
    // out into the page/drawer behind an aria-modal dialog (WCAG 2.4.3 / 2.1.2).
    // Registered in the CAPTURE phase and stopped immediately so the key is
    // handled by the picker ALONE — the drawer this picker opens over also listens
    // for Escape on document, and must not close underneath it.
    function onKey(e) {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); done(null); return; }
      if (e.key === 'Tab') {
        e.stopImmediatePropagation();
        const focusables = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    (dialog.querySelector('.media-picker-tile') || cancelBtn).focus();
  });
}

export default { pickMedia };
