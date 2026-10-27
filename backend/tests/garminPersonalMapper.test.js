'use strict';

// The personal-API mapper (T3): Garmin Connect Personal API responses become the Garmin Health API
// summaries the shared normaliser already reads (adapter.js normalizeGarminSummaries), so the
// personal lane feeds the same seam the webhook feeds and Phase 2 swaps the source, not the pipeline.
//
// The fixtures are synthetic Personal-API responses in the shapes Garmin's Swagger documents. Each
// carries what must never come out: the user's Garmin id, free-text notes, SpO2, respiration, sleep
// scores, "abnormal" heart-rate thresholds, and sentinel coordinates, a polyline and a place name at
// several depths. The main night is 2026-10-24 into 2026-10-25, when Israel left summer time.

const path = require('path');
const { execFileSync } = require('child_process');

const { mapPersonalResponse, stripLocationKeys, GARMIN_PERSONAL_MAPPED_ENDPOINTS } = require('../app/services/wearable/garminPersonal/mapper');
const { GARMIN_PERSONAL_ENDPOINT_IDS } = require('../app/services/wearable/garminPersonal/client');
const { normalizeGarminSummaries } = require('../app/services/wearable/adapter');

const FIXTURES = path.join(__dirname, 'fixtures', 'garminPersonal');
const fixture = (name) => JSON.parse(JSON.stringify(require(path.join(FIXTURES, `${name}.json`))));
const EXPECTED = require(path.join(FIXTURES, 'healthApi.expected.json'));
const ENDPOINTS = ['dailySleep', 'dailySleepSummaries', 'hrv', 'dailyHeartRate', 'bodyBattery'];

const SUMMARY_FIELDS = {
  sleeps: ['calendarDate', 'startTimeInSeconds', 'startTimeOffsetInSeconds', 'durationInSeconds', 'deepSleepDurationInSeconds', 'lightSleepDurationInSeconds', 'remSleepInSeconds', 'awakeDurationInSeconds'],
  hrv: ['startTimeInSeconds', 'startTimeOffsetInSeconds', 'durationInSeconds', 'lastNightAvg'],
  dailies: ['startTimeInSeconds', 'startTimeOffsetInSeconds', 'durationInSeconds', 'restingHeartRateInBeatsPerMinute', 'timeOffsetHeartRateSamples'],
  stressDetails: ['calendarDate', 'startTimeInSeconds', 'startTimeOffsetInSeconds', 'durationInSeconds', 'timeOffsetBodyBatteryValues'],
};

const allItems = () => ENDPOINTS.flatMap((id) => mapPersonalResponse(id, fixture(id)).items);

describe('Personal API responses become Health API summaries, byte for byte', () => {
  it.each(ENDPOINTS)('%s', (endpoint) => {
    const mapped = mapPersonalResponse(endpoint, fixture(endpoint));

    expect(JSON.stringify(mapped)).toBe(JSON.stringify(EXPECTED[endpoint]));
  });

  it('every summary holds only its type\'s Health API fields', () => {
    for (const { type, summary } of allItems()) {
      expect(Object.keys(SUMMARY_FIELDS)).toContain(type);
      for (const key of Object.keys(summary)) expect({ type, key, allowed: SUMMARY_FIELDS[type].includes(key) }).toEqual({ type, key, allowed: true });
    }
  });

  it('never mutates the response it was given', () => {
    for (const endpoint of ENDPOINTS) {
      const response = fixture(endpoint);
      const before = JSON.stringify(response);
      mapPersonalResponse(endpoint, response);
      expect(JSON.stringify(response)).toBe(before);
    }
  });
});

// The personal-lane envelope (PR #273) and the normaliser's night-end stamping need these: whole
// seconds, a positive duration on every summary (a night ENDS at start + durationInSeconds), a night
// no longer than a day, offset keys that are whole non-negative seconds.
describe('the shapes the envelope and the normaliser rely on', () => {
  it('every summary has a whole-second start and a positive whole-second duration', () => {
    const items = allItems();
    expect(items.length).toBe(6);
    for (const { summary } of items) {
      expect(Number.isInteger(summary.startTimeInSeconds)).toBe(true);
      expect(summary.startTimeInSeconds).toBeGreaterThan(0);
      expect(Number.isInteger(summary.durationInSeconds)).toBe(true);
      expect(summary.durationInSeconds).toBeGreaterThan(0);
      if (summary.startTimeOffsetInSeconds !== undefined) expect(Number.isInteger(summary.startTimeOffsetInSeconds)).toBe(true);
    }
  });

  it('a night (sleep, HRV) is never longer than a day, a calendar day never longer than 25 hours', () => {
    for (const { type, summary } of allItems()) {
      const max = type === 'sleeps' || type === 'hrv' ? 24 * 3600 : 25 * 3600;
      expect(summary.durationInSeconds).toBeLessThanOrEqual(max);
    }
  });

  it('every offset key is a whole, non-negative number of seconds inside the summary\'s window', () => {
    for (const { summary } of allItems()) {
      for (const series of [summary.timeOffsetHeartRateSamples, summary.timeOffsetBodyBatteryValues]) {
        for (const key of Object.keys(series || {})) {
          expect(key).toMatch(/^\d+$/);
          expect(Number(key)).toBeLessThan(summary.durationInSeconds);
        }
      }
    }
  });
});

describe('the shared normaliser reads the mapped summaries as the metrics they are', () => {
  const pick = (records, withTime) => records.map((r) => ({
    metric: r.metric, value: r.value, unit: r.unit, source: r.source, tzOffsetMinutes: r.tzOffsetMinutes,
    ...(withTime ? { at: r.recordedAt.toISOString() } : {}),
  }));
  const normalised = (endpoint) => mapPersonalResponse(endpoint, fixture(endpoint)).items
    .flatMap(({ type, summary }) => normalizeGarminSummaries(type, summary));

  it('daily heart rate: the resting heart rate and each reading at its own moment', () => {
    expect(pick(normalised('dailyHeartRate'), true)).toEqual([
      { metric: 'restingHeartRate', value: 51, unit: 'bpm', source: 'garmin', tzOffsetMinutes: 180, at: '2026-10-24T21:00:00.000Z' },
      { metric: 'heartRate', value: 58, unit: 'bpm', source: 'garmin', tzOffsetMinutes: 180, at: '2026-10-24T21:00:00.000Z' },
      { metric: 'heartRate', value: 57, unit: 'bpm', source: 'garmin', tzOffsetMinutes: 180, at: '2026-10-24T21:02:00.000Z' },
      { metric: 'heartRate', value: 56, unit: 'bpm', source: 'garmin', tzOffsetMinutes: 180, at: '2026-10-24T21:06:00.000Z' },
      { metric: 'heartRate', value: 55, unit: 'bpm', source: 'garmin', tzOffsetMinutes: 180, at: '2026-10-24T21:10:00.000Z' },
    ]);
  });

  // When a night's metrics are stamped (its start today, its end once #273 lands) is the
  // normaliser's to decide; the mapper's part is the start and the duration, pinned above.
  it('sleep: the deep, light and REM minutes', () => {
    expect(pick(normalised('dailySleep'), false)).toEqual([
      { metric: 'sleepDeep', value: 90, unit: 'min', source: 'garmin', tzOffsetMinutes: 180 },
      { metric: 'sleepLight', value: 270, unit: 'min', source: 'garmin', tzOffsetMinutes: 180 },
      { metric: 'sleepRem', value: 110, unit: 'min', source: 'garmin', tzOffsetMinutes: 180 },
    ]);
  });

  it('HRV: the night\'s average', () => {
    expect(pick(normalised('hrv'), false)).toEqual([
      { metric: 'hrv', value: 52, unit: 'ms', source: 'garmin', tzOffsetMinutes: 180 },
    ]);
  });

  it('Body Battery (stressDetails, for Phase 1c): each level at its own moment', () => {
    expect(pick(normalised('bodyBattery'), true)).toEqual([
      { metric: 'bodyBattery', value: 62, unit: 'score', source: 'garmin', tzOffsetMinutes: 180, at: '2026-10-24T21:00:00.000Z' },
      { metric: 'bodyBattery', value: 61, unit: 'score', source: 'garmin', tzOffsetMinutes: 180, at: '2026-10-24T21:03:00.000Z' },
      { metric: 'bodyBattery', value: 60, unit: 'score', source: 'garmin', tzOffsetMinutes: 180, at: '2026-10-24T21:09:00.000Z' },
    ]);
  });
});

describe('no location and nothing outside the allowlist comes out', () => {
  const LOCATION_WORD = /(?:^|[^a-z])(?:lat|lon|lng|latitude|longitude|latlng|latlon|lnglat|polyline|gps|route|location|coordinates?|geo|geohash)(?:[^a-z]|$)/i;
  const keysOf = (value, out = []) => {
    if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); keysOf(v, out); }
    return out;
  };

  it('no sentinel coordinate, polyline or place name survives, and no key names a location', () => {
    const wire = JSON.stringify(allItems());

    for (const sentinel of ['12.3456789', '98.7654321', 'SENTINEL_POLYLINE', 'SENTINEL_PLACE']) expect(wire).not.toContain(sentinel);
    const camelSplit = (k) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    expect(keysOf(allItems()).filter((k) => LOCATION_WORD.test(camelSplit(k)))).toEqual([]);
  });

  it('no user id, free text, SpO2, respiration, score, status or "abnormal" threshold survives', () => {
    const wire = JSON.stringify(allItems());

    for (const sentinel of ['999000111', 'SENTINEL', '96.123', '95.777', '14.321']) expect(wire).not.toContain(sentinel);
    for (const word of ['userProfile', 'Note', 'SpO2', 'Respiration', 'score', 'status', 'abnormal', 'baseline', 'feedback', 'nap']) {
      expect(wire.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('stripLocationKeys removes location keys at any depth and keeps everything else', () => {
    const input = {
      keep: 1,
      latest: 2, // "lat" inside another word is not a location
      calories: 3,
      translate: 4,
      allocation: 5,
      lat: 9, lon: 9, lng: 9, LATITUDE: 9, startLongitude: 9, encodedPolyline: 'x', GPS: 'x', gpsTrack: [1], routeId: 7, location_name: 'x', geoPoint: {},
      nested: { deeper: [{ latitude: 1, keepMe: true, coordinates: [1, 2] }], startLat: 1 },
    };

    expect(stripLocationKeys(input)).toEqual({
      keep: 1, latest: 2, calories: 3, translate: 4, allocation: 5,
      nested: { deeper: [{ keepMe: true }] },
    });
    expect(input.lat).toBe(9); // the input is untouched
  });

  // RA-6. A pair written as one word ("latlng") is one word to keyWords, so it never matched "lat".
  it('stripLocationKeys removes latlng, latlon, lnglat, geohash and coordinate, alone or inside a compound key, in any case', () => {
    const input = {
      keep: 1,
      coordinator: 2, // a word that only contains one of them is not a location
      coordination: 3,
      latlng: [1, 2], startLatlng: [1, 2], LATLNG: 'x',
      latlon: [1, 2], end_latlon: 'x', LatLon: 'x',
      lnglat: [2, 1], startLnglat: [2, 1],
      geohash: 'x', startGeohash: 'x', GEOHASH: 'x', 'geohash-6': 'x',
      coordinate: {}, startCoordinate: { x: 1 }, 'end-coordinate': 1, COORDINATE: 1,
      nested: [{ deeper: { latlng: 1, kept: true, polylineCoordinate: [] } }],
    };

    expect(stripLocationKeys(input)).toEqual({ keep: 1, coordinator: 2, coordination: 3, nested: [{ deeper: { kept: true } }] });
  });
});

describe('timestamps', () => {
  // HRV writes "iso 8601 without GMT offset or 'Z'". JavaScript reads such a string in the SERVER's
  // zone, so a parser that leaned on Date.parse would move every instant with the server, and CI runs
  // in UTC, where that bug is invisible. The mapper runs here in a child process whose zone is
  // America/New_York (EST5EDT, honoured on Linux and Windows alike) and must give the same answer.
  it('reads a timestamp without a zone as UTC, whatever zone the server runs in', () => {
    const script = `
      const { mapPersonalResponse } = require(${JSON.stringify(require.resolve('../app/services/wearable/garminPersonal/mapper'))});
      const fixture = (n) => require(${JSON.stringify(FIXTURES)} + '/' + n + '.json');
      const ids = ${JSON.stringify(ENDPOINTS)};
      process.stdout.write(JSON.stringify({
        offsetMinutes: new Date('2026-10-25T00:00:00').getTimezoneOffset(),
        mapped: ids.map((id) => mapPersonalResponse(id, fixture(id))),
      }));`;
    const run = (tz) => JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));

    const newYork = run('EST5EDT');
    const utc = run('UTC');

    expect(newYork.offsetMinutes).toBe(240); // the child really ran four hours west of UTC…
    expect(utc.offsetMinutes).toBe(0);
    expect(newYork.mapped).toEqual(ENDPOINTS.map((id) => EXPECTED[id])); // …and read every instant as UTC
    expect(utc.mapped).toEqual(newYork.mapped);
  });

  // startTimeOffsetInSeconds is the offset AT THE START, which is all the Health API field means. It is
  // not the night's offset: this night ends at UTC+2, and nothing here carries the end's offset yet, so
  // a row stamped at the night's end keeps the start's +3 (BE-195, open; RA-4 of the #274 audit).
  it('a night across the end of summer time: its length is real time, and startTimeOffsetInSeconds is the offset at its start, not at its end', () => {
    const [{ summary }] = mapPersonalResponse('dailySleep', fixture('dailySleep')).items;

    // 23:12 at UTC+3 to 06:41 at UTC+2 is 7 h 29 min on the clock and 8 h 29 min of night.
    expect(summary.durationInSeconds).toBe(8 * 3600 + 29 * 60);
    expect(summary.startTimeOffsetInSeconds).toBe(3 * 3600);
  });

  it.each([
    ['epoch milliseconds', { sleepStartTimestampGMT: 1792872720000, sleepEndTimestampGMT: 1792903260000, sleepStartTimestampLocal: 1792883520000 }],
    ['ISO with Z, local without a zone', { sleepStartTimestampGMT: '2026-10-24T20:12:00.000Z', sleepEndTimestampGMT: '2026-10-25T04:41:00Z', sleepStartTimestampLocal: '2026-10-24T23:12:00' }],
    ['ISO with numeric offsets', { sleepStartTimestampGMT: '2026-10-24T23:12:00+03:00', sleepEndTimestampGMT: '2026-10-25T06:41:00+0200', sleepStartTimestampLocal: '2026-10-24T23:12:00.0+03:00' }],
    ['ConnectTimestamp objects', { sleepStartTimestampGMT: { date: '2026-10-24T20:12:00.0' }, sleepEndTimestampGMT: { date: '2026-10-25T04:41:00.0' }, sleepStartTimestampLocal: { date: '2026-10-24T23:12:00.0' } }],
  ])('accepts %s for the same night', (_label, timestamps) => {
    const [{ summary }] = mapPersonalResponse('dailySleep', { ...fixture('dailySleep'), ...timestamps }).items;

    expect(summary).toMatchObject({ startTimeInSeconds: 1792872720, startTimeOffsetInSeconds: 10800, durationInSeconds: 30540 });
  });

  it.each([
    ['37 seconds', '2026-10-24T20:12:37.000'],
    ['15 hours', '2026-10-25T11:12:00.000'],
    ['unreadable', 'yesterday evening'],
  ])('leaves the offset out, never guesses it, when Local − GMT is not a real UTC offset (%s)', (_label, local) => {
    const [{ summary }] = mapPersonalResponse('dailySleep', { ...fixture('dailySleep'), sleepStartTimestampLocal: local }).items;

    expect(summary).not.toHaveProperty('startTimeOffsetInSeconds');
    expect(summary.startTimeInSeconds).toBe(1792872720);
  });
});

describe('what cannot be placed in time, or carries nothing, is skipped and counted', () => {
  const sleep = (overrides) => mapPersonalResponse('dailySleep', { ...fixture('dailySleep'), ...overrides });

  it.each([
    ['no start', { sleepStartTimestampGMT: null }],
    ['no end', { sleepEndTimestampGMT: undefined }],
    ['an end before its start', { sleepEndTimestampGMT: 1792872000000 }],
    ['a window of no length', { sleepEndTimestampGMT: 1792872720000 }],
    ['a night longer than a day', { sleepEndTimestampGMT: 1792872720000 + 24 * 3600 * 1000 + 1000 }],
    // Read loosely, 30 and 31 February would roll into a perfectly plausible night in March.
    ['impossible dates', { sleepStartTimestampGMT: '2026-02-30T20:12:00Z', sleepEndTimestampGMT: '2026-02-31T04:41:00Z' }],
    ['an impossible hour', { sleepStartTimestampGMT: '2026-10-24T24:12:00Z', sleepEndTimestampGMT: '2026-10-25T04:41:00Z' }],
    ['seconds mistaken for milliseconds', { sleepStartTimestampGMT: 1792872720, sleepEndTimestampGMT: 1792903260 }],
    ['no deep, light or REM', { deepSleepSeconds: null, lightSleepSeconds: undefined, remSleepSeconds: 'lots' }],
  ])('a sleep with %s', (_label, overrides) => {
    expect(sleep(overrides)).toEqual({ items: [], skipped: 1 });
  });

  it.each(['2026-02-30', '25/10/2026', 20261025, null])('a calendar date that is not one (%p) is left out, the night kept', (calendarDate) => {
    const [{ summary }] = sleep({ calendarDate }).items;
    const [report] = mapPersonalResponse('bodyBattery', [{ ...fixture('bodyBattery')[0], date: calendarDate }]).items;

    expect(summary).not.toHaveProperty('calendarDate');
    expect(summary.startTimeInSeconds).toBe(1792872720);
    expect(report.summary).not.toHaveProperty('calendarDate');
  });

  it('a stage that is missing or negative is left out, the rest of the night kept', () => {
    const [{ summary }] = sleep({ remSleepSeconds: null, awakeSleepSeconds: -60 }).items;

    expect(summary).not.toHaveProperty('remSleepInSeconds');
    expect(summary).not.toHaveProperty('awakeDurationInSeconds');
    expect(summary.deepSleepDurationInSeconds).toBe(5400);
  });

  it('HRV with no average is skipped', () => {
    const chart = fixture('hrv');
    chart.hrvSummary.lastNightAvg = null;

    expect(mapPersonalResponse('hrv', chart)).toEqual({ items: [], skipped: 1 });
  });

  it('HRV uses its own window when it has one, and the sleep window only when it does not', () => {
    const chart = fixture('hrv'); // HRV window 20:12–04:41, sleep window 20:05–04:45
    expect(mapPersonalResponse('hrv', chart).items[0].summary).toMatchObject({ startTimeInSeconds: 1792872720, durationInSeconds: 30540 });

    for (const key of ['startTimestampGMT', 'endTimestampGMT', 'startTimestampLocal', 'endTimestampLocal']) delete chart[key];

    expect(mapPersonalResponse('hrv', chart).items).toEqual([
      { type: 'hrv', summary: { startTimeInSeconds: 1792872300, startTimeOffsetInSeconds: 10800, durationInSeconds: 31200, lastNightAvg: 52 } },
    ]);
  });

  it('a day with neither a resting heart rate nor a reading is skipped', () => {
    const day = fixture('dailyHeartRate');
    day.restingHeartRate = null;
    day.heartRateValues = [[1792875600000, null]];

    expect(mapPersonalResponse('dailyHeartRate', day)).toEqual({ items: [], skipped: 1 });
  });

  it('the columns are where the descriptors say', () => {
    const swapped = fixture('dailyHeartRate');
    swapped.heartRateValueDescriptors = [{ index: 1, key: 'timestamp' }, { index: 0, key: 'heartrate' }];
    swapped.heartRateValues = [[63, 1792875600000], [64, 1792875720000]];

    expect(mapPersonalResponse('dailyHeartRate', swapped).items[0].summary.timeOffsetHeartRateSamples).toEqual({ 0: 63, 120: 64 });
  });

  it.each([
    ['no descriptors at all', (day) => { delete day.heartRateValueDescriptors; }],
    ['no descriptor for the heart-rate column', (day) => { day.heartRateValueDescriptors = [{ index: 0, key: 'timestamp' }]; }],
    ['no descriptor for the time column', (day) => { day.heartRateValueDescriptors = [{ index: 1, key: 'heartrate' }]; }],
  ])('with %s there is no series, and no guess; the resting heart rate stays', (_label, edit) => {
    const day = fixture('dailyHeartRate');
    edit(day);

    const [{ summary }] = mapPersonalResponse('dailyHeartRate', day).items;

    expect(summary).not.toHaveProperty('timeOffsetHeartRateSamples');
    expect(summary.restingHeartRateInBeatsPerMinute).toBe(51);
  });

  it.each([null, undefined])('no data (%p, as a 204 gives) is no items', (body) => {
    for (const endpoint of ENDPOINTS) expect(mapPersonalResponse(endpoint, body)).toEqual({ items: [], skipped: 0 });
  });

  it('a range endpoint that answers with something other than a list skips it', () => {
    expect(mapPersonalResponse('dailySleepSummaries', { not: 'a list' })).toEqual({ items: [], skipped: 1 });
  });
});

describe('the mapper and the client agree on the endpoints', () => {
  it('every endpoint the client allows has a mapper, and nothing else has one', () => {
    expect([...GARMIN_PERSONAL_MAPPED_ENDPOINTS].sort()).toEqual([...GARMIN_PERSONAL_ENDPOINT_IDS].sort());
  });

  it.each(['steps', 'stress', 'activities', 'constructor', '__proto__', undefined])('an endpoint with no mapper (%p) throws garmin_personal_unmapped_endpoint', (endpoint) => {
    expect(() => mapPersonalResponse(endpoint, {})).toThrow(expect.objectContaining({ code: 'garmin_personal_unmapped_endpoint', message: 'garmin_personal_unmapped_endpoint' }));
  });
});
