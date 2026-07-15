/**
 * New plan wizard.
 *
 * Everything defaults from saved preferences, so the fast path is "click
 * Generate". The controls are here for the user who wants to override this run
 * only — overrides are passed to the generate call, not written back to
 * preferences, so a one-off experiment does not silently change the defaults.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, notice, toast, field, selectField, val,
  setLoading, setFieldError, clearFieldErrors, steps,
} from '../ui.js';
import { PROVIDER_LABELS } from '../icons.js';

const PLAN_LENGTHS = [
  ['3', '3 days'], ['5', '5 days'], ['7', '7 days'], ['14', '14 days'],
];
const CADENCES = [
  ['every_day', 'Every day'],
  ['weekdays', 'Weekdays only'],
  ['selected_weekdays', 'Selected weekdays'],
];
const WEEKDAYS = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun'],
];
const APPROVAL_MODES = [
  ['require_approval', 'Review each post before it is queued'],
  ['auto_queue', 'Approve automatically (flagged posts still wait for review)'],
];

function opts(list) {
  return list.map(([value, label]) => ({ value, label }));
}

function checkbox(id, label, checked, extraAttrs = {}) {
  const input = el('input', { attrs: { type: 'checkbox', id, 'aria-label': label, ...extraAttrs } });
  input.checked = Boolean(checked);
  return el('label', { className: 'choice-inline', attrs: { for: id } }, [input, el('span', { text: label })]);
}

/** Today in the browser's timezone, as YYYY-MM-DD. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function render(root, ctx) {
  const [prefs, accountsRes] = await Promise.all([
    api.plannerPreferences(),
    api.apiRequest('/api/social-accounts'),
  ]);
  if (accountsRes.unauthorized) { ctx.navigate('/login'); return; }
  const accounts = (api.payload(accountsRes)?.accounts || []).filter((a) => a.status === 'active');
  const availablePlatforms = [...new Set(accounts.map((a) => ({
    facebook_page: 'facebook', instagram_professional: 'instagram', threads_profile: 'threads',
  }[a.accountType])).filter(Boolean))];

  const tz = prefs?.timezone || (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  })();

  const page = el('div', { className: 'page' }, [
    pageHead('Generate a plan', 'Confirm the shape of the plan. You review every post before anything is queued.'),
    steps(1, 3, ['Set up the plan', 'Review the posts', 'Queue the approved ones']),
  ]);

  if (availablePlatforms.length === 0) {
    page.appendChild(el('div', { className: 'notice notice-warn' }, [
      el('div', {}, [
        el('strong', { text: 'Connect an account first' }),
        el('p', { text: 'The planner needs at least one connected Facebook Page, Instagram Professional account, or Threads profile.' }),
      ]),
      el('span', { className: 'spacer' }),
      el('a', { className: 'btn btn-primary btn-sm', text: 'Connect', attrs: { href: '/connections', 'data-link': '' } }),
    ]));
    root.appendChild(page);
    return;
  }

  // --- schedule ------------------------------------------------------------
  const weekdayHost = el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap' } },
    WEEKDAYS.map(([n, label]) =>
      checkbox(`wd-${n}`, label, (prefs?.weekdays || [1, 2, 3, 4, 5]).includes(n), { 'data-weekday': String(n) })));
  const weekdayField = el('div', { className: 'field', attrs: { id: 'weekday-field' } }, [
    el('span', { className: 'label', text: 'Which days?' }),
    weekdayHost,
  ]);

  const cadenceSelect = selectField({
    id: 'cadence', label: 'How often', options: opts(CADENCES),
    value: prefs?.cadence === 'custom' ? 'selected_weekdays' : (prefs?.cadence || 'every_day'),
  });

  const timesHost = el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap' } },
    ['08:00', '09:00', '12:00', '17:00', '19:00'].map((t) =>
      checkbox(`time-${t.replace(':', '')}`, t, (prefs?.times || ['09:00']).includes(t), { 'data-time': t })));

  const scheduleCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: '1. When' })]),
    el('div', { className: 'grid grid-3' }, [
      selectField({ id: 'planLength', label: 'Plan length', options: opts(PLAN_LENGTHS), value: String(prefs?.defaultPlanLength ?? 7) }),
      field({ id: 'startDate', label: 'Start date', type: 'date', value: today() }),
      field({ id: 'timezone', label: 'Timezone', value: tz, hint: 'Times are local to this zone.' }),
    ]),
    cadenceSelect,
    weekdayField,
    el('div', { className: 'field' }, [
      el('span', { className: 'label', text: 'Posting times' }),
      timesHost,
      el('p', { className: 'hint', text: 'Pick one for a daily post, or several for multiple posts a day.' }),
    ]),
  ]);

  // Weekday choice only matters for selected_weekdays.
  const cadenceInput = cadenceSelect.querySelector('#cadence');
  const syncWeekdays = () => { weekdayField.hidden = cadenceInput.value !== 'selected_weekdays'; };
  cadenceInput.addEventListener('change', syncWeekdays);

  // --- platforms -----------------------------------------------------------
  const platformHost = el('div', { className: 'row', attrs: { style: 'gap:.5rem;flex-wrap:wrap' } },
    availablePlatforms.map((p) =>
      checkbox(`pf-${p}`, PROVIDER_LABELS[p] || p,
        !prefs?.platforms?.length || prefs.platforms.includes(p),
        { 'data-platform': p })));

  const platformCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: '2. Where' })]),
    platformHost,
    el('p', { className: 'hint', text: 'Only accounts you have connected are listed.' }),
  ]);

  // --- approval ------------------------------------------------------------
  const approvalCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: '3. Approval' })]),
    selectField({
      id: 'approvalMode', label: 'Before queueing', options: opts(APPROVAL_MODES),
      value: prefs?.approvalMode || 'require_approval',
    }),
    field({ id: 'name', label: 'Plan name', hint: 'Optional. Defaults to the date range.' }),
    el('p', { className: 'hint', text: 'Content mix, goals and tone come from your planner settings.' }),
    el('a', { className: 'btn btn-ghost btn-sm', text: 'Edit planner settings', attrs: { href: '/settings', 'data-link': '' } }),
  ]);

  // --- generate ------------------------------------------------------------
  const generateBtn = el('button', { className: 'btn btn-primary', text: 'Generate plan', attrs: { type: 'button' } });
  const statusHost = el('div', {});

  generateBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    statusHost.textContent = '';

    const platforms = [...platformHost.querySelectorAll('input[data-platform]')]
      .filter((i) => i.checked).map((i) => i.getAttribute('data-platform'));
    if (platforms.length === 0) {
      statusHost.appendChild(notice('Choose at least one platform.', 'err'));
      return;
    }
    const times = [...timesHost.querySelectorAll('input[data-time]')]
      .filter((i) => i.checked).map((i) => i.getAttribute('data-time'));
    if (times.length === 0) {
      statusHost.appendChild(notice('Choose at least one posting time.', 'err'));
      return;
    }
    const weekdays = [...weekdayHost.querySelectorAll('input[data-weekday]')]
      .filter((i) => i.checked).map((i) => Number(i.getAttribute('data-weekday')));

    const body = {
      name: val('name') || null,
      startDate: val('startDate') || null,
      planLength: Number(val('planLength')),
      cadence: val('cadence'),
      weekdays,
      times,
      platforms,
      timezone: val('timezone').trim(),
      approvalMode: val('approvalMode'),
    };

    setLoading(generateBtn, true, 'Generating…');
    // Honest about the wait: this is many model + render calls.
    statusHost.appendChild(notice(
      `Writing and rendering ${body.planLength} days of posts. This can take a minute — please keep this page open.`,
      'info',
    ));
    try {
      const res = await api.apiRequest('/api/planner/plans', { method: 'POST', body });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        statusHost.textContent = '';
        const errors = api.fieldErrors(res);
        for (const [f, message] of Object.entries(errors)) setFieldError(f, message);
        statusHost.appendChild(notice(api.errorMessage(res, 'The plan could not be generated. Please try again.'), 'err'));
        return;
      }
      const plan = api.payload(res);
      toast('Plan generated.', 'ok');
      ctx.navigate(`/planner/week?run=${encodeURIComponent(plan.run.id)}`);
    } finally {
      setLoading(generateBtn, false);
    }
  });

  page.append(
    scheduleCard,
    platformCard,
    approvalCard,
    el('div', { className: 'row', attrs: { style: 'gap:.5rem' } }, [generateBtn]),
    statusHost,
    notice('Generating a plan uses your daily generation allowance: one caption and one image per post. Nothing is published.', 'info'),
  );

  root.appendChild(page);
  syncWeekdays();
}
