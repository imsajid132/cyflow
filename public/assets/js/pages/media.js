/**
 * Media Library.
 *
 * A signed-in user's uploaded and generated images: upload, preview, edit alt
 * text, and delete when unused. Every image is rendered from its opaque token
 * URL (`/media/<token>`); the page never sees a storage path, a key, or a
 * checksum.
 *
 * All text and attributes go in via textContent / safe DOM APIs.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, notice, toast, emptyState, skeleton, field, val,
  setLoading, confirmModal, clear,
} from '../ui.js';

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

function humanSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function render(root, ctx) {
  let assets = [];

  const grid = el('div', { className: 'media-grid' });
  const uploaderHost = el('div', {});

  const page = el('div', { className: 'page' }, [
    pageHead('Media library', 'Upload and reuse images across your posts. Nothing here is public until you attach it to a post.'),
    uploaderHost,
    grid,
  ]);
  root.appendChild(page);

  grid.appendChild(skeleton({ lines: 3 }));

  // --- uploader ------------------------------------------------------------
  function renderUploader() {
    clear(uploaderHost);
    const fileInput = el('input', {
      className: 'sr-only',
      attrs: { type: 'file', id: 'media-file', accept: ACCEPT },
    });
    const chooseBtn = el('label', {
      className: 'btn btn-secondary', attrs: { for: 'media-file', tabindex: '0', role: 'button' },
      text: 'Choose image',
    });
    // A label is not keyboard-activatable by default; Enter/Space forwards to it.
    chooseBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    const preview = el('div', { className: 'media-upload-preview', attrs: { hidden: true } });
    const uploadBtn = el('button', { className: 'btn btn-primary', text: 'Upload', attrs: { type: 'button', disabled: '' } });
    const clearBtn = el('button', { className: 'btn btn-ghost btn-sm', text: 'Remove', attrs: { type: 'button', hidden: '' } });
    const dropZone = el('div', { className: 'media-dropzone' }, [
      el('p', { className: 'media-dropzone-title', text: 'Drag an image here, or choose one' }),
      el('p', { className: 'hint', text: 'JPEG, PNG or WebP. Up to 8 MB.' }),
      el('div', { className: 'row', attrs: { style: 'gap:.5rem;margin-top:.6rem;flex-wrap:wrap' } }, [chooseBtn, uploadBtn, clearBtn]),
      fileInput,
      preview,
    ]);

    let chosen = null;
    let uploading = false;

    const resetChoice = () => {
      chosen = null;
      fileInput.value = '';
      clear(preview);
      preview.hidden = true;
      uploadBtn.disabled = true;
      clearBtn.hidden = true;
    };

    const choose = (file) => {
      if (!file) return;
      // Friendly client-side pre-checks. The server re-validates from the bytes;
      // these just save an obviously-doomed round trip.
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        toast('Please choose a JPEG, PNG or WebP image.', 'err');
        return;
      }
      if (file.size > MAX_BYTES) {
        toast('That image is larger than 8 MB.', 'err');
        return;
      }
      chosen = file;
      clear(preview);
      const img = el('img', { className: 'media-upload-thumb', attrs: { alt: 'Selected image preview' } });
      img.src = URL.createObjectURL(file);
      img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
      preview.appendChild(img);
      preview.appendChild(el('p', { className: 'hint', text: `${file.name} · ${humanSize(file.size)}` }));
      preview.hidden = false;
      uploadBtn.disabled = false;
      clearBtn.hidden = false;
    };

    fileInput.addEventListener('change', () => choose(fileInput.files[0]));
    clearBtn.addEventListener('click', resetChoice);

    // Drag and drop.
    ['dragover', 'dragenter'].forEach((evt) => dropZone.addEventListener(evt, (e) => {
      e.preventDefault(); dropZone.classList.add('is-drag');
    }));
    ['dragleave', 'drop'].forEach((evt) => dropZone.addEventListener(evt, (e) => {
      e.preventDefault(); dropZone.classList.remove('is-drag');
    }));
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) choose(file);
    });

    uploadBtn.addEventListener('click', async () => {
      if (!chosen || uploading) return; // duplicate-click guard
      uploading = true;
      setLoading(uploadBtn, true, 'Uploading…');
      try {
        const form = new FormData();
        form.append('image', chosen, chosen.name);
        const res = await api.apiRequest('/api/media', { method: 'POST', body: form });
        if (res.unauthorized) { ctx.navigate('/login'); return; }
        if (!res.ok) { toast(api.errorMessage(res, 'That image could not be uploaded.'), 'err'); return; }
        toast('Image uploaded.', 'ok');
        resetChoice();
        await load();
      } finally {
        uploading = false;
        setLoading(uploadBtn, false);
      }
    });

    uploaderHost.appendChild(card([dropZone]));
  }

  // --- grid ----------------------------------------------------------------
  function tile(asset) {
    const img = el('img', {
      className: 'media-tile-img',
      attrs: { src: asset.url, alt: asset.altText || 'Uploaded image', loading: 'lazy' },
    });
    const altInput = field({
      id: `alt-${asset.id}`, label: 'Alt text', value: asset.altText || '',
      hint: 'Describes the image for screen readers.',
    });
    const saveAlt = el('button', { className: 'btn btn-secondary btn-sm', text: 'Save alt text', attrs: { type: 'button' } });
    const deleteBtn = el('button', { className: 'btn btn-danger btn-sm', text: 'Delete', attrs: { type: 'button' } });

    saveAlt.addEventListener('click', async () => {
      setLoading(saveAlt, true, 'Saving…');
      try {
        const res = await api.apiRequest(`/api/media/${encodeURIComponent(asset.id)}`, {
          method: 'PATCH', body: { altText: val(`alt-${asset.id}`) },
        });
        if (!res.ok) { toast(api.errorMessage(res, 'Alt text could not be saved.'), 'err'); return; }
        toast('Alt text saved.', 'ok');
      } finally {
        setLoading(saveAlt, false);
      }
    });

    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Delete this image?',
        message: 'It is removed from your library. This cannot be undone.',
        confirmText: 'Delete', danger: true,
      });
      if (!ok) return;
      setLoading(deleteBtn, true, 'Deleting…');
      try {
        const res = await api.apiRequest(`/api/media/${encodeURIComponent(asset.id)}`, { method: 'DELETE' });
        if (res.status === 409) {
          // In use: the server explains where, without a private id.
          toast(api.errorMessage(res, 'This image is in use and cannot be deleted yet.'), 'warn');
          return;
        }
        if (!res.ok) { toast(api.errorMessage(res, 'It could not be deleted.'), 'err'); return; }
        toast('Image deleted.', 'ok');
        await load();
      } finally {
        setLoading(deleteBtn, false);
      }
    });

    return el('article', { className: 'media-tile', attrs: { 'data-media': asset.id } }, [
      el('div', { className: 'media-tile-frame' }, [img]),
      el('div', { className: 'media-tile-meta' }, [
        el('span', { className: `badge ${asset.source === 'upload' ? 'badge-ok' : 'badge-neutral'}`, text: asset.sourceLabel }),
        el('span', { className: 'card-sub', text: [
          asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
          humanSize(asset.fileSizeBytes),
        ].filter(Boolean).join(' · ') }),
      ]),
      altInput,
      el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap' } }, [saveAlt, deleteBtn]),
    ]);
  }

  function renderGrid() {
    clear(grid);
    if (!assets.length) {
      grid.appendChild(emptyState({
        title: 'No images yet',
        subtitle: 'Upload an image above, or generate one from the planner. Your library appears here.',
      }));
      return;
    }
    for (const asset of assets) grid.appendChild(tile(asset));
  }

  async function load() {
    const res = await api.apiRequest('/api/media');
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) {
      clear(grid);
      grid.appendChild(notice(api.errorMessage(res, 'Your media could not be loaded.'), 'err'));
      return;
    }
    assets = api.payload(res)?.media || [];
    renderGrid();
  }

  renderUploader();
  await load();
}

export default { render };
