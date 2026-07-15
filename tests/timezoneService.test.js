// Phase 4.7.1: worldwide IANA timezone support with DST-aware labels.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listTimezones,
  isSupportedTimezone,
  timezoneCatalogue,
  describeTimezone,
  offsetMinutesAt,
  formatOffset,
  cityOf,
  regionOf,
} from '../src/services/timezoneService.js';

const JANUARY = new Date('2026-01-15T12:00:00Z');
const JULY = new Date('2026-07-15T12:00:00Z');

test('the catalogue covers the world, not a curated shortlist', () => {
  const zones = listTimezones();
  // A hand-maintained "popular" list is the bug this replaces.
  assert.ok(zones.length > 300, `only ${zones.length} zones — this looks curated`);
  assert.ok(zones.includes('UTC'));
  // Stable ids that every tzdata build agrees on.
  for (const zone of [
    'Asia/Karachi', 'America/New_York', 'Europe/London', 'Australia/Sydney',
    'Africa/Nairobi', 'Pacific/Auckland', 'America/St_Johns', 'Africa/Lagos',
    'Antarctica/Casey',
  ]) {
    assert.ok(zones.includes(zone), `${zone} must be offerable`);
  }
  /*
   * Several cities have been renamed since their tz id was minted, and a
   * runtime reports whichever spelling its tzdata carries (this one still says
   * Calcutta and Katmandu). Asserting one spelling would make this test a
   * hostage to the runtime's tz vintage, so assert the city is REACHABLE.
   */
  assert.ok(zones.some((z) => /Buenos_Aires$/.test(z)), 'Buenos Aires must be offerable');
  assert.ok(zones.some((z) => /^Asia\/Kat[h]?mandu$/.test(z)), 'Kathmandu must be offerable');
  assert.ok(zones.some((z) => /^Asia\/(Kolkata|Calcutta)$/.test(z)), 'India must be offerable');
  // Every continent is represented.
  const regions = new Set(zones.map(regionOf));
  for (const region of ['Africa', 'America', 'Asia', 'Australia', 'Europe', 'Pacific']) {
    assert.ok(regions.has(region), `${region} must be represented`);
  }
});

test('server-side validation accepts real zones and rejects junk', () => {
  assert.equal(isSupportedTimezone('Asia/Karachi'), true);
  assert.equal(isSupportedTimezone('UTC'), true);
  for (const bad of ['Not/AZone', 'UTC+5', '+05:00', '', null, 'Mars/Olympus', 123]) {
    assert.equal(isSupportedTimezone(bad), false, `${bad} must be rejected`);
  }
});

test('offset labels are formatted with a real minus sign', () => {
  assert.equal(formatOffset(300), 'UTC+05:00');
  assert.equal(formatOffset(-240), 'UTC−04:00');
  assert.equal(formatOffset(0), 'UTC+00:00');
  assert.equal(formatOffset(345), 'UTC+05:45'); // Kathmandu
  assert.equal(formatOffset(-210), 'UTC−03:30'); // St John's
  // U+2212, not a hyphen.
  assert.ok(formatOffset(-240).includes('−'));
});

test('a non-DST zone has the same offset all year', () => {
  // Asia/Karachi is UTC+5 year round.
  assert.equal(offsetMinutesAt('Asia/Karachi', JANUARY), 300);
  assert.equal(offsetMinutesAt('Asia/Karachi', JULY), 300);
  assert.equal(describeTimezone('Asia/Karachi', JULY).offsetLabel, 'UTC+05:00');
});

test('a DST zone is labelled for the date it is asked about', () => {
  // This is why an offset cannot be a property of a zone.
  assert.equal(offsetMinutesAt('Europe/London', JANUARY), 0);
  assert.equal(offsetMinutesAt('Europe/London', JULY), 60);
  assert.equal(describeTimezone('Europe/London', JANUARY).offsetLabel, 'UTC+00:00');
  assert.equal(describeTimezone('Europe/London', JULY).offsetLabel, 'UTC+01:00');

  // New York: UTC-5 in winter, UTC-4 in summer.
  assert.equal(offsetMinutesAt('America/New_York', JANUARY), -300);
  assert.equal(offsetMinutesAt('America/New_York', JULY), -240);
  assert.equal(describeTimezone('America/New_York', JULY).offsetLabel, 'UTC−04:00');

  // Southern hemisphere DST runs the other way round.
  assert.equal(offsetMinutesAt('Australia/Sydney', JANUARY), 660); // +11 in their summer
  assert.equal(offsetMinutesAt('Australia/Sydney', JULY), 600); // +10 in their winter
});

test('the spec examples produce the documented labels', () => {
  assert.equal(describeTimezone('Asia/Karachi', JULY).label, 'Asia/Karachi — UTC+05:00');
  assert.equal(describeTimezone('America/New_York', JULY).label, 'America/New_York — UTC−04:00');
  assert.equal(describeTimezone('Europe/London', JULY).label, 'Europe/London — UTC+01:00');
  assert.equal(describeTimezone('Australia/Sydney', JULY).label, 'Australia/Sydney — UTC+10:00');
});

test('an entry keeps the canonical id, never only an offset', () => {
  const entry = describeTimezone('Asia/Karachi', JULY);
  assert.equal(entry.id, 'Asia/Karachi', 'the stored value must be the IANA id');
  assert.equal(entry.city, 'Karachi');
  assert.equal(entry.region, 'Asia');
  assert.equal(typeof entry.offsetMinutes, 'number');
  assert.equal(cityOf('America/Argentina/Buenos_Aires'), 'Buenos Aires');
  assert.equal(regionOf('America/Argentina/Buenos_Aires'), 'America');
  assert.equal(cityOf('UTC'), 'UTC');
});

test('the catalogue is searchable by id, city, region, offset and abbreviation', () => {
  const byCity = timezoneCatalogue({ search: 'karachi', forDate: JULY });
  assert.ok(byCity.some((e) => e.id === 'Asia/Karachi'));

  const byRegion = timezoneCatalogue({ search: 'africa', forDate: JULY });
  assert.ok(byRegion.length > 20);
  assert.ok(byRegion.every((e) => /africa/i.test(`${e.id} ${e.region}`)));

  // Nepal is the only +05:45 zone, whichever way this tzdata spells it.
  const byOffset = timezoneCatalogue({ search: '+05:45', forDate: JULY });
  assert.ok(byOffset.length > 0);
  assert.ok(byOffset.every((e) => e.offsetMinutes === 345));
  assert.ok(byOffset.some((e) => /Kat[h]?mandu/.test(e.id)));

  const byId = timezoneCatalogue({ search: 'new_york', forDate: JULY });
  assert.ok(byId.some((e) => e.id === 'America/New_York'));

  assert.deepEqual(timezoneCatalogue({ search: 'zzzznotazone' }), []);
});

test('the catalogue is ordered by offset then name, and can be limited', () => {
  const all = timezoneCatalogue({ forDate: JULY });
  for (let i = 1; i < all.length; i += 1) {
    const sameOffset = all[i].offsetMinutes === all[i - 1].offsetMinutes;
    assert.ok(
      all[i].offsetMinutes > all[i - 1].offsetMinutes
        // Ties break by name using the same comparator the sort uses.
        || (sameOffset && all[i - 1].id.localeCompare(all[i].id) <= 0),
      `ordering broke at ${all[i - 1].id} -> ${all[i].id}`,
    );
  }
  assert.equal(timezoneCatalogue({ forDate: JULY, limit: 5 }).length, 5);
});

test('a renamed city is findable under the name people actually use', () => {
  // This runtime files India under Asia/Calcutta. Someone typing "Kolkata"
  // must still find it, or the zone is effectively missing.
  const kolkata = timezoneCatalogue({ search: 'kolkata', forDate: JULY });
  assert.ok(kolkata.length > 0, 'searching Kolkata must find India');
  assert.ok(kolkata.every((e) => e.offsetMinutes === 330));

  const kyiv = timezoneCatalogue({ search: 'kyiv', forDate: JULY });
  assert.ok(kyiv.length > 0, 'searching Kyiv must find Ukraine');

  // ...and the legacy spelling still works too.
  assert.ok(timezoneCatalogue({ search: 'calcutta', forDate: JULY }).length > 0);
});

test('the same zone can sort differently in January and July', () => {
  // Proof that the catalogue really is computed for the date given.
  const jan = timezoneCatalogue({ forDate: JANUARY }).find((e) => e.id === 'Europe/London');
  const jul = timezoneCatalogue({ forDate: JULY }).find((e) => e.id === 'Europe/London');
  assert.notEqual(jan.offsetMinutes, jul.offsetMinutes);
  assert.notEqual(jan.offsetLabel, jul.offsetLabel);
});

test('a bad date falls back to now rather than throwing', () => {
  const entries = timezoneCatalogue({ forDate: 'not-a-date', limit: 3 });
  assert.equal(entries.length, 3);
  assert.equal(describeTimezone('Not/AZone').offsetMinutes, 0);
});
