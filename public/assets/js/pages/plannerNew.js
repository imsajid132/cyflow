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
  setLoading, setFieldError, clearFieldErrors, steps, clear,
} from '../ui.js';
import { PROVIDER_LABELS } from '../icons.js';
import { timezonePicker } from '../components/timezonePicker.js';

const PLAN_LENGTHS = [
  ['3', '3 days'], ['5', '5 days'], ['7', '7 days'], ['14', '14 days'],
];
const POSTS_PER_DAY = [
  ['1', '1 post per day'], ['2', '2 posts per day'], ['3', '3 posts per day'],
  ['4', '4 posts per day'], ['5', '5 posts per day'],
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
  const [prefs, accountsRes, rhythm] = await Promise.all([
    api.plannerPreferences(),
    api.apiRequest('/api/social-accounts'),
    api.plannerRhythm(),
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

  const tzPicker = timezonePicker({
    id: 'timezone',
    label: 'Timezone',
    value: tz,
    forDate: today(),
    hint: 'Your posting times are local to this zone.',
  });

  /*
   * --- Weekly content rhythm ------------------------------------------------
   *
   * The strategy preview. The planner decides what each post is FOR from the
   * real calendar weekday, and showing that before generating is the difference
   * between a plan with reasoning and a plan that merely appears to have some.
   * Everything here comes from the server's resolved rhythm; nothing is guessed
   * client-side, so the preview cannot drift from what generation will do.
   */
  const rhythmHost = el('div', { className: 'rhythm-week', attrs: { id: 'rhythm-week', 'aria-live': 'polite' } });
  const rhythmSelect = selectField({
    id: 'contentRhythmPreset',
    label: 'Weekly rhythm',
    options: (rhythm?.presets || []).map((p) => ({ label: p.label, value: p.key })),
    value: rhythm?.preset || 'balanced',
    hint: 'Each weekday carries a strategy. Posts follow the real calendar day.',
  });

  function paintRhythm(data) {
    rhythmHost.textContent = '';
    if (!data?.weekdays?.length) {
      rhythmHost.appendChild(el('p', { className: 'hint', text: 'The weekly rhythm could not be loaded.' }));
      return;
    }
    for (const day of data.weekdays) {
      rhythmHost.appendChild(el('div', {
        className: `rhythm-day${day.enabled ? '' : ' is-off'}`,
      }, [
        el('span', { className: 'rhythm-day-name', text: day.label }),
        el('span', { className: 'rhythm-day-pillar', text: day.enabled ? day.pillarLabel : 'No posts' }),
      ]));
    }
  }
  paintRhythm(rhythm);

  rhythmSelect.querySelector('#contentRhythmPreset')?.addEventListener('change', async (e) => {
    const next = await api.plannerRhythm({ preset: e.target.value });
    paintRhythm(next);
  });

  const rhythmCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: '2. Weekly rhythm' })]),
    rhythmSelect,
    rhythmHost,
  ]);

  const scheduleCard = card([
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: '1. When' })]),
    el('div', { className: 'grid grid-3' }, [
      selectField({ id: 'planLength', label: 'Plan length', options: opts(PLAN_LENGTHS), value: String(prefs?.defaultPlanLength ?? 7) }),
      field({ id: 'startDate', label: 'Start date', type: 'date', value: today() }),
      selectField({
        id: 'postsPerDay',
        label: 'Posts per active day',
        options: opts(POSTS_PER_DAY),
        value: String(prefs?.postsPerDay ?? 1),
        hint: 'Each active day gets exactly this many posts.',
      }),
    ]),
    tzPicker.node,
    cadenceSelect,
    weekdayField,
    el('div', { className: 'field' }, [
      el('span', { className: 'label', text: 'Posting times' }),
      timesHost,
      el('p', { className: 'hint', text: 'Select at least as many times as posts per day. Extra times are not used.' }),
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

  // --- summary + generate --------------------------------------------------
  const generateBtn = el('button', { className: 'btn btn-primary', text: 'Generate plan', attrs: { type: 'button' } });
  const statusHost = el('div', {});
  const summaryHost = el('div', { className: 'plan-summary', attrs: { role: 'status', 'aria-live': 'polite' } });

  /** Read the whole form. One place, used by both the summary and generation. */
  function collect() {
    return {
      name: val('name') || null,
      startDate: val('startDate') || null,
      planLength: Number(val('planLength')),
      postsPerDay: Number(val('postsPerDay')),
      cadence: val('cadence'),
      weekdays: [...weekdayHost.querySelectorAll('input[data-weekday]')]
        .filter((i) => i.checked).map((i) => Number(i.getAttribute('data-weekday'))),
      times: [...timesHost.querySelectorAll('input[data-time]')]
        .filter((i) => i.checked).map((i) => i.getAttribute('data-time')),
      platforms: [...platformHost.querySelectorAll('input[data-platform]')]
        .filter((i) => i.checked).map((i) => i.getAttribute('data-platform')),
      timezone: tzPicker.getValue(),
      approvalMode: val('approvalMode'),
      // The rhythm the user chose HERE wins over their saved default.
      contentRhythmPreset: val('contentRhythmPreset') || null,
    };
  }

  let lastSummary = null;

  /**
   * Ask the server what this configuration would produce, and say it plainly.
   * Generation stays disabled until it validates, so the count is never a
   * surprise.
   */
  async function refreshSummary() {
    const body = collect();
    const res = await api.plannerSummary(body);
    if (!res.ok) {
      lastSummary = null;
      generateBtn.disabled = true;
      clear(summaryHost);
      summaryHost.appendChild(notice(api.errorMessage(res, 'This plan could not be checked.'), 'err'));
      return;
    }
    const summary = api.payload(res).summary;
    lastSummary = summary;
    generateBtn.disabled = !summary.valid;

    clear(summaryHost);
    const platformNames = summary.platforms.map((p) => PROVIDER_LABELS[p] || p);
    const timeList = summary.timesUsed.join(' and ');

    summaryHost.appendChild(el('div', { className: 'plan-summary-main' }, [
      el('strong', {
        text: `${summary.activeDays} active day${summary.activeDays === 1 ? '' : 's'} × ${summary.postsPerDay} post${summary.postsPerDay === 1 ? '' : 's'} per day = ${summary.plannedPosts} post${summary.plannedPosts === 1 ? '' : 's'}.`,
      }),
      platformNames.length
        ? el('p', {
            text: `Posts will be created for ${platformNames.join(' and ')} at ${timeList} in ${summary.timezone}.`,
          })
        : null,
    ]));

    // The maths and the reality can differ when a slot has already passed.
    if (summary.valid && summary.totalPosts !== summary.plannedPosts) {
      summaryHost.appendChild(notice(
        `${summary.skippedPast} time slot${summary.skippedPast === 1 ? ' has' : 's have'} already passed today, so ${summary.totalPosts} post${summary.totalPosts === 1 ? '' : 's'} will actually be created.`,
        'warn',
      ));
    }
    for (const error of summary.errors) {
      setFieldError(error.field, error.message);
      summaryHost.appendChild(notice(error.message, 'err'));
    }
  }

  let summaryDebounce = null;
  function scheduleSummary() {
    clearTimeout(summaryDebounce);
    summaryDebounce = setTimeout(refreshSummary, 200);
  }
  // Any control that changes the count re-checks it.
  page.addEventListener('change', scheduleSummary);
  // A new start date can change a DST offset, so the timezone label follows it.
  document.addEventListener('change', (e) => {
    if (e.target?.id === 'startDate') tzPicker.setDate(val('startDate'));
  });

  generateBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    statusHost.textContent = '';

    // Re-check immediately before spending: the form may have changed.
    await refreshSummary();
    if (!lastSummary?.valid) {
      statusHost.appendChild(notice('Fix the highlighted settings before generating.', 'err'));
      return;
    }

    const body = collect();
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
    rhythmCard,
    platformCard,
    approvalCard,
    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Before you generate' })]),
      summaryHost,
      el('div', { className: 'row', attrs: { style: 'gap:.5rem;margin-top:.7rem' } }, [generateBtn]),
      statusHost,
    ]),
    notice('Generating a plan uses your daily generation allowance: one post and one image per day. Nothing is published.', 'info'),
  );

  root.appendChild(page);
  syncWeekdays();
  // The summary is the gate, so it is computed before the button is usable.
  generateBtn.disabled = true;
  refreshSummary();
}
