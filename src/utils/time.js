/**
 * Time helpers. All internal timestamps are UTC.
 *
 * MySQL DATETIME columns are read/written as `YYYY-MM-DD HH:MM:SS` UTC strings
 * (the pool uses `dateStrings: true`), so these helpers convert between JS
 * `Date`s and that format without any local-timezone drift.
 */

/** Current time as a JS Date. */
export function now() {
  return new Date();
}

/** Current UTC time as an ISO-8601 string (e.g. for API responses). */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Format a Date (or ISO string) as a MySQL UTC DATETIME string.
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} `YYYY-MM-DD HH:MM:SS`
 */
export function toMysqlUtc(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError('toMysqlUtc received an invalid date');
  }
  // ISO is always UTC ("...Z"); take the date+time portion.
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Parse a MySQL UTC DATETIME string into a JS Date (treated as UTC).
 * @param {string} value `YYYY-MM-DD HH:MM:SS`
 * @returns {Date}
 */
export function fromMysqlUtc(value) {
  if (typeof value !== 'string') {
    throw new TypeError('fromMysqlUtc expects a string');
  }
  // Append 'Z' so it is parsed as UTC, not local time.
  const iso = `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError('fromMysqlUtc received an unparseable value');
  }
  return d;
}

/**
 * Return a UTC DATETIME string `minutes` from `base`.
 * @param {number} minutes
 * @param {Date} [base=new Date()]
 * @returns {string}
 */
export function addMinutesUtc(minutes, base = new Date()) {
  return toMysqlUtc(new Date(base.getTime() + minutes * 60_000));
}

/**
 * Return a UTC DATETIME string `seconds` from `base`.
 * @param {number} seconds
 * @param {Date} [base=new Date()]
 * @returns {string}
 */
export function addSecondsUtc(seconds, base = new Date()) {
  return toMysqlUtc(new Date(base.getTime() + seconds * 1000));
}

/**
 * Offset (ms) of a timezone at a given instant: how far ahead of UTC the zone
 * is. local = utc + offset.
 */
export function tzOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtcFromZone = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtcFromZone - date.getTime();
}

/**
 * Convert a wall-clock time in a given IANA timezone to the UTC instant.
 * @param {{ year, month, day, hour, minute }} wall  month is 1-based
 * @param {string} timeZone
 * @returns {Date}
 */
export function zonedWallTimeToUtc(wall, timeZone) {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  const offset = tzOffsetMs(timeZone, new Date(guess));
  return new Date(guess - offset);
}

/** True if the given IANA timezone string is recognized by this runtime. */
export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    // Throws a RangeError for unknown zones.
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export default {
  now,
  nowIso,
  toMysqlUtc,
  fromMysqlUtc,
  addMinutesUtc,
  addSecondsUtc,
  isValidTimezone,
};
