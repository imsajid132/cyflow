/**
 * Timezone catalogue — every IANA zone this runtime supports.
 *
 * The list is taken from `Intl.supportedValuesOf('timeZone')` rather than being
 * hand-maintained, so it covers the world and stays correct as the runtime's
 * tzdata updates. A curated list of "popular" zones is exactly the bug this
 * replaces: it silently excludes most of the planet.
 *
 * Offsets are computed FOR A GIVEN DATE, because they are not properties of a
 * zone: Europe/London is UTC+00:00 in January and UTC+01:00 in July. Labelling
 * a zone with a fixed offset would be wrong for half the year.
 *
 * The canonical IANA id is what gets stored. The offset is display only.
 */

import { isValidTimezone, tzOffsetMs } from '../utils/time.js';

/** A conservative fallback for a runtime without `Intl.supportedValuesOf`. */
const FALLBACK_ZONES = Object.freeze([
  'UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'America/Anchorage', 'America/Argentina/Buenos_Aires', 'America/Bogota',
  'America/Chicago', 'America/Denver', 'America/Halifax', 'America/Los_Angeles',
  'America/Mexico_City', 'America/New_York', 'America/Phoenix', 'America/Sao_Paulo',
  'America/Toronto', 'Asia/Bangkok', 'Asia/Dhaka', 'Asia/Dubai', 'Asia/Hong_Kong',
  'Asia/Jakarta', 'Asia/Jerusalem', 'Asia/Kabul', 'Asia/Karachi', 'Asia/Kathmandu',
  'Asia/Kolkata', 'Asia/Manila', 'Asia/Riyadh', 'Asia/Seoul', 'Asia/Shanghai',
  'Asia/Singapore', 'Asia/Tehran', 'Asia/Tokyo', 'Australia/Adelaide',
  'Australia/Brisbane', 'Australia/Perth', 'Australia/Sydney', 'Europe/Amsterdam',
  'Europe/Athens', 'Europe/Berlin', 'Europe/Dublin', 'Europe/Istanbul',
  'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Paris',
  'Europe/Rome', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Zurich',
  'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu',
]);

/**
 * Cities that have been renamed since their tz id was minted.
 *
 * A runtime's tzdata may report either spelling depending on its vintage (this
 * one reports `Asia/Calcutta`), but users type the modern name. Without this,
 * searching "Kolkata" returns nothing at all — the zone is present, just filed
 * under a name nobody uses any more. Matching is two-way.
 */
const SEARCH_ALIASES = Object.freeze({
  calcutta: ['kolkata'],
  kolkata: ['calcutta'],
  katmandu: ['kathmandu'],
  kathmandu: ['katmandu'],
  saigon: ['ho chi minh', 'ho_chi_minh'],
  ho_chi_minh: ['saigon'],
  rangoon: ['yangon'],
  yangon: ['rangoon'],
  kiev: ['kyiv'],
  kyiv: ['kiev'],
  bombay: ['mumbai'],
  mumbai: ['bombay'],
  madras: ['chennai'],
  chennai: ['madras'],
  asmera: ['asmara'],
  asmara: ['asmera'],
});

let cachedZones = null;

/** Every IANA zone id this runtime knows, sorted. */
export function listTimezones() {
  if (cachedZones) return cachedZones;
  let zones;
  try {
    zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : null;
  } catch {
    zones = null;
  }
  if (!Array.isArray(zones) || zones.length === 0) zones = [...FALLBACK_ZONES];
  // `supportedValuesOf` omits UTC on some runtimes; it is the safest default we
  // have, so it must always be offerable.
  if (!zones.includes('UTC')) zones = ['UTC', ...zones];
  cachedZones = Object.freeze([...new Set(zones)].sort());
  return cachedZones;
}

/**
 * A canonical IANA zone id: "UTC", or "Region/City", optionally nested.
 * Deliberately does NOT admit an offset string.
 */
const IANA_ID_RE = /^(?:UTC|GMT|[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/;

/**
 * Is this a real IANA zone id?
 *
 * `Intl.DateTimeFormat` accepts a bare offset like "+05:00" as a timeZone, so
 * the runtime check alone is not enough: an offset would validate, be stored,
 * and then be wrong the moment DST moved. The shape is checked first so only a
 * named zone can ever be persisted.
 */
export function isSupportedTimezone(value) {
  if (typeof value !== 'string' || !value) return false;
  if (!IANA_ID_RE.test(value)) return false;
  return isValidTimezone(value);
}

/** Offset minutes for a zone AT A GIVEN INSTANT (DST-aware). */
export function offsetMinutesAt(timeZone, instant = new Date()) {
  if (!isSupportedTimezone(timeZone)) return 0;
  return Math.round(tzOffsetMs(timeZone, instant) / 60000);
}

/** "UTC+05:00" / "UTC−04:00" / "UTC+00:00". Uses a real minus sign. */
export function formatOffset(minutes) {
  const sign = minutes < 0 ? '−' : '+'; // U+2212 MINUS SIGN, not a hyphen
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/** "Asia/Karachi" -> "Karachi"; "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
export function cityOf(timeZone) {
  const parts = String(timeZone).split('/');
  return (parts[parts.length - 1] || timeZone).replace(/_/g, ' ');
}

/** "Asia/Karachi" -> "Asia"; "UTC" -> "UTC". */
export function regionOf(timeZone) {
  const parts = String(timeZone).split('/');
  return parts.length > 1 ? parts[0].replace(/_/g, ' ') : timeZone;
}

/**
 * One catalogue entry.
 *
 * @param {string} timeZone canonical IANA id
 * @param {Date} instant the date the offset is computed for
 * @returns {{ id, label, city, region, offsetMinutes, offsetLabel, abbreviation }}
 */
export function describeTimezone(timeZone, instant = new Date(), { withAbbreviation = false } = {}) {
  const offsetMinutes = offsetMinutesAt(timeZone, instant);
  const offsetLabel = formatOffset(offsetMinutes);
  return {
    // The canonical id is what gets STORED. Never store the offset alone: it
    // cannot survive a DST boundary or a tzdata change.
    id: timeZone,
    city: cityOf(timeZone),
    region: regionOf(timeZone),
    offsetMinutes,
    offsetLabel,
    label: `${timeZone} — ${offsetLabel}`,
    /*
     * Off by default: it costs an Intl.DateTimeFormat per zone, which is ~400
     * formatters for one catalogue call. Only the search path needs it.
     */
    ...(withAbbreviation ? { abbreviation: abbreviationOf(timeZone, instant) } : {}),
  };
}

/** The zone's short name at an instant ("PKT", "GMT+1"), or null. */
export function abbreviationOf(timeZone, instant = new Date()) {
  if (!isSupportedTimezone(timeZone)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(instant);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The full catalogue for a given date, ordered by offset then name — which is
 * how people scan a timezone list.
 *
 * @param {{ forDate?: Date|string, search?: string, limit?: number }} opts
 */
export function timezoneCatalogue({ forDate = new Date(), search = '', limit = 0 } = {}) {
  const instant = forDate instanceof Date ? forDate : new Date(forDate);
  const at = Number.isNaN(instant.getTime()) ? new Date() : instant;

  let entries = listTimezones().map((id) => describeTimezone(id, at));

  const query = String(search || '').trim().toLowerCase();
  if (query) {
    // Match on id, city, region and offset first — these are free. The
    // abbreviation is only computed for the few zones nothing else matched,
    // because it costs an Intl formatter each.
    const cheap = (e) => {
      const haystack = `${e.id} ${e.city} ${e.region} ${e.offsetLabel}`.toLowerCase();
      if (haystack.includes(query)) return true;
      // The zone may be filed under a city's former name.
      const key = e.city.toLowerCase().replace(/\s+/g, '_');
      return (SEARCH_ALIASES[key] || []).some((alias) => alias.includes(query) || query.includes(alias));
    };
    const matched = entries.filter(cheap);
    if (matched.length > 0) {
      entries = matched;
    } else {
      // Nothing matched by name; the query may be an abbreviation like "PKT".
      entries = entries.filter((e) => (abbreviationOf(e.id, at) || '').toLowerCase().includes(query));
    }
  }

  entries.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.id.localeCompare(b.id));
  return limit > 0 ? entries.slice(0, limit) : entries;
}

export default {
  listTimezones,
  isSupportedTimezone,
  timezoneCatalogue,
  describeTimezone,
  offsetMinutesAt,
  formatOffset,
  cityOf,
  regionOf,
  abbreviationOf,
};
