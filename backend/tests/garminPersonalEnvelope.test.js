'use strict';

// T2 — the Garmin personal lane's input contract (services/wearable/garminPersonalEnvelope.js).
//
// Pure: no database, no network, and a FIXED clock, so the future-timestamp cap is measured against
// a known "now" instead of whenever the suite happens to run. What is pinned here:
//   · the version, the allowed types and the per-type field allowlist, exactly — widening any of
//     them has to be a visible diff in this file, not a quiet edit in the module;
//   · every rejection is one code from a closed list and nothing else: never a value, a key or a path;
//   · location keys, and every other key outside the allowlist, are absent after parsing, at any depth;
//   · what survives is everything the normaliser reads — an allowlist that silently dropped, say,
//     startTimeOffsetInSeconds would degrade every reading without failing anything else.

const {
  parseGarminPersonalEnvelope,
  GARMIN_PERSONAL_ENVELOPE_VERSION,
  GARMIN_PERSONAL_TYPES,
  GARMIN_PERSONAL_FIELDS,
  ENVELOPE_ERROR_CODES,
  MAX_ITEMS,
  MAX_ENTRIES,
  MAX_FUTURE_SKEW_MS,
} = require('../app/services/wearable/garminPersonalEnvelope');
const { normalizeGarminSummaries } = require('../app/services/wearable/adapter');

const NOW = new Date('2026-10-26T12:00:00Z');
const NOW_SEC = NOW.getTime() / 1000;
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const START = NOW_SEC - 2 * DAY; // a settled day, two days back
const SKEW_SEC = 5 * 60;

// Location sentinels. The coordinates sit inside the heart-rate range on purpose, so a leak into a
// VALUE would be as visible as a leak into a key.
const LAT = 47.123456789;
const LON = 151.123456789;
const POLYLINE = 'sentinel-polyline-1f6b';
const PLACE = 'sentinel-place-9c2e';
const NEEDLES = [String(LAT), String(LON), POLYLINE, PLACE];
// Anchored where an allowed key shares the word (timeOffsetHeartRateSamples is not a position).
const LOCATION_KEY = /latitude|longitude|polyline|InDegree|^samples$|location|^geo/i;

// Every positional shape Garmin uses, on one object: activity-style starting coordinates, an encoded
// polyline, a place name, positioned samples and a Connect-style geo DTO.
const location = () => ({
  startingLatitudeInDegree: LAT,
  startingLongitudeInDegree: LON,
  polyline: POLYLINE,
  locationName: PLACE,
  samples: [{ startTimeInSeconds: START + 60, latitudeInDegree: LAT, longitudeInDegree: LON, latitude: LAT, longitude: LON, heartRate: 61 }],
  geoPolylineDTO: { polyline: [{ lat: LAT, lon: LON }] },
});

const dailies = (over = {}) => ({
  type: 'dailies',
  summary: {
    startTimeInSeconds: START,
    startTimeOffsetInSeconds: 3 * HOUR,
    restingHeartRateInBeatsPerMinute: 52,
    timeOffsetHeartRateSamples: { 0: 61, 15: 64, 60: 62 },
    ...over,
  },
});

const sleepLevels = () => ({
  deep: [{ startTimeInSeconds: START - 3 * HOUR, endTimeInSeconds: START - 2 * HOUR }],
  light: [{ startTimeInSeconds: START - 2 * HOUR, endTimeInSeconds: START + 2 * HOUR }],
  rem: [{ startTimeInSeconds: START + 2 * HOUR, endTimeInSeconds: START + 4 * HOUR }],
  awake: [{ startTimeInSeconds: START + 4 * HOUR, endTimeInSeconds: START + 5 * HOUR }],
});

const sleeps = (over = {}) => ({
  type: 'sleeps',
  summary: {
    startTimeInSeconds: START - 3 * HOUR,
    startTimeOffsetInSeconds: 3 * HOUR,
    durationInSeconds: 8 * HOUR,
    deepSleepDurationInSeconds: 3600,
    lightSleepDurationInSeconds: 14400,
    remSleepInSeconds: 7200,
    sleepLevelsMap: sleepLevels(),
    ...over,
  },
});

const hrv = (over = {}) => ({
  type: 'hrv',
  summary: {
    startTimeInSeconds: START - 3 * HOUR,
    startTimeOffsetInSeconds: 3 * HOUR,
    durationInSeconds: 8 * HOUR,
    lastNightAvg: 48,
    ...over,
  },
});

const envelope = (items) => ({ schemaVersion: 1, items });
const parse = (input) => parseGarminPersonalEnvelope(input, { now: NOW });

// The error a rejected envelope throws; fails the test when there was no rejection.
function rejectionOf(input) {
  try {
    parse(input);
  } catch (e) {
    return e;
  }
  throw new Error('expected the envelope to be rejected');
}
const codeOf = (input) => rejectionOf(input).code;

// Every key at every depth, walked rather than grepped so a value cannot stand in for a key.
function keysDeep(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

// The dormant consent-v2 flag makes the normaliser emit steps; the round-trip test needs it off.
beforeEach(() => { delete process.env.WAVE4_CONSENT_V2_METRICS; });

describe('the contract is pinned, not implied', () => {
  it('is version 1 and admits exactly dailies, sleeps and hrv (stress and Body Battery wait for T11)', () => {
    expect(GARMIN_PERSONAL_ENVELOPE_VERSION).toBe(1);
    expect(GARMIN_PERSONAL_TYPES).toEqual(['dailies', 'sleeps', 'hrv']);
    expect(Object.isFrozen(GARMIN_PERSONAL_TYPES)).toBe(true);
  });

  it('caps at 50 items, 6000 entries per collection and 5 minutes of clock skew', () => {
    expect(MAX_ITEMS).toBe(50);
    expect(MAX_ENTRIES).toBe(6000);
    expect(MAX_FUTURE_SKEW_MS).toBe(SKEW_SEC * 1000);
  });

  it('keeps exactly the fields the normaliser reads, per type', () => {
    expect(GARMIN_PERSONAL_FIELDS).toEqual({
      dailies: ['startTimeInSeconds', 'startTimeOffsetInSeconds', 'restingHeartRateInBeatsPerMinute', 'timeOffsetHeartRateSamples'],
      sleeps: [
        'startTimeInSeconds', 'startTimeOffsetInSeconds', 'durationInSeconds', 'deepSleepDurationInSeconds',
        'lightSleepDurationInSeconds', 'remSleepInSeconds', 'remSleepDurationInSeconds', 'sleepLevelsMap',
      ],
      hrv: ['startTimeInSeconds', 'startTimeOffsetInSeconds', 'durationInSeconds', 'lastNightAvg'],
    });
    expect(Object.isFrozen(GARMIN_PERSONAL_FIELDS)).toBe(true);
  });

  it('names every rejection from one closed list', () => {
    expect(ENVELOPE_ERROR_CODES).toEqual([
      'invalid_garmin_envelope',
      'unsupported_garmin_envelope_version',
      'garmin_envelope_too_large',
      'unknown_garmin_summary_type',
      'garmin_summary_too_large',
      'invalid_garmin_summary',
      'garmin_summary_in_future',
    ]);
    expect(Object.isFrozen(ENVELOPE_ERROR_CODES)).toBe(true);
  });
});

describe('a well-formed envelope', () => {
  it('parses to the same items, in order, with their types and their allowed fields intact', () => {
    const out = parse(envelope([dailies(), sleeps(), hrv()]));
    expect(out.schemaVersion).toBe(1);
    expect(out.items.map((i) => i.type)).toEqual(['dailies', 'sleeps', 'hrv']);
    expect(out.items[0].summary).toEqual(dailies().summary);
    expect(out.items[1].summary).toEqual(sleeps().summary);
    expect(out.items[2].summary).toEqual(hrv().summary);
  });

  it('accepts an empty item list (a pull that found nothing settled)', () => {
    expect(parse(envelope([]))).toEqual({ schemaVersion: 1, items: [] });
  });

  it('leaves the caller\'s object untouched: the strip builds a copy', () => {
    const input = envelope([dailies(location())]);
    const before = JSON.stringify(input);
    parse(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('a rejection carries one closed code', () => {
  it.each([
    ['a newer version', { schemaVersion: 2, items: [] }],
    ['version zero', { schemaVersion: 0, items: [] }],
    ['the version as a string', { schemaVersion: '1', items: [] }],
    ['a null version', { schemaVersion: null, items: [] }],
    ['no version at all', { items: [] }],
  ])('an unsupported version: %s', (_label, input) => {
    expect(codeOf(input)).toBe('unsupported_garmin_envelope_version');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'envelope'],
    ['a number', 1],
    ['no items', { schemaVersion: 1 }],
    ['items that are not a list', { schemaVersion: 1, items: {} }],
    ['an extra top-level key', { schemaVersion: 1, items: [], userId: 'u1' }],
    ['a null item', envelope([null])],
    ['an item with no summary', envelope([{ type: 'dailies' }])],
    ['a summary that is a list', envelope([{ type: 'dailies', summary: [] }])],
    ['a type that is not a string', envelope([{ type: 7, summary: {} }])],
    ['an extra key on an item', envelope([{ ...dailies(), userId: 'u1' }])],
  ])('not an envelope: %s', (_label, input) => {
    expect(codeOf(input)).toBe('invalid_garmin_envelope');
  });

  it.each(['stressDetails', 'pulseox', 'respiration', 'activities', 'activityDetails', 'epochs', '__proto__', 'constructor', 'toString'])(
    'an unknown type: %s',
    (type) => {
      expect(codeOf(envelope([{ type, summary: { startTimeInSeconds: START } }]))).toBe('unknown_garmin_summary_type');
    },
  );

  it('more than 50 items is too large; exactly 50 is fine', () => {
    expect(codeOf(envelope(Array.from({ length: MAX_ITEMS + 1 }, () => hrv())))).toBe('garmin_envelope_too_large');
    expect(parse(envelope(Array.from({ length: MAX_ITEMS }, () => hrv()))).items).toHaveLength(MAX_ITEMS);
  });

  it('an offset map over 6000 entries is too large; exactly 6000 (25 hours of 15-second readings) is fine', () => {
    const map = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i * 15), 60]));
    expect(codeOf(envelope([dailies({ timeOffsetHeartRateSamples: map(MAX_ENTRIES + 1) })]))).toBe('garmin_summary_too_large');
    expect(parse(envelope([dailies({ timeOffsetHeartRateSamples: map(MAX_ENTRIES) })])).items).toHaveLength(1);
  });

  it('a sleep level with over 6000 segments is too large', () => {
    const segments = Array.from({ length: MAX_ENTRIES + 1 }, () => ({ startTimeInSeconds: START, endTimeInSeconds: START + 1 }));
    expect(codeOf(envelope([sleeps({ sleepLevelsMap: { light: segments } })]))).toBe('garmin_summary_too_large');
  });

  it.each([
    ['no start time', { type: 'hrv', summary: { lastNightAvg: 48 } }],
    ['a fractional start time', hrv({ startTimeInSeconds: START + 0.5 })],
    ['a negative start time', hrv({ startTimeInSeconds: -1 })],
    ['a value that is a string', hrv({ lastNightAvg: '48' })],
    ['a value that is not a number', hrv({ lastNightAvg: Number.NaN })],
    ['an infinite value', dailies({ restingHeartRateInBeatsPerMinute: Number.POSITIVE_INFINITY })],
    ['an offset key that is not a number of seconds', dailies({ timeOffsetHeartRateSamples: { abc: 61 } })],
    ['a negative offset key', dailies({ timeOffsetHeartRateSamples: { '-15': 61 } })],
    ['a fractional offset key', dailies({ timeOffsetHeartRateSamples: { 1.5: 61 } })],
    ['a heart-rate sample that is an object', dailies({ timeOffsetHeartRateSamples: { 0: { heartRate: 61 } } })],
    ['a heart-rate sample that is null', dailies({ timeOffsetHeartRateSamples: { 0: null } })],
    ['a window longer than a day', sleeps({ durationInSeconds: DAY + 1 })],
    ['a zero-length window', hrv({ durationInSeconds: 0 })],
    ['a sleep segment that ends before it starts', sleeps({ sleepLevelsMap: { deep: [{ startTimeInSeconds: START, endTimeInSeconds: START - 1 }] } })],
    ['a sleep level that is not a list', sleeps({ sleepLevelsMap: { deep: { startTimeInSeconds: START, endTimeInSeconds: START + 1 } } })],
  ])('an invalid summary: %s', (_label, item) => {
    expect(codeOf(envelope([item]))).toBe('invalid_garmin_summary');
  });
});

describe('nothing may be stamped more than 5 minutes ahead of the clock', () => {
  const AHEAD = NOW_SEC + SKEW_SEC + 1; // one second past the allowance

  it.each([
    ['its start', { type: 'hrv', summary: { startTimeInSeconds: AHEAD, lastNightAvg: 48 } }],
    ['the end of its window', hrv({ startTimeInSeconds: NOW_SEC - 2 * HOUR, durationInSeconds: 2 * HOUR + SKEW_SEC + 1 })],
    ['a heart-rate reading', dailies({ startTimeInSeconds: NOW_SEC - HOUR, timeOffsetHeartRateSamples: { 0: 61, [HOUR + SKEW_SEC + 1]: 62 } })],
    ['a sleep segment', sleeps({
      startTimeInSeconds: NOW_SEC - 8 * HOUR,
      durationInSeconds: 8 * HOUR,
      sleepLevelsMap: { awake: [{ startTimeInSeconds: NOW_SEC, endTimeInSeconds: AHEAD }] },
    })],
  ])('rejects %s past the allowance', (_label, item) => {
    expect(codeOf(envelope([item]))).toBe('garmin_summary_in_future');
  });

  it('accepts a reading stamped exactly at the allowance', () => {
    const edge = dailies({ startTimeInSeconds: NOW_SEC - HOUR, timeOffsetHeartRateSamples: { 0: 61, [HOUR + SKEW_SEC]: 62 } });
    expect(parse(envelope([edge])).items).toHaveLength(1);
  });
});

describe('every key outside the allowlist is stripped, location first', () => {
  const laden = () => envelope([
    dailies({
      ...location(), steps: 8412, summaryId: 'x-1', calendarDate: '2026-10-24', durationInSeconds: DAY, activeKilocalories: 410, averageStressLevel: 31,
    }),
    sleeps({
      ...location(),
      validation: 'ENHANCED_FINAL',
      overallSleepScore: { value: 80 },
      sleepLevelsMap: {
        ...sleepLevels(),
        gps: [{ startTimeInSeconds: START, endTimeInSeconds: START + 1 }],
        deep: [{ startTimeInSeconds: START - 3 * HOUR, endTimeInSeconds: START - 2 * HOUR, latitude: LAT, longitude: LON }],
      },
    }),
    hrv({ ...location(), hrvValues: { 300: 32 }, lastNight5MinHigh: 66 }),
  ]);

  it('no location key and no coordinate survives, at any depth', () => {
    const out = parse(laden());
    const text = JSON.stringify(out);
    for (const needle of NEEDLES) expect(text).not.toContain(needle);
    expect(keysDeep(out).filter((k) => LOCATION_KEY.test(k))).toEqual([]);
  });

  it('each summary keeps only its own type\'s fields', () => {
    for (const { type, summary } of parse(laden()).items) {
      expect(Object.keys(summary).filter((k) => !GARMIN_PERSONAL_FIELDS[type].includes(k))).toEqual([]);
    }
  });

  it('steps are stripped: no reader uses them yet (R4)', () => {
    expect(parse(laden()).items[0].summary).not.toHaveProperty('steps');
  });

  it('unknown sleep levels and unknown segment keys are stripped too', () => {
    const { sleepLevelsMap } = parse(laden()).items[1].summary;
    expect(Object.keys(sleepLevelsMap).sort()).toEqual(['awake', 'deep', 'light', 'rem']);
    expect(sleepLevelsMap.deep).toEqual([{ startTimeInSeconds: START - 3 * HOUR, endTimeInSeconds: START - 2 * HOUR }]);
  });
});

describe('what survives is everything the normaliser reads', () => {
  it.each([['dailies', dailies], ['sleeps', sleeps], ['hrv', hrv]])('%s normalises identically before and after the strip', (_type, make) => {
    const item = make(location());
    const [parsed] = parse(envelope([item])).items;
    const before = normalizeGarminSummaries(item.type, item.summary);
    expect(before.length).toBeGreaterThan(0); // non-vacuous: the fixture really produces records
    expect(normalizeGarminSummaries(parsed.type, parsed.summary)).toEqual(before);
  });
});

describe('a rejection never echoes what it rejected', () => {
  const SECRET = 'sentinel-secret-5d0c';
  const SECRET_NUMBER = 987654.321;
  const FAR_FUTURE = 9999999999;

  it.each([
    ['a version', { schemaVersion: SECRET, items: [] }],
    ['a top-level key', { schemaVersion: 1, items: [], [SECRET]: 1 }],
    ['an item key', envelope([{ ...hrv(), [SECRET]: 1 }])],
    ['a type', envelope([{ type: SECRET, summary: {} }])],
    ['an offset key', envelope([dailies({ timeOffsetHeartRateSamples: { [SECRET]: 61 } })])],
    ['a field value', envelope([hrv({ lastNightAvg: SECRET })])],
    ['a numeric value', envelope([hrv({ durationInSeconds: SECRET_NUMBER })])],
    ['a future stamp', envelope([{ type: 'hrv', summary: { startTimeInSeconds: FAR_FUTURE, lastNightAvg: 48 } }])],
  ])('in %s', (_label, input) => {
    const e = rejectionOf(input);
    expect(ENVELOPE_ERROR_CODES).toContain(e.code);
    expect(e.message).toBe(e.code);
    expect(Object.keys(e)).toEqual(['code']);
    expect(e.cause).toBeUndefined();
    for (const surface of [e.message, String(e), JSON.stringify(e), e.stack]) {
      expect(surface).not.toContain(SECRET);
      expect(surface).not.toContain(String(SECRET_NUMBER));
      expect(surface).not.toContain(String(FAR_FUTURE));
    }
  });
});
