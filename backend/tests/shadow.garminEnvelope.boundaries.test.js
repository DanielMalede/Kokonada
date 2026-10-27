'use strict';

// BE-189 (RA-1) and BE-190 (RA-2), the resilience audit of #273 at 326ecb4: the personal-lane envelope's
// edges (services/wearable/garminPersonalEnvelope.js).
//
//   · RA-1. Garmin sends an optional field it has no value for as null (a day with no resting heart rate).
//     zod's .optional() admits a missing key but refuses null, so one null refused the whole envelope. A
//     null field is now an absent one. A null READING inside an offset map is still refused: it is a value,
//     not a field.
//   · RA-1, the siblings. The envelope stays all-or-nothing: one bad item refuses it. Its caller (the T4
//     pull job) wraps ONE item per envelope, so a bad item is refused alone and reported by its index while
//     its siblings are admitted. That contract is pinned here.
//   · RA-2. A sleeps or hrv summary with no end (no durationInSeconds and, for sleep, no level segment
//     ending after its start and within a day of it) passed, and the normaliser stamped it at its START,
//     re-opening the night mis-dating #273 fixed. It is now refused as invalid_garmin_summary. The webhook
//     lane has no envelope and keeps the normaliser's fallback (garminAdapter.test.js pins it); that lane's
//     end-less night is a separate row.
//   · RA-2, the property (fast-check): whatever the envelope admits, every record the normaliser makes of a
//     night is stamped at an end, after the summary's start and within a day of it, never at the start.
//
// Pure: no database, no network, a fixed clock.

const fc = require('fast-check');
const {
  parseGarminPersonalEnvelope,
  GARMIN_PERSONAL_ENVELOPE_VERSION,
  ENVELOPE_ERROR_CODES,
} = require('../app/services/wearable/garminPersonalEnvelope');
const { normalizeGarminSummaries, MAX_WINDOW_SECONDS } = require('../app/services/wearable/adapter');

const NOW = new Date('2026-10-27T12:00:00.000Z');
const NOW_SEC = NOW.getTime() / 1000;
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const START = NOW_SEC - 2 * DAY; // a settled day, two days back

const envelope = (items) => ({ schemaVersion: GARMIN_PERSONAL_ENVELOPE_VERSION, items });
const parse = (items) => parseGarminPersonalEnvelope(envelope(items), { now: NOW });
function codeOf(items) {
  try {
    parse(items);
  } catch (e) {
    return e.code;
  }
  throw new Error('expected the envelope to be refused');
}

// The dormant consent-v2 flag makes the normaliser emit steps; nothing here wants it.
beforeEach(() => { delete process.env.WAVE4_CONSENT_V2_METRICS; });

describe('RA-1: a null field is an absent one (BE-189)', () => {
  it('a day with no resting heart rate (null) is admitted, and its heart rate still flows', () => {
    const item = { type: 'dailies', summary: { startTimeInSeconds: START, restingHeartRateInBeatsPerMinute: null, timeOffsetHeartRateSamples: { 0: 61 } } };

    const [admitted] = parse([item]).items;

    expect(admitted.summary).toEqual({ startTimeInSeconds: START, timeOffsetHeartRateSamples: { 0: 61 } });
    expect(admitted.summary).not.toHaveProperty('restingHeartRateInBeatsPerMinute');
    expect(normalizeGarminSummaries(admitted.type, admitted.summary).map((r) => r.metric)).toEqual(['heartRate']);
  });

  const segment = { startTimeInSeconds: START, endTimeInSeconds: START + 7 * HOUR };
  it.each([
    ['dailies', 'startTimeOffsetInSeconds', { restingHeartRateInBeatsPerMinute: 52 }],
    ['dailies', 'timeOffsetHeartRateSamples', { restingHeartRateInBeatsPerMinute: 52 }],
    ['sleeps', 'durationInSeconds', { deepSleepDurationInSeconds: 3600, sleepLevelsMap: { deep: [segment] } }],
    ['sleeps', 'sleepLevelsMap', { durationInSeconds: 8 * HOUR, deepSleepDurationInSeconds: 3600 }],
    ['sleeps', 'remSleepInSeconds', { durationInSeconds: 8 * HOUR, remSleepDurationInSeconds: 1800 }],
    ['sleeps', 'deepSleepDurationInSeconds', { durationInSeconds: 8 * HOUR, lightSleepDurationInSeconds: 14400 }],
    ['hrv', 'lastNightAvg', { durationInSeconds: 8 * HOUR }],
    ['hrv', 'startTimeOffsetInSeconds', { durationInSeconds: 8 * HOUR, lastNightAvg: 48 }],
  ])('%s: a null %s is admitted as absent', (type, field, rest) => {
    const [admitted] = parse([{ type, summary: { startTimeInSeconds: START, ...rest, [field]: null } }]).items;

    expect(admitted.summary).not.toHaveProperty(field);
    expect(admitted.summary).toEqual({ startTimeInSeconds: START, ...rest });
  });

  it('a null sleep level is absent too; the levels that carry segments stay', () => {
    const summary = { startTimeInSeconds: START, durationInSeconds: 8 * HOUR, deepSleepDurationInSeconds: 3600, sleepLevelsMap: { deep: null, light: [segment] } };

    const [admitted] = parse([{ type: 'sleeps', summary }]).items;

    expect(admitted.summary.sleepLevelsMap).toEqual({ light: [segment] });
  });

  it.each([
    ['a null start', { type: 'dailies', summary: { startTimeInSeconds: null, restingHeartRateInBeatsPerMinute: 52 } }],
    ['a null reading in an offset map', { type: 'dailies', summary: { startTimeInSeconds: START, timeOffsetHeartRateSamples: { 0: null } } }],
    ['a null segment end', { type: 'sleeps', summary: { startTimeInSeconds: START, durationInSeconds: 8 * HOUR, sleepLevelsMap: { deep: [{ startTimeInSeconds: START, endTimeInSeconds: null }] } } }],
  ])('a null where a value is required is still refused: %s', (_label, item) => {
    expect(codeOf([item])).toBe('invalid_garmin_summary');
  });

  it('the caller\'s object is left untouched: dropping a null builds a copy', () => {
    const items = [
      { type: 'dailies', summary: { startTimeInSeconds: START, restingHeartRateInBeatsPerMinute: null, timeOffsetHeartRateSamples: { 0: 61 } } },
      { type: 'sleeps', summary: { startTimeInSeconds: START, durationInSeconds: 8 * HOUR, deepSleepDurationInSeconds: 3600, sleepLevelsMap: { deep: null, light: [segment] } } },
    ];
    const before = JSON.stringify(items);

    parse(items);

    expect(JSON.stringify(items)).toBe(before);
  });
});

describe('RA-1, the siblings: one item per envelope is the caller\'s isolation (BE-189)', () => {
  const good = (n) => ({ type: 'dailies', summary: { startTimeInSeconds: START + n * HOUR, restingHeartRateInBeatsPerMinute: 50 + n } });
  const bad = { type: 'sleeps', summary: { startTimeInSeconds: START, deepSleepDurationInSeconds: 3600 } }; // a night with no end

  it('one bad item refuses its whole envelope: the envelope is all-or-nothing', () => {
    expect(codeOf([good(0), bad, good(2)])).toBe('invalid_garmin_summary');
  });

  it('wrapped one item per envelope, the good siblings are admitted and the bad one is reported by its index', () => {
    const items = [good(0), bad, good(2)];

    const outcomes = items.map((item, index) => {
      try {
        return { index, admitted: parse([item]).items[0] };
      } catch (e) {
        return { index, refused: e.code };
      }
    });

    expect(outcomes.filter((o) => o.admitted).map((o) => o.admitted)).toEqual([good(0), good(2)]);
    expect(outcomes.filter((o) => o.refused)).toEqual([{ index: 1, refused: 'invalid_garmin_summary' }]);
  });
});

describe('RA-2: a night that cannot say where it ends is refused (BE-190)', () => {
  it.each([
    ['a sleeps summary with no duration and no sleep levels', { startTimeInSeconds: START, deepSleepDurationInSeconds: 3600 }],
    ['a sleeps summary whose duration is null and has no levels', { startTimeInSeconds: START, durationInSeconds: null, deepSleepDurationInSeconds: 3600 }],
    ['a sleeps summary whose levels are empty', { startTimeInSeconds: START, deepSleepDurationInSeconds: 3600, sleepLevelsMap: { deep: [], light: [] } }],
    ['a sleeps summary whose only segment ends at its start', {
      startTimeInSeconds: START, deepSleepDurationInSeconds: 3600, sleepLevelsMap: { deep: [{ startTimeInSeconds: START - HOUR, endTimeInSeconds: START }] },
    }],
    ['a sleeps summary whose only segment ends more than a day after its start', {
      startTimeInSeconds: START - 2 * DAY, deepSleepDurationInSeconds: 3600, sleepLevelsMap: { deep: [{ startTimeInSeconds: START - 2 * DAY, endTimeInSeconds: START - DAY + 1 }] },
    }],
  ])('%s → invalid_garmin_summary', (_label, summary) => {
    expect(codeOf([{ type: 'sleeps', summary }])).toBe('invalid_garmin_summary');
  });

  it.each([
    ['with no duration', { startTimeInSeconds: START, lastNightAvg: 48 }],
    ['whose duration is null', { startTimeInSeconds: START, durationInSeconds: null, lastNightAvg: 48 }],
  ])('an hrv summary %s → invalid_garmin_summary', (_label, summary) => {
    expect(codeOf([{ type: 'hrv', summary }])).toBe('invalid_garmin_summary');
  });

  // The controls: each way a night can end is admitted and stamped there, and a day needs no end.
  it.each([
    ['a sleeps summary that ends by its duration', 'sleeps', { durationInSeconds: 8 * HOUR, deepSleepDurationInSeconds: 3600 }, START + 8 * HOUR],
    ['a sleeps summary that ends by its sleep levels alone', 'sleeps', {
      deepSleepDurationInSeconds: 3600,
      sleepLevelsMap: { deep: [{ startTimeInSeconds: START, endTimeInSeconds: START + HOUR }], awake: [{ startTimeInSeconds: START + 6 * HOUR, endTimeInSeconds: START + 7 * HOUR }] },
    }, START + 7 * HOUR],
    ['an hrv summary that ends by its duration', 'hrv', { durationInSeconds: 8 * HOUR, lastNightAvg: 48 }, START + 8 * HOUR],
  ])('%s is admitted and stamped at that end', (_label, type, rest, endSec) => {
    const [admitted] = parse([{ type, summary: { startTimeInSeconds: START, ...rest } }]).items;
    const records = normalizeGarminSummaries(admitted.type, admitted.summary);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) expect(r.recordedAt).toEqual(new Date(endSec * 1000));
  });

  it('a dailies summary needs no end: the rule is the night types\'', () => {
    expect(parse([{ type: 'dailies', summary: { startTimeInSeconds: START, restingHeartRateInBeatsPerMinute: 52 } }]).items).toHaveLength(1);
  });
});

describe('RA-2, the property: whatever the envelope admits is stamped at an end, never its start (BE-190)', () => {
  // Night-type summaries with a duration that is valid, absent, null, zero, negative, fractional or longer
  // than a day, and sleep levels whose segments end before, at, after, or more than a day after the start.
  const duration = fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.integer({ min: 1, max: MAX_WINDOW_SECONDS }),
    fc.integer({ min: MAX_WINDOW_SECONDS + 1, max: 3 * DAY }),
    fc.integer({ min: -DAY, max: 0 }),
    fc.double({ min: 1, max: DAY, noNaN: true }),
  );
  const levels = (startSec) => fc.option(
    fc.dictionary(
      fc.constantFrom('deep', 'light', 'rem', 'awake'),
      fc.oneof(
        fc.constant(null),
        fc.array(
          fc.record({ from: fc.integer({ min: -DAY, max: 2 * DAY }), length: fc.integer({ min: 0, max: 2 * DAY }) })
            .map(({ from, length }) => ({ startTimeInSeconds: startSec + from, endTimeInSeconds: startSec + from + length })),
          { maxLength: 4 },
        ),
      ),
    ),
    { nil: undefined },
  );
  const withField = (summary, key, value) => (value === undefined ? summary : { ...summary, [key]: value });
  const night = fc.integer({ min: NOW_SEC - 60 * DAY, max: NOW_SEC - 3 * DAY }).chain((startSec) => fc.oneof(
    fc.record({ d: duration, l: levels(startSec), deep: fc.integer({ min: 60, max: 4 * HOUR }) }).map(({ d, l, deep }) => ({
      type: 'sleeps',
      summary: withField(withField({ startTimeInSeconds: startSec, deepSleepDurationInSeconds: deep }, 'durationInSeconds', d), 'sleepLevelsMap', l),
    })),
    fc.record({ d: duration, v: fc.integer({ min: 10, max: 200 }) }).map(({ d, v }) => ({
      type: 'hrv',
      summary: withField({ startTimeInSeconds: startSec, lastNightAvg: v }, 'durationInSeconds', d),
    })),
  ));

  it('every sleep and HRV record of an admitted summary lands after its start and within a day of it', () => {
    let admitted = 0;
    let refused = 0;
    fc.assert(fc.property(night, (item) => {
      let parsed;
      try {
        [parsed] = parse([item]).items;
      } catch (e) {
        refused += 1;
        return ENVELOPE_ERROR_CODES.includes(e.code);
      }
      admitted += 1;
      const startMs = parsed.summary.startTimeInSeconds * 1000;
      const records = normalizeGarminSummaries(parsed.type, parsed.summary);
      return records.length > 0 && records.every((r) => {
        const at = r.recordedAt.getTime();
        return at > startMs && at <= startMs + MAX_WINDOW_SECONDS * 1000;
      });
    }), { numRuns: 2000 });

    // Non-vacuous: the generator really reaches both sides of the rule.
    expect(admitted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });
});
