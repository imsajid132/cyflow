/**
 * Automations — always-on content preparation.
 *
 * A user configures platforms, exact accounts, timezone, weekdays, local times
 * and a rhythm once; the system keeps a rolling buffer of future prepared posts
 * topped up by background workers. Nothing publishes to a provider yet: prepared
 * posts are reviewed on the Weekly Board and stored for a future publishing phase.
 *
 * The create flow ALWAYS shows an exact confirmation before creating, and never
 * silently selects every connected account.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, badge, notice, toast, field, selectField, val,
  setLoading, emptyState, confirmModal, formatDate,
} from '../ui.js';
import { PROVIDER_LABELS, PLATFORM_LABELS } from '../icons.js';

const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const PLATFORMS = [['instagram', 'Instagram'], ['threads', 'Threads'], ['facebook', 'Facebook']];
const MODES = [['review', 'Review before publishing'], ['draft_only', 'Draft only'], ['autopilot', 'Full autopilot']];
const RHYTHMS = [['balanced', 'Balanced'], ['education_first', 'Education first'], ['promotion_light', 'Promotion light'], ['authority', 'Authority']];
const MISSED = [['skip', 'Skip it'], ['hold', 'Hold for review'], ['next_safe_time', 'Prepare for the next safe time']];
const STATUS_TONE = { draft: 'neutral', active: 'ok', paused: 'warn', attention_needed: 'err', stopped: 'neutral' };

const browserTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const ACCOUNT_PLATFORM = { facebook_page: 'facebook', instagram_professional: 'instagram', threads_profile: 'threads' };
const platformOf = (a) => ACCOUNT_PLATFORM[a.accountType] || a.provider;

export async function render(root, ctx) {
  const accountsRes = await api.apiRequest('/api/social-accounts');
  if (accountsRes.unauthorized) { ctx.navigate('/login'); return; }
  const accounts = (api.payload(accountsRes)?.accounts || []).filter((a) => a.status === 'active');

  const page = el('div', { className: 'page' }, [
    pageHead('Automations', 'Keep a rolling buffer of prepared posts topped up automatically. Nothing is published yet.'),
  ]);
  page.appendChild(notice('Automations prepare and queue posts for review. Cyflow does not publish to Facebook, Instagram, or Threads yet.', 'info'));

  const newBtn = el('button', { className: 'btn btn-primary', text: 'New automation', attrs: { type: 'button' } });
  const formHost = el('div', {});
  const listHost = el('div', { className: 'stack', attrs: { style: 'gap:.8rem' } });
  page.append(el('div', { className: 'row', attrs: { style: 'margin:.4rem 0' } }, [newBtn]), formHost, listHost);
  root.appendChild(page);

  newBtn.addEventListener('click', () => { formHost.textContent === '' ? openForm() : (formHost.textContent = ''); });

  // --- create form ---------------------------------------------------------
  function openForm() {
    formHost.textContent = '';
    const platformHost = el('div', { className: 'row', attrs: { style: 'gap:1rem;flex-wrap:wrap' } });
    const accountHost = el('div', { className: 'stack', attrs: { style: 'gap:.3rem' } });

    const checkbox = (id, label, value, checked, group) => {
      const input = el('input', { attrs: { type: 'checkbox', id, 'data-group': group, value, 'aria-label': label } });
      input.checked = Boolean(checked);
      return el('label', { className: 'choice-inline', attrs: { for: id } }, [input, el('span', { text: label })]);
    };

    for (const [p, label] of PLATFORMS) {
      const c = checkbox(`pf-${p}`, label, p, false, 'platform');
      c.querySelector('input').addEventListener('change', renderAccounts);
      platformHost.appendChild(c);
    }

    function selectedPlatforms() {
      return [...platformHost.querySelectorAll('input:checked')].map((i) => i.value);
    }
    function renderAccounts() {
      accountHost.textContent = '';
      const plats = selectedPlatforms();
      const relevant = accounts.filter((a) => plats.includes(platformOf(a)));
      if (!plats.length) { accountHost.appendChild(el('p', { className: 'hint', text: 'Choose platforms to see their accounts.' })); return; }
      if (!relevant.length) { accountHost.appendChild(notice('No connected accounts for the chosen platforms. Connect one first.', 'warn')); return; }
      // Never pre-checked: the user picks the exact accounts.
      for (const a of relevant) {
        accountHost.appendChild(checkbox(`acct-${a.id}`, `${a.displayName || a.username || 'Account'} · ${PROVIDER_LABELS[a.provider] || a.provider}`, a.id, false, 'account'));
      }
    }
    renderAccounts();

    const weekdayHost = el('div', { className: 'row', attrs: { style: 'gap:.6rem;flex-wrap:wrap' } },
      WEEKDAYS.map(([d, label]) => checkbox(`wd-${d}`, label, String(d), [1, 2, 3, 4, 5].includes(d), 'weekday')));

    const formCard = card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'New automation' })]),
      field({ id: 'auName', label: 'Name (optional)', value: '' }),
      el('div', { className: 'field' }, [el('label', { text: 'Platforms' }), platformHost]),
      el('div', { className: 'field' }, [el('label', { text: 'Accounts (choose exactly which)' }), accountHost]),
      field({ id: 'auTimezone', label: 'Timezone', value: browserTz, hint: 'An IANA name such as Asia/Karachi or America/New_York.' }),
      el('div', { className: 'field' }, [el('label', { text: 'Weekdays' }), weekdayHost]),
      el('div', { className: 'grid grid-3' }, [
        field({ id: 'auTimes', label: 'Local times', value: '09:00', hint: 'Comma separated, e.g. 09:00, 17:00' }),
        field({ id: 'auPostsPerDay', label: 'Posts per active day', type: 'number', value: '1' }),
        selectField({ id: 'auRhythm', label: 'Weekly rhythm', options: RHYTHMS.map(([v, l]) => ({ value: v, label: l })), value: 'balanced' }),
      ]),
      el('div', { className: 'grid grid-3' }, [
        selectField({ id: 'auMode', label: 'Mode', options: MODES.map(([v, l]) => ({ value: v, label: l })), value: 'review' }),
        selectField({ id: 'auMissed', label: 'Missed-post policy', options: MISSED.map(([v, l]) => ({ value: v, label: l })), value: 'skip' }),
        field({ id: 'auEndDate', label: 'End date (optional)', type: 'date', hint: 'Blank = runs indefinitely.' }),
      ]),
      el('div', { className: 'grid grid-3' }, [
        field({ id: 'auHorizon', label: 'Generate ahead (days)', type: 'number', value: '14' }),
        field({ id: 'auMinReady', label: 'Minimum ready days', type: 'number', value: '7' }),
        field({ id: 'auLowBuffer', label: 'Low-buffer warning (days)', type: 'number', value: '3' }),
      ]),
      el('div', { className: 'row', attrs: { style: 'gap:.5rem' } }, [
        (() => { const b = el('button', { className: 'btn btn-primary', text: 'Review and create', attrs: { type: 'button' } }); b.addEventListener('click', () => submit(b)); return b; })(),
        (() => { const b = el('button', { className: 'btn btn-secondary', text: 'Cancel', attrs: { type: 'button' } }); b.addEventListener('click', () => { formHost.textContent = ''; }); return b; })(),
      ]),
    ]);
    formHost.appendChild(formCard);

    function collect() {
      return {
        name: val('auName') || null,
        selectedPlatforms: selectedPlatforms(),
        selectedAccountIds: [...accountHost.querySelectorAll('input:checked')].map((i) => i.value),
        timezone: val('auTimezone').trim(),
        selectedWeekdays: [...weekdayHost.querySelectorAll('input:checked')].map((i) => Number(i.value)),
        postingTimes: val('auTimes').split(',').map((t) => t.trim()).filter(Boolean),
        postsPerDay: Number(val('auPostsPerDay')) || 1,
        rhythmKey: val('auRhythm'),
        mode: val('auMode'),
        missedPostPolicy: val('auMissed'),
        endDate: val('auEndDate') || null,
        generationHorizonDays: Number(val('auHorizon')) || 14,
        minimumReadyDays: Number(val('auMinReady')) || 7,
        lowBufferDays: Number(val('auLowBuffer')) || 3,
      };
    }

    async function submit(btn) {
      const cfg = collect();
      const acctLabels = cfg.selectedAccountIds.map((id) => {
        const a = accounts.find((x) => String(x.id) === String(id));
        return a ? (a.displayName || a.username) : id;
      });
      const summary = [
        `Platforms: ${cfg.selectedPlatforms.map((p) => PLATFORM_LABELS[p] || p).join(', ') || '(none)'}`,
        `Accounts: ${acctLabels.join(', ') || '(none)'}`,
        `Timezone: ${cfg.timezone}`,
        `Weekdays: ${cfg.selectedWeekdays.map((d) => WEEKDAYS.find(([n]) => n === d)?.[1]).join(', ')}`,
        `Times: ${cfg.postingTimes.join(', ')}  ·  ${cfg.postsPerDay}/day`,
        `Rhythm: ${cfg.rhythmKey}  ·  Mode: ${cfg.mode}`,
        `End date: ${cfg.endDate || 'no end date'}`,
        `Generate ${cfg.generationHorizonDays} days ahead · keep ${cfg.minimumReadyDays} ready · warn below ${cfg.lowBufferDays}`,
      ].join('\n');
      const ok = await confirmModal({ title: 'Create this automation?', message: summary, confirmText: 'Create automation' });
      if (!ok) return;
      setLoading(btn, true, 'Creating…');
      try {
        const res = await api.apiRequest('/api/automations', { method: 'POST', body: cfg });
        if (!res.ok) { toast(api.errorMessage(res, 'Please check the automation settings.'), 'err'); return; }
        toast('Automation created as a draft. Activate it to start preparing content.', 'ok');
        formHost.textContent = '';
        await reload();
      } finally { setLoading(btn, false); }
    }
  }

  // --- list ----------------------------------------------------------------
  async function reload() {
    listHost.textContent = '';
    const res = await api.apiRequest('/api/automations');
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    const list = api.payload(res)?.automations || [];
    if (!list.length) {
      listHost.appendChild(emptyState({ title: 'No automations yet', subtitle: 'Create one to keep a rolling buffer of prepared posts.' }));
      return;
    }
    for (const a of list) listHost.appendChild(renderCard(a));
  }

  function renderCard(a) {
    const actions = el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap' } });
    const act = (label, path, opts = {}) => {
      const b = el('button', { className: `btn btn-sm ${opts.danger ? 'btn-danger' : 'btn-secondary'}`, text: label, attrs: { type: 'button' } });
      b.addEventListener('click', async () => {
        if (opts.confirm) { const ok = await confirmModal(opts.confirm); if (!ok) return; }
        setLoading(b, true, '…');
        try {
          const res = await api.apiRequest(path, { method: 'POST', body: opts.body });
          if (!res.ok) { toast(api.errorMessage(res, 'That action could not be completed.'), 'err'); return; }
          toast(opts.done || 'Done.', 'ok');
          await reload();
        } finally { setLoading(b, false); }
      });
      return b;
    };

    if (a.status === 'draft') actions.appendChild(act('Activate', `/api/automations/${a.id}/activate`, { done: 'Automation activated.' }));
    if (a.status === 'active' || a.status === 'attention_needed') {
      actions.appendChild(act('Pause', `/api/automations/${a.id}/pause`, { done: 'Paused.' }));
      actions.appendChild(act('Refill now', `/api/automations/${a.id}/refill`, { done: 'Refill queued.' }));
    }
    if (a.status === 'paused' || a.status === 'attention_needed') actions.appendChild(act('Resume', `/api/automations/${a.id}/resume`, { done: 'Resumed.' }));
    if (a.status !== 'stopped') {
      actions.appendChild(act('Stop', `/api/automations/${a.id}/stop`, {
        danger: true, body: { confirm: 'STOP' }, done: 'Stopped.',
        confirm: { title: 'Stop this automation?', message: 'Future preparation stops and pending jobs are cancelled. Prepared posts remain visible. This cannot be undone.', confirmText: 'Stop', danger: true },
      }));
    }
    if (a.plannerRunId) {
      actions.appendChild(el('a', { className: 'btn btn-ghost btn-sm', text: 'View upcoming', attrs: { href: `/planner/week?run=${encodeURIComponent(a.plannerRunId)}`, 'data-link': '' } }));
    }

    const meta = el('div', { className: 'stack', attrs: { style: 'gap:.15rem' } }, [
      el('div', { className: 'card-sub', text: `${(a.selectedPlatforms || []).map((p) => PLATFORM_LABELS[p] || p).join(', ')} · ${a.selectedAccountIds?.length || 0} account(s) · ${a.timezone}` }),
      el('div', { className: 'card-sub', text: `Mode: ${a.mode} · Ready buffer: ${a.readyBufferDays ?? 0} day(s)${a.bufferLow ? ' (low)' : ''}` }),
      el('div', { className: 'card-sub', text: `Next post: ${a.nextPost ? `${a.nextPost.localDate} ${a.nextPost.localTime}` : 'none prepared yet'}` }),
      el('div', { className: 'card-sub', text: `Prepared through: ${a.generatedThroughDate || '—'} · Next refill: ${a.nextRefillAt ? formatDate(a.nextRefillAt) : '—'}` }),
    ]);

    const children = [
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: a.name || 'Untitled automation' }),
        badge(a.status.replace('_', ' '), STATUS_TONE[a.status] || 'neutral'),
      ]),
      meta,
    ];
    if (a.status === 'attention_needed' && a.attentionReason) children.push(notice(a.attentionReason, 'err'));
    children.push(actions);
    return card(children);
  }

  await reload();
}
