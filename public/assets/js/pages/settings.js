/**
 * Settings — workspace defaults and an honest account overview.
 *
 * The content defaults live on the business profile (the same record the Brand
 * page edits), so this page writes through the existing business-profile API
 * rather than inventing a second store.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, badge, notice, toast, field, selectField, val,
  setLoading, setFieldError, clearFieldErrors, formatDate,
} from '../ui.js';
import { timezonePicker } from '../components/timezonePicker.js';

const TONES = ['neutral', 'friendly', 'professional', 'playful', 'bold', 'informative'];

const PLANNER_TONES = ['professional', 'friendly', 'confident', 'educational', 'promotional', 'mixed'];
const CADENCES = [
  ['every_day', 'Every day'],
  ['weekdays', 'Weekdays only'],
  ['selected_weekdays', 'Selected weekdays'],
];
const CTA_MODES = [
  ['always', 'Every post has a call to action'],
  ['some', 'About half of posts'],
  ['light', 'Roughly one in three'],
];
const APPROVAL_MODES = [
  ['require_approval', 'Review each post before it is queued'],
  ['auto_queue', 'Approve automatically after generation'],
];
const GOALS = [
  ['awareness', 'Awareness'], ['engagement', 'Engagement'], ['lead_generation', 'Lead generation'],
  ['education', 'Education'], ['service_promotion', 'Service promotion'],
  ['trust_building', 'Trust building'], ['offers', 'Offers'],
];
const MIX_TYPES = [
  ['educational', 'Educational'], ['tips', 'Tips'], ['authority', 'Authority'],
  ['promotional', 'Promotional'], ['cta', 'Call to action'], ['proof', 'Proof'],
  ['local', 'Local relevance'], ['comparison', 'Comparison'],
];
const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const TIME_CHOICES = ['08:00', '09:00', '12:00', '17:00', '19:00'];

function toOptions(pairs) {
  return pairs.map(([value, label]) => ({ value, label }));
}

function checkbox(id, label, checked, extraAttrs = {}) {
  const input = el('input', { attrs: { type: 'checkbox', id, 'aria-label': label, ...extraAttrs } });
  input.checked = Boolean(checked);
  return el('label', { className: 'choice-inline', attrs: { for: id } }, [input, el('span', { text: label })]);
}

export async function render(root, ctx) {
  const [profile, state, capsRes, prefs] = await Promise.all([
    api.businessProfile(),
    api.onboardingState(),
    api.apiRequest('/api/posts/capabilities'),
    api.plannerPreferences(),
  ]);
  if (capsRes.unauthorized) { ctx.navigate('/login'); return; }
  const caps = api.payload(capsRes) || {};

  const saveBtn = el('button', { className: 'btn btn-primary', text: 'Save defaults', attrs: { type: 'button' } });

  saveBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    setLoading(saveBtn, true, 'Saving…');
    try {
      const res = await api.apiRequest('/api/business-profile', {
        method: 'PUT',
        body: {
          defaultTone: val('defaultTone') || null,
          defaultLanguage: val('defaultLanguage').trim() || null,
          defaultCallToAction: val('defaultCallToAction').trim() || null,
        },
      });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        const errors = api.fieldErrors(res);
        for (const [f, message] of Object.entries(errors)) setFieldError(f, message);
        toast(api.errorMessage(res, 'Those defaults could not be saved.'), 'err');
        return;
      }
      toast('Defaults saved.', 'ok');
    } finally {
      setLoading(saveBtn, false);
    }
  });

  // --- planner preferences -------------------------------------------------
  const weekdayHost = el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap' } },
    WEEKDAYS.map(([n, label]) =>
      checkbox(`p-wd-${n}`, label, (prefs?.weekdays || [1, 2, 3, 4, 5]).includes(n), { 'data-weekday': String(n) })));
  const timesHost = el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap' } },
    TIME_CHOICES.map((t) =>
      checkbox(`p-t-${t.replace(':', '')}`, t, (prefs?.times || ['09:00']).includes(t), { 'data-time': t })));
  const goalHost = el('div', { className: 'row', attrs: { style: 'gap:.4rem;flex-wrap:wrap' } },
    GOALS.map(([value, label]) =>
      checkbox(`p-goal-${value}`, label, (prefs?.goals || ['awareness', 'engagement', 'education']).includes(value), { 'data-goal': value })));
  const mixHost = el('div', { className: 'grid grid-4' },
    MIX_TYPES.map(([value, label]) =>
      field({
        id: `p-mix-${value}`,
        label,
        type: 'number',
        value: String(prefs?.contentMix?.[value] ?? ''),
        attrs: { min: 0, max: 10, step: 1, 'data-mix': value, placeholder: '0' },
      })));

  const autopilotBox = checkbox('p-autopilot', 'Prepare a weekly plan automatically', prefs?.autopilotEnabled);

  // The full IANA catalogue, defaulting to the user's own profile timezone.
  const tzPicker = timezonePicker({
    id: 'plannerTimezone',
    label: 'Planner timezone',
    value: prefs?.timezone || ctx.user?.timezone || 'UTC',
    hint: 'Used for your posting times. Defaults to your profile timezone.',
  });

  const savePlannerBtn = el('button', { className: 'btn btn-primary', text: 'Save planner settings', attrs: { type: 'button' } });
  savePlannerBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    setLoading(savePlannerBtn, true, 'Saving…');
    try {
      const contentMix = {};
      for (const input of mixHost.querySelectorAll('input[data-mix]')) {
        const raw = input.value.trim();
        if (raw === '') continue;
        contentMix[input.getAttribute('data-mix')] = Number(raw);
      }
      const body = {
        cadence: val('plannerCadence'),
        weekdays: [...weekdayHost.querySelectorAll('input[data-weekday]')]
          .filter((i) => i.checked).map((i) => Number(i.getAttribute('data-weekday'))),
        times: [...timesHost.querySelectorAll('input[data-time]')]
          .filter((i) => i.checked).map((i) => i.getAttribute('data-time')),
        goals: [...goalHost.querySelectorAll('input[data-goal]')]
          .filter((i) => i.checked).map((i) => i.getAttribute('data-goal')),
        tone: val('plannerTone'),
        ctaMode: val('plannerCtaMode'),
        approvalMode: val('plannerApprovalMode'),
        defaultPlanLength: Number(val('plannerPlanLength')),
        postsPerDay: Number(val('plannerPostsPerDay')),
        // The canonical IANA id, never an offset.
        timezone: tzPicker.getValue(),
        autopilotEnabled: document.getElementById('p-autopilot')?.checked ?? false,
      };
      if (Object.keys(contentMix).length) body.contentMix = contentMix;

      const res = await api.apiRequest('/api/planner/preferences', { method: 'PUT', body });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        const errors = api.fieldErrors(res);
        for (const [f, message] of Object.entries(errors)) setFieldError(f, message);
        toast(api.errorMessage(res, 'Those planner settings could not be saved.'), 'err');
        return;
      }
      toast('Planner settings saved.', 'ok');
    } finally {
      setLoading(savePlannerBtn, false);
    }
  });

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Settings', 'Defaults Cyflow applies when you create a new post.'),

    card([
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: 'Auto planner' }),
        el('a', { className: 'btn btn-ghost btn-sm', text: 'Open planner', attrs: { href: '/planner', 'data-link': '' } }),
      ]),
      el('p', { className: 'card-sub', text: 'How your weekly plans are built. You can override any of this each time you generate.' }),
      el('div', { className: 'grid grid-3' }, [
        selectField({ id: 'plannerCadence', label: 'Cadence', options: toOptions(CADENCES), value: prefs?.cadence === 'custom' ? 'selected_weekdays' : (prefs?.cadence || 'every_day') }),
        selectField({ id: 'plannerPlanLength', label: 'Default plan length', options: [3, 5, 7, 14].map((n) => ({ value: String(n), label: `${n} days` })), value: String(prefs?.defaultPlanLength ?? 7) }),
        selectField({
          id: 'plannerPostsPerDay',
          label: 'Posts per active day',
          options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} post${n === 1 ? '' : 's'}` })),
          value: String(prefs?.postsPerDay ?? 1),
          hint: 'Select at least this many posting times.',
        }),
      ]),
      el('div', { className: 'grid grid-2' }, [
        selectField({ id: 'plannerTone', label: 'Tone', options: PLANNER_TONES.map((t) => ({ value: t, label: t })), value: prefs?.tone || 'professional' }),
        tzPicker.node,
      ]),
      el('div', { className: 'field' }, [
        el('span', { className: 'label', text: 'Days (used when cadence is "selected weekdays")' }),
        weekdayHost,
      ]),
      el('div', { className: 'field' }, [
        el('span', { className: 'label', text: 'Posting times' }),
        timesHost,
      ]),
      el('div', { className: 'field' }, [
        el('span', { className: 'label', text: 'Content goals' }),
        goalHost,
      ]),
      el('div', { className: 'field' }, [
        el('span', { className: 'label', text: 'Content mix' }),
        el('p', { className: 'hint', text: 'Relative weights, 0–10. Leave blank to use the balanced default. A weight of 3 appears three times as often as a weight of 1.' }),
        mixHost,
      ]),
      el('div', { className: 'grid grid-2' }, [
        selectField({ id: 'plannerCtaMode', label: 'Calls to action', options: toOptions(CTA_MODES), value: prefs?.ctaMode || 'some' }),
        selectField({ id: 'plannerApprovalMode', label: 'Approval', options: toOptions(APPROVAL_MODES), value: prefs?.approvalMode || 'require_approval' }),
      ]),
      el('div', { className: 'field' }, [
        el('span', { className: 'label', text: 'Autopilot' }),
        autopilotBox,
        // Honest: the flag is stored, but no job runs and nothing publishes.
        el('p', { className: 'hint', text: 'This saves your preference and a target date. Automatic weekly generation is not running yet, and Cyflow never sends a post to a provider on its own — you still generate and queue by hand.' }),
      ]),
      el('div', { className: 'row' }, [savePlannerBtn]),
    ]),

    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Content defaults' })]),
      el('p', { className: 'card-sub', text: 'These prefill the Create Post form. You can override any of them per post.' }),
      el('div', { className: 'grid grid-3' }, [
        selectField({ id: 'defaultTone', label: 'Default tone', options: TONES, value: profile?.defaultTone || 'neutral' }),
        field({ id: 'defaultLanguage', label: 'Default language', value: profile?.defaultLanguage || '',
          hint: 'For example: English, Urdu, Spanish.' }),
        field({ id: 'defaultCallToAction', label: 'Default call to action', value: profile?.defaultCallToAction || '' }),
      ]),
      el('div', { className: 'row' }, [saveBtn]),
    ]),

    card([
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: 'Business setup' }),
        badge(state?.needsOnboarding ? 'Incomplete' : 'Complete', state?.needsOnboarding ? 'warn' : 'ok'),
      ]),
      el('p', { className: 'card-sub', text: profile?.businessName
        ? `Branding is applied from ${profile.businessName}.`
        : 'Add your business details so captions and images match your brand.' }),
      profile?.onboardingCompletedAt
        ? el('p', { className: 'hint', text: `Completed ${formatDate(profile.onboardingCompletedAt)}` })
        : null,
      el('div', { className: 'row', attrs: { style: 'gap:.5rem;margin-top:.6rem' } }, [
        el('a', { className: 'btn btn-secondary btn-sm', text: 'Edit brand', attrs: { href: '/brand', 'data-link': '' } }),
        state?.needsOnboarding
          ? el('a', { className: 'btn btn-primary btn-sm', text: 'Complete setup', attrs: { href: '/onboarding/business', 'data-link': '' } })
          : null,
      ]),
    ]),

    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Usage today' })]),
      typeof caps.generations?.usedToday === 'number'
        ? el('p', { text: `${caps.generations.usedToday} of ${caps.generations.dailyLimit} generations used in the last 24 hours.` })
        : el('p', { className: 'hint', text: 'Usage is unavailable right now.' }),
      el('p', { className: 'hint', text: 'Post copy and image generations each count towards this limit.' }),
    ]),

    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Account' })]),
      el('p', { className: 'card-sub', text: 'Your name, email, timezone, and password live on the Profile page.' }),
      el('a', { className: 'btn btn-secondary btn-sm', text: 'Open profile', attrs: { href: '/profile', 'data-link': '', style: 'margin-top:.6rem' } }),
    ]),

    notice('Cyflow generates and schedules content. It does not publish to Facebook, Instagram, or Threads yet — that arrives in a later phase.', 'info'),
  ]));
}
