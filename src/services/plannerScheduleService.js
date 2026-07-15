/**
 * Planner schedule engine — turns preferences into concrete UTC slots.
 *
 * This is deliberately separate from generation: deciding WHEN posts go out is
 * pure date arithmetic with no OpenAI, no database and no I/O, which makes the
 * cadence/timezone rules directly testable.
 *
 * Everything is computed in the user's own timezone and then converted to a UTC
 * instant via `zonedWallTimeToUtc`, so a 09:00 slot stays 09:00 local across a
 * DST boundary rather than drifting an hour.
 */

import {
  PLANNER_CADENCES,
  PLANNER_WEEKDAYS,
  PLANNER_LIMITS,
} from '../config/constants.js';
import { zonedWallTimeToUtc, isValidTimezone, toMysqlUtc } from '../utils/time.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parse "HH:MM" into {hour, minute}, or null. */
export function parseTime(value) {
  if (typeof value !== 'string') return null;
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Normalize, de-duplicate and sort posting times; falls back to a sane default. */
export function normalizeTimes(times) {
  const list = Array.isArray(times) ? times : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const parsed = parseTime(raw);
    if (!parsed) continue;
    const key = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= PLANNER_LIMITS.MAX_TIMES_PER_DAY) break;
  }
  if (out.length === 0) return ['09:00'];
  return out.sort();
}

/** ISO weekday (Mon=1..Sun=7) for a UTC-midnight date. */
function isoWeekday(date) {
  const day = date.getUTCDay(); // Sun=0
  return day === 0 ? 7 : day;
}

/** Normalize a weekday selection to unique, sorted ISO weekday numbers. */
export function normalizeWeekdays(weekdays) {
  const list = Array.isArray(weekdays) ? weekdays : [];
  const out = [...new Set(list.map(Number).filter((d) => PLANNER_WEEKDAYS.includes(d)))];
  return out.sort((a, b) => a - b);
}

/**
 * Which ISO weekdays a cadence posts on.
 * `selected_weekdays` and `custom` both honour the user's explicit selection;
 * an empty selection falls back to every day rather than producing nothing.
 */
export function weekdaysForCadence(cadence, selectedWeekdays) {
  const selected = normalizeWeekdays(selectedWeekdays);
  switch (cadence) {
    case 'weekdays':
      return [1, 2, 3, 4, 5];
    case 'selected_weekdays':
    case 'custom':
      return selected.length ? selected : [...PLANNER_WEEKDAYS];
    case 'every_day':
    default:
      return [...PLANNER_WEEKDAYS];
  }
}

/** Add whole days to a UTC-midnight date without local-time drift. */
function addDaysUtc(date, days) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  ));
}

/** Parse "YYYY-MM-DD" as a UTC-midnight date. */
export function parseDateOnly(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Reject impossible dates that JS would silently roll over (e.g. 2026-02-31).
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Build the concrete slots for a plan.
 *
 * The plan window is `planLength` CALENDAR days from `startDate`. Cadence then
 * filters which of those days actually receive posts, so "7 days, weekdays
 * only" means "the next 7 days, of which the weekdays get posts" — not "the
 * next 7 weekdays". That matches how a week is reviewed on the board.
 *
 * @param {{ startDate?, planLength?, cadence?, weekdays?, times?, timezone?, now? }} input
 * @returns {{ slots: Array<{ localDate, localTime, weekday, scheduledForUtc, isPast }>,
 *             startDate, endDate, timezone, skippedPast:number }}
 */
export function buildSchedule(input = {}) {
  const timezone = isValidTimezone(input.timezone) ? input.timezone : 'UTC';
  const times = normalizeTimes(input.times);
  const cadence = PLANNER_CADENCES.includes(input.cadence) ? input.cadence : 'every_day';
  const activeWeekdays = weekdaysForCadence(cadence, input.weekdays);

  const planLength = Math.max(
    PLANNER_LIMITS.MIN_PLAN_LENGTH,
    Math.min(PLANNER_LIMITS.MAX_PLAN_LENGTH, Number(input.planLength) || 7),
  );

  /*
   * Posts per ACTIVE day is explicit and defaults to 1. It is never inferred
   * from how many times were selected: choosing three times and getting three
   * posts a day without asking for them is the bug this replaces. Extra times
   * are simply available slots; only the first `postsPerDay` of them are used.
   */
  const postsPerDay = Math.max(
    1,
    Math.min(PLANNER_LIMITS.MAX_POSTS_PER_DAY, Number(input.postsPerDay) || 1),
  );
  const timesForDay = times.slice(0, postsPerDay);

  const nowInstant = input.now instanceof Date ? input.now : new Date();
  const start = parseDateOnly(input.startDate) || todayInZone(nowInstant, timezone);

  const slots = [];
  let skippedPast = 0;
  let activeDays = 0;

  for (let dayOffset = 0; dayOffset < planLength; dayOffset += 1) {
    const day = addDaysUtc(start, dayOffset);
    const weekday = isoWeekday(day);
    if (!activeWeekdays.includes(weekday)) continue;
    activeDays += 1;

    for (const time of timesForDay) {
      const { hour, minute } = parseTime(time);
      const scheduledForUtc = zonedWallTimeToUtc(
        {
          year: day.getUTCFullYear(),
          month: day.getUTCMonth() + 1,
          day: day.getUTCDate(),
          hour,
          minute,
        },
        timezone,
      );

      /*
       * A slot already in the past cannot be scheduled, so it is dropped rather
       * than generated: paying OpenAI and HCTI for a post that can never be
       * queued would be waste the user cannot see.
       */
      if (scheduledForUtc.getTime() <= nowInstant.getTime()) {
        skippedPast += 1;
        continue;
      }

      slots.push({
        localDate: formatDateOnly(day),
        localTime: time,
        weekday,
        scheduledForUtc: toMysqlUtc(scheduledForUtc),
        scheduledForInstant: scheduledForUtc,
      });

      if (slots.length >= PLANNER_LIMITS.MAX_ITEMS_PER_RUN) break;
    }
    if (slots.length >= PLANNER_LIMITS.MAX_ITEMS_PER_RUN) break;
  }

  const endDate = addDaysUtc(start, Math.max(0, planLength - 1));

  return {
    slots,
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(endDate),
    timezone,
    cadence,
    times,
    // The times actually used, which is what the summary must show.
    timesUsed: timesForDay,
    weekdays: activeWeekdays,
    postsPerDay,
    activeDays,
    skippedPast,
  };
}

/**
 * Describe a plan BEFORE it is generated, so the count is never a surprise.
 *
 * Pure and side-effect free: the wizard renders this and the service validates
 * against the same function, so what the user is shown is what they get.
 *
 * @returns {{ valid, errors, activeDays, postsPerDay, totalPosts, times, timesUsed,
 *             startDate, endDate, timezone, skippedPast }}
 */
export function summarizeSchedule(input = {}) {
  const schedule = buildSchedule(input);
  const errors = [];

  const requested = Math.max(1, Number(input.postsPerDay) || 1);
  if (requested > PLANNER_LIMITS.MAX_POSTS_PER_DAY) {
    errors.push({
      field: 'postsPerDay',
      message: `Choose at most ${PLANNER_LIMITS.MAX_POSTS_PER_DAY} posts per day`,
    });
  }
  /*
   * Not enough times is an ERROR, not something to paper over. Inventing a
   * posting time the user did not choose would put their content out at an hour
   * they never approved.
   */
  if (schedule.times.length < requested) {
    errors.push({
      field: 'times',
      message: `Select at least ${requested} posting time${requested === 1 ? '' : 's'} for ${requested} posts per day. You have selected ${schedule.times.length}.`,
    });
  }
  if (schedule.activeDays === 0) {
    errors.push({ field: 'weekdays', message: 'That combination of days produces no active days' });
  }
  if (schedule.slots.length === 0 && errors.length === 0) {
    errors.push({
      field: 'startDate',
      message: 'Every slot in that window has already passed. Choose a later start date.',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    activeDays: schedule.activeDays,
    postsPerDay: schedule.postsPerDay,
    // The count that will actually be created, after past slots are dropped.
    totalPosts: schedule.slots.length,
    // What the maths says, for the "N days x M per day = T posts" sentence.
    plannedPosts: schedule.activeDays * schedule.postsPerDay,
    times: schedule.times,
    timesUsed: schedule.timesUsed,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    timezone: schedule.timezone,
    cadence: schedule.cadence,
    weekdays: schedule.weekdays,
    skippedPast: schedule.skippedPast,
  };
}

/** "Today" as a UTC-midnight date representing the calendar day in `timezone`. */
export function todayInZone(instant, timezone) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return parseDateOnly(dtf.format(instant)) || new Date(Date.UTC(1970, 0, 1));
}

/**
 * When the next weekly plan should be generated, for autopilot preparation.
 * Nothing consumes this yet — no scheduler job reads it and nothing publishes.
 */
export function nextWeeklyRunAt(fromInstant = new Date()) {
  return toMysqlUtc(new Date(fromInstant.getTime() + 7 * 24 * 3600 * 1000));
}

export default {
  buildSchedule,
  summarizeSchedule,
  normalizeTimes,
  normalizeWeekdays,
  weekdaysForCadence,
  parseTime,
  parseDateOnly,
  formatDateOnly,
  todayInZone,
  nextWeeklyRunAt,
};
