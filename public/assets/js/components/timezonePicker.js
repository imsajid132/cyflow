/**
 * Searchable timezone combobox.
 *
 * The list comes from the server's full IANA catalogue, not a hardcoded
 * shortlist, and the offsets are computed for the DATE BEING PLANNED — a zone's
 * offset is not a property of the zone, so labelling Europe/London as UTC+00:00
 * in July would simply be wrong.
 *
 * The canonical IANA id is what gets submitted. The offset is display only.
 */

import { el } from '../ui.js';
import * as api from '../api.js';

/**
 * @param {{ id, label, value, forDate, hint, onChange }} opts
 * @returns {{ node, getValue, setDate }}
 */
export function timezonePicker({ id = 'timezone', label = 'Timezone', value = 'UTC', forDate = '', hint, onChange } = {}) {
  let selected = value || 'UTC';
  let planningDate = forDate;
  let entries = [];

  const input = el('input', {
    className: 'input',
    attrs: {
      id,
      name: id,
      type: 'text',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      'aria-controls': `${id}-list`,
      autocomplete: 'off',
      placeholder: 'Search any city, region or offset',
    },
  });
  // The hidden field carries the canonical id; the visible input is a search box.
  const hidden = el('input', { attrs: { type: 'hidden', id: `${id}-value`, name: `${id}-value` } });
  hidden.value = selected;

  const listbox = el('ul', {
    className: 'tz-list',
    attrs: { id: `${id}-list`, role: 'listbox', hidden: true },
  });
  const caption = el('p', { className: 'hint', attrs: { id: `${id}-caption` } });

  function setSelected(entry) {
    selected = entry.id;
    hidden.value = entry.id;
    input.value = entry.label;
    caption.textContent = `${entry.city}${entry.region !== entry.city ? `, ${entry.region}` : ''} · ${entry.offsetLabel}`;
    close();
    onChange?.(entry.id);
  }

  function close() {
    listbox.hidden = true;
    listbox.textContent = '';
    input.setAttribute('aria-expanded', 'false');
  }

  function renderOptions(list) {
    listbox.textContent = '';
    if (!list.length) {
      listbox.appendChild(el('li', { className: 'tz-empty', text: 'No timezone matches that search' }));
      listbox.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    for (const entry of list.slice(0, 60)) {
      const option = el('li', {
        className: `tz-option${entry.id === selected ? ' is-selected' : ''}`,
        attrs: { role: 'option', 'aria-selected': entry.id === selected ? 'true' : 'false', tabindex: '-1' },
      }, [
        el('span', { className: 'tz-id', text: entry.id }),
        el('span', { className: 'tz-offset', text: entry.offsetLabel }),
      ]);
      // mousedown, not click: blur would close the list before click fires.
      option.addEventListener('mousedown', (e) => { e.preventDefault(); setSelected(entry); });
      listbox.appendChild(option);
    }
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function search(query) {
    entries = await api.plannerTimezones({ search: query, forDate: planningDate, limit: 60 });
    renderOptions(entries);
  }

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => search(input.value.trim()), 160);
  });
  input.addEventListener('focus', () => search(''));
  input.addEventListener('blur', () => {
    // Restore the label if the user typed without choosing: the field must
    // always show the zone that will actually be used.
    setTimeout(() => {
      const current = entries.find((e) => e.id === selected);
      if (current) input.value = current.label;
      close();
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); }
    if (e.key === 'ArrowDown') {
      const first = listbox.querySelector('.tz-option');
      if (first) { e.preventDefault(); first.focus(); }
    }
  });
  listbox.addEventListener('keydown', (e) => {
    const options = [...listbox.querySelectorAll('.tz-option')];
    const index = options.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); options[Math.min(index + 1, options.length - 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (index <= 0 ? input : options[index - 1])?.focus(); }
    if (e.key === 'Enter' && index >= 0) { e.preventDefault(); options[index].dispatchEvent(new MouseEvent('mousedown')); }
    if (e.key === 'Escape') { close(); input.focus(); }
  });

  const node = el('div', { className: 'field tz-field' }, [
    el('label', { className: 'label', text: label, attrs: { for: id } }),
    input,
    hidden,
    listbox,
    hint ? el('p', { className: 'hint', text: hint }) : null,
    caption,
    el('p', { className: 'field-error', attrs: { id: `${id}-error`, hidden: true } }),
  ]);

  // Seed the label from the server so the initial value shows its real offset.
  (async () => {
    const found = await api.plannerTimezones({ search: selected, forDate: planningDate, limit: 5 });
    const exact = found.find((e) => e.id === selected) || found[0];
    if (exact) {
      input.value = exact.label;
      caption.textContent = `${exact.city} · ${exact.offsetLabel}`;
    } else {
      input.value = selected;
    }
  })();

  return {
    node,
    getValue: () => selected,
    /** Re-label for a new planning date: DST may change the offset. */
    setDate: async (date) => {
      planningDate = date;
      const found = await api.plannerTimezones({ search: selected, forDate: date, limit: 5 });
      const exact = found.find((e) => e.id === selected);
      if (exact) {
        input.value = exact.label;
        caption.textContent = `${exact.city} · ${exact.offsetLabel}`;
      }
    },
  };
}

export default { timezonePicker };
