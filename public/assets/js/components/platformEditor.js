/**
 * Per-platform post-copy editor: a tab strip over the selected platforms.
 *
 * Shared by the Weekly Board drawer and Create Post so there is ONE
 * implementation of "edit each platform independently". It renders the canonical
 * `item.platformCopy` the server resolves (from platform_captions_json), never
 * item.caption — which is the gap this closes: before C2 every platform showed
 * the same primary caption.
 *
 * Contract:
 *   - `platformCopy`: { platform: { postCopy, hashtags, userEdited, validationStatus,
 *     validationFailures, measurements } } for the SELECTED platforms only.
 *   - `onDirtyChange(dirty)`: called whenever the set of unsaved platforms changes,
 *     so the host can guard against losing edits.
 *   - `read()`: returns { [platform]: { postCopy, hashtags } } for platforms the
 *     user actually changed — the exact payload to PATCH, and nothing else.
 *
 * All text goes in via value/textContent. Nothing from copy or a validation
 * message ever reaches innerHTML.
 */

import { el, badge } from '../ui.js';
import { platformMark, PLATFORM_LABELS } from '../icons.js';

const isList = (m) => (m?.listItems ?? 0) > 0;

/** One measurement chip: "140 words" with a pass/fail tone. */
function measureChips(m, failures) {
  if (!m) return [];
  const wordsOk = m.words >= m.minWords && m.words <= m.maxWords;
  const proseOk = m.proseParagraphs >= m.minParagraphs && m.proseParagraphs <= m.maxParagraphs;
  const chips = [
    badge(`${m.words} / ${m.minWords}-${m.maxWords} words`, wordsOk ? 'ok' : 'warn'),
    badge(`${m.proseParagraphs} / ${m.minParagraphs}-${m.maxParagraphs} paragraphs`, proseOk ? 'ok' : 'warn'),
  ];
  if (isList(m)) chips.push(badge(`${m.listItems} list items`, 'neutral'));
  return chips;
}

/**
 * Build the editor.
 *
 * @param {object} opts
 * @param {string[]} opts.platforms selected platform ids, in order (primary first)
 * @param {object} opts.platformCopy the server-resolved per-platform copy
 * @param {(dirty:boolean)=>void} [opts.onDirtyChange]
 * @param {string} [opts.idPrefix] to keep element ids unique when two editors
 *        could coexist (Create Post vs a drawer)
 * @returns {{ node, read, isDirty, markSaved }}
 */
export function platformEditor({
  platforms, platformCopy, onDirtyChange = () => {}, idPrefix = 'pe', readOnly = false,
}) {
  // Only selected, resolved platforms. An unselected platform has no tab and no
  // panel — it does not exist in this editor.
  const shown = platforms.filter((p) => platformCopy?.[p]);

  // The live edit state per platform, seeded from the canonical copy.
  const state = new Map();
  for (const p of shown) {
    const c = platformCopy[p];
    state.set(p, {
      original: { postCopy: c.postCopy ?? '', hashtags: (c.hashtags ?? []).join(' ') },
      userEdited: c.userEdited === true,
      failures: c.validationFailures ?? [],
      measurements: c.measurements ?? null,
    });
  }

  let active = shown[0] ?? null;
  const tabEls = new Map();
  const panelEls = new Map();

  const tablist = el('div', { className: 'pe-tabs', attrs: { role: 'tablist', 'aria-label': 'Platform copy' } });
  const panelHost = el('div', { className: 'pe-panels' });

  /** Which platforms have unsaved changes right now. */
  function dirtyPlatforms() {
    const out = [];
    for (const p of shown) {
      const copyEl = document.getElementById(`${idPrefix}-copy-${p}`);
      const tagEl = document.getElementById(`${idPrefix}-tags-${p}`);
      if (!copyEl) continue;
      const s = state.get(p);
      if (copyEl.value !== s.original.postCopy || tagEl.value !== s.original.hashtags) out.push(p);
    }
    return out;
  }

  let lastDirty = false;
  function reportDirty() {
    const nowDirty = dirtyPlatforms().length > 0;
    if (nowDirty !== lastDirty) {
      lastDirty = nowDirty;
      onDirtyChange(nowDirty);
    }
  }

  function selectTab(platform) {
    active = platform;
    for (const [p, tab] of tabEls) {
      const on = p === platform;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle('is-active', on);
    }
    for (const [p, panel] of panelEls) {
      panel.hidden = p !== platform;
    }
  }

  shown.forEach((platform, i) => {
    const s = state.get(platform);
    const label = PLATFORM_LABELS[platform] ?? platform;

    // --- tab ---
    const tab = el('button', {
      className: 'pe-tab',
      attrs: {
        type: 'button', role: 'tab', id: `${idPrefix}-tab-${platform}`,
        'aria-controls': `${idPrefix}-panel-${platform}`,
        'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1',
        'data-platform': platform,
      },
    }, [
      platformMark(platform, { label: null, size: 18 }),
      el('span', { text: label }),
      // A dot when this platform has unsaved edits; a warning glyph when invalid.
      s.userEdited ? el('span', { className: 'pe-tab-edited', attrs: { title: 'You edited this', 'aria-label': 'edited' }, text: '•' }) : null,
    ]);
    tab.addEventListener('click', () => selectTab(platform));
    tabEls.set(platform, tab);
    tablist.appendChild(tab);

    // --- panel ---
    const copyId = `${idPrefix}-copy-${platform}`;
    const tagId = `${idPrefix}-tags-${platform}`;
    const measureRow = el('div', { className: 'pe-measure row', attrs: { style: 'gap:.35rem;flex-wrap:wrap' } }, measureChips(s.measurements, s.failures));
    const failureRow = el('div', { className: 'pe-failures' },
      s.failures.map((f) => el('p', { className: 'pe-failure', attrs: { role: 'status' }, text: f })));

    const copyArea = el('textarea', {
      className: 'input pe-copy',
      attrs: {
        id: copyId, rows: '7', 'aria-label': `${label} post copy`, 'data-platform': platform,
        ...(readOnly ? { readonly: '' } : {}),
      },
    });
    copyArea.value = s.original.postCopy;

    const tagInput = el('input', {
      className: 'input pe-tags',
      attrs: {
        id: tagId, type: 'text', 'aria-label': `${label} hashtags`, placeholder: '#example #tags',
        'data-platform': platform, ...(readOnly ? { readonly: '' } : {}),
      },
    });
    tagInput.value = s.original.hashtags;

    // Re-measuring on every keystroke against the shipped validator would mean
    // shipping it to the client; instead the server measures on save, and the
    // chips here reflect the last saved/generated state plus a live dirty dot.
    const onInput = () => {
      const dot = tab.querySelector('.pe-tab-dirty');
      const dirty = copyArea.value !== s.original.postCopy || tagInput.value !== s.original.hashtags;
      if (dirty && !dot) tab.appendChild(el('span', { className: 'pe-tab-dirty', attrs: { 'aria-hidden': 'true' }, text: '*' }));
      if (!dirty && dot) dot.remove();
      reportDirty();
    };
    copyArea.addEventListener('input', onInput);
    tagInput.addEventListener('input', onInput);

    const panel = el('div', {
      className: 'pe-panel',
      attrs: { role: 'tabpanel', id: `${idPrefix}-panel-${platform}`, 'aria-labelledby': `${idPrefix}-tab-${platform}`, hidden: i !== 0 },
    }, [
      s.userEdited ? badge('You edited this', 'info') : null,
      el('label', { className: 'label', attrs: { for: copyId }, text: 'Post copy' }),
      copyArea,
      el('label', { className: 'label', attrs: { for: tagId }, text: 'Hashtags (space separated)' }),
      tagInput,
      measureRow,
      failureRow,
    ]);
    panelEls.set(platform, panel);
    panelHost.appendChild(panel);
  });

  // --- keyboard: arrow keys move between tabs, per WAI-ARIA tabs pattern ---
  tablist.addEventListener('keydown', (e) => {
    const i = shown.indexOf(active);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = shown[(i + 1) % shown.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = shown[(i - 1 + shown.length) % shown.length];
    else if (e.key === 'Home') [next] = shown;
    else if (e.key === 'End') next = shown[shown.length - 1];
    if (next) {
      e.preventDefault();
      selectTab(next);
      tabEls.get(next).focus();
    }
  });

  const node = el('div', { className: 'pe' }, [tablist, panelHost]);

  return {
    node,
    /** The changed platforms only: exactly what to PATCH. */
    read() {
      const out = {};
      for (const p of dirtyPlatforms()) {
        const copyEl = document.getElementById(`${idPrefix}-copy-${p}`);
        const tagEl = document.getElementById(`${idPrefix}-tags-${p}`);
        out[p] = {
          postCopy: copyEl.value,
          hashtags: tagEl.value.split(/\s+/).map((t) => t.trim()).filter(Boolean),
        };
      }
      return out;
    },
    isDirty: () => dirtyPlatforms().length > 0,
    /** After a successful save/reload: the new values become the baseline. */
    markSaved(newPlatformCopy) {
      for (const p of shown) {
        const c = newPlatformCopy?.[p];
        if (!c) continue;
        state.get(p).original = { postCopy: c.postCopy ?? '', hashtags: (c.hashtags ?? []).join(' ') };
      }
      lastDirty = false;
      onDirtyChange(false);
    },
  };
}

export default { platformEditor };
