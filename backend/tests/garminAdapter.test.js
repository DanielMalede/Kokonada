'use strict';

// Pure-unit tests for the Garmin Health API summary normalizer. No DB.
// Field names follow Garmin's documented Health API summary schema (gated docs);
// the normalizer is tolerant of the known rem-sleep name variant. Verify against
// the approved app's sandbox payloads before go-live.

const { normalizeGarminSummaries } = require('../app/services/wearable/adapter');
const { computeLastNightSleep } = require('../app/services/medicalProfileService');

const START = 1700000000; // epoch seconds
const startDate = new Date(START * 1000);
const HOUR = 60 * 60;
const NIGHT = 8 * HOUR;

// DELIBERATE RE-PIN (W4-004): every canonical record now carries `tzOffsetMinutes` — the wearer's
// own UTC offset, derived from Garmin's `startTimeOffsetInSeconds` when the summary supplies one
// and null otherwise. These assertions stay EXACT (toEqual, not toMatchObject) because their whole
// job is to catch an unexpected field; they simply declare the new one. `rec()` states the default
// once instead of scattering `tzOffsetMinutes: null` through twelve object literals.
const rec = (o) => ({ tzOffsetMinutes: null, ...o });
const recs = (...o) => o.map(rec);

describe('normalizeGarminSummaries — sleeps', () => {
  // DELIBERATE RE-PIN (T1): a night is stamped where it ENDS, the convention computeLastNightSleep
  // buckets by and the Health Connect lane already follows (it stamps sleep at endDate).
  const nightEnd = new Date((START + NIGHT) * 1000);

  it('maps deep/light/rem second-durations to per-night minute metrics, stamped at the night\'s end', () => {
    const out = normalizeGarminSummaries('sleeps', {
      startTimeInSeconds: START,
      durationInSeconds: NIGHT,
      deepSleepDurationInSeconds: 3600,
      lightSleepDurationInSeconds: 7200,
      remSleepInSeconds: 1800,
    });
    expect(out).toEqual(recs(
      { metric: 'sleepDeep', value: 60, unit: 'min', recordedAt: nightEnd, source: 'garmin' },
      { metric: 'sleepLight', value: 120, unit: 'min', recordedAt: nightEnd, source: 'garmin' },
      { metric: 'sleepRem', value: 30, unit: 'min', recordedAt: nightEnd, source: 'garmin' },
    ));
  });

  it('accepts the remSleepDurationInSeconds name variant', () => {
    const out = normalizeGarminSummaries('sleeps', {
      startTimeInSeconds: START,
      durationInSeconds: NIGHT,
      remSleepDurationInSeconds: 1200,
    });
    expect(out).toEqual([rec({ metric: 'sleepRem', value: 20, unit: 'min', recordedAt: nightEnd, source: 'garmin' })]);
  });

  it('files a night that starts before UTC midnight under the date it ENDS (computeLastNightSleep)', () => {
    const start = Date.UTC(2026, 9, 24, 21, 30) / 1000; // 21:30 UTC on the 24th, so it ends on the 25th
    const out = normalizeGarminSummaries('sleeps', {
      startTimeInSeconds: start,
      durationInSeconds: NIGHT,
      deepSleepDurationInSeconds: 3600,
      lightSleepDurationInSeconds: 14400,
      remSleepInSeconds: 5400,
    });
    expect(computeLastNightSleep(out)).toEqual({ deep: 60, light: 240, rem: 90, date: '2026-10-25' });
  });

  it('without durationInSeconds, ends the night at the latest segment end in sleepLevelsMap', () => {
    const out = normalizeGarminSummaries('sleeps', {
      startTimeInSeconds: START,
      deepSleepDurationInSeconds: 3600,
      sleepLevelsMap: {
        deep: [{ startTimeInSeconds: START, endTimeInSeconds: START + 3600 }],
        // the latest end sits in a list that is not the last one
        awake: [{ startTimeInSeconds: START + 27000, endTimeInSeconds: START + 27900 }],
        light: [{ startTimeInSeconds: START + 3600, endTimeInSeconds: START + 27000 }],
      },
    });
    expect(out).toEqual([rec({ metric: 'sleepDeep', value: 60, unit: 'min', recordedAt: new Date((START + 27900) * 1000), source: 'garmin' })]);
  });

  it('a duration longer than a day is not the night\'s end: the timeline decides', () => {
    const out = normalizeGarminSummaries('sleeps', {
      startTimeInSeconds: START,
      durationInSeconds: 3 * 24 * HOUR,
      deepSleepDurationInSeconds: 3600,
      sleepLevelsMap: { light: [{ startTimeInSeconds: START, endTimeInSeconds: START + 7 * HOUR }] },
    });
    expect(out[0].recordedAt).toEqual(new Date((START + 7 * HOUR) * 1000));
  });

  it('with no end anywhere, stamps the start: the only time the summary carries', () => {
    const out = normalizeGarminSummaries('sleeps', { startTimeInSeconds: START, deepSleepDurationInSeconds: 3600 });
    expect(out).toEqual([rec({ metric: 'sleepDeep', value: 60, unit: 'min', recordedAt: startDate, source: 'garmin' })]);
  });
});

describe('normalizeGarminSummaries — dailies', () => {
  it('maps resting HR and flattens timeOffsetHeartRateSamples', () => {
    const out = normalizeGarminSummaries('dailies', {
      startTimeInSeconds: START,
      restingHeartRateInBeatsPerMinute: 52,
      timeOffsetHeartRateSamples: { '0': 60, '60': 62 },
    });
    expect(out).toContainEqual(rec({ metric: 'restingHeartRate', value: 52, unit: 'bpm', recordedAt: startDate, source: 'garmin' }));
    expect(out).toContainEqual(rec({ metric: 'heartRate', value: 60, unit: 'bpm', recordedAt: new Date(START * 1000), source: 'garmin' }));
    expect(out).toContainEqual(rec({ metric: 'heartRate', value: 62, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' }));
  });
});

describe('normalizeGarminSummaries — heart rate keeps one real reading a minute (F10)', () => {
  // One hour of 15-second readings: 240 samples, four in every minute, with values that differ inside
  // each minute, so the kept one is identifiable and an average would be a number no reading had.
  const OFFSETS = Array.from({ length: 240 }, (_, i) => i * 15);
  const valueAt = (offset) => 50 + (((offset / 15) * 37) % 100);
  const hour = () => Object.fromEntries(OFFSETS.map((o) => [String(o), valueAt(o)]));

  it('one hour of 15-second samples yields exactly 60 records: the first reading of each minute, as recorded', () => {
    const out = normalizeGarminSummaries('dailies', { startTimeInSeconds: START, timeOffsetHeartRateSamples: hour() });
    expect(out).toHaveLength(60);
    expect(out).toEqual(Array.from({ length: 60 }, (_, minute) => rec({
      metric: 'heartRate', value: valueAt(minute * 60), unit: 'bpm', recordedAt: new Date((START + minute * 60) * 1000), source: 'garmin',
    })));
  });

  it('every kept record is a reading the input holds, value and time together: nothing averaged or synthesised', () => {
    const map = hour();
    const readings = new Set(Object.entries(map).map(([offset, v]) => `${(START + Number(offset)) * 1000}@${v}`));
    const out = normalizeGarminSummaries('dailies', { startTimeInSeconds: START, timeOffsetHeartRateSamples: map });
    expect(out.filter((r) => !readings.has(`${r.recordedAt.getTime()}@${r.value}`))).toEqual([]);
  });

  it('skips a bad first reading for the next good one in its minute, and still counts every out-of-range reading', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = normalizeGarminSummaries('dailies', {
        startTimeInSeconds: START,
        timeOffsetHeartRateSamples: {
          0: 300, 15: 0, 30: 72, 45: 73,     // minute 0: out of range, not a reading, then the keeper
          60: 61, 75: 400, 90: 62, 105: 63,  // minute 1: the keeper first, an out-of-range one after it
        },
      });
      expect(out).toEqual(recs(
        { metric: 'heartRate', value: 72, unit: 'bpm', recordedAt: new Date((START + 30) * 1000), source: 'garmin' },
        { metric: 'heartRate', value: 61, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' },
      ));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 2'));
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the EARLIEST reading of a minute, not the first one the map iterates', () => {
    // '015' is not an array-index key, so JavaScript iterates it AFTER '30' and '45'.
    const out = normalizeGarminSummaries('dailies', { startTimeInSeconds: START, timeOffsetHeartRateSamples: { '30': 63, '45': 64, '015': 62 } });
    expect(out).toEqual([rec({ metric: 'heartRate', value: 62, unit: 'bpm', recordedAt: new Date((START + 15) * 1000), source: 'garmin' })]);
  });

  it('a reading whose offset is not a number is dropped, never stored undated', () => {
    const out = normalizeGarminSummaries('dailies', { startTimeInSeconds: START, timeOffsetHeartRateSamples: { abc: 70, '60': 61 } });
    expect(out).toEqual([rec({ metric: 'heartRate', value: 61, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' })]);
  });

  it('only heart rate is thinned: another offset series keeps every reading', () => {
    const out = normalizeGarminSummaries('pulseox', { startTimeInSeconds: START, timeOffsetSpo2Values: { 0: 97, 15: 96, 30: 98 } });
    expect(out.map((r) => r.value)).toEqual([97, 96, 98]);
  });
});

describe('normalizeGarminSummaries — hrv / respiration / pulseox / stress', () => {
  // DELIBERATE RE-PIN (T1): HRV is the night's, so it is stamped where its window ends (as sleep is),
  // and it names its statistic: Garmin computes HRV as RMSSD, which VitalSample keeps apart from
  // Apple's SDNN.
  it('maps hrv lastNightAvg, stamped at the end of its window and labelled RMSSD', () => {
    const out = normalizeGarminSummaries('hrv', { startTimeInSeconds: START, durationInSeconds: NIGHT, lastNightAvg: 48 });
    expect(out).toEqual([rec({
      metric: 'hrv', value: 48, unit: 'ms', recordedAt: new Date((START + NIGHT) * 1000), source: 'garmin', hrvMethod: 'rmssd',
    })]);
  });

  it('an hrv summary without a usable duration is stamped at its start, and is still RMSSD', () => {
    for (const durationInSeconds of [undefined, 0, -60, 3 * 24 * HOUR, 'x']) {
      const out = normalizeGarminSummaries('hrv', { startTimeInSeconds: START, durationInSeconds, lastNightAvg: 48 });
      expect(out).toEqual([rec({ metric: 'hrv', value: 48, unit: 'ms', recordedAt: startDate, source: 'garmin', hrvMethod: 'rmssd' })]);
    }
  });

  it('maps respiration timeOffsetEpochToBreaths', () => {
    const out = normalizeGarminSummaries('respiration', {
      startTimeInSeconds: START,
      timeOffsetEpochToBreaths: { '0': 14, '60': 15 },
    });
    expect(out.map(m => m.metric)).toEqual(['respirationRate', 'respirationRate']);
    expect(out[0]).toMatchObject({ value: 14, unit: 'brpm', source: 'garmin' });
  });

  it('maps pulseox timeOffsetSpo2Values', () => {
    const out = normalizeGarminSummaries('pulseox', {
      startTimeInSeconds: START,
      timeOffsetSpo2Values: { '0': 97 },
    });
    expect(out).toEqual([rec({ metric: 'spO2', value: 97, unit: '%', recordedAt: startDate, source: 'garmin' })]);
  });

  it('maps stressDetails body battery values (proprietary metric Health Connect strips)', () => {
    const out = normalizeGarminSummaries('stressDetails', {
      startTimeInSeconds: START,
      timeOffsetBodyBatteryValues: { '0': 75, '60': 74 },
    });
    expect(out.map(m => m.metric)).toEqual(['bodyBattery', 'bodyBattery']);
    expect(out[0]).toMatchObject({ value: 75, source: 'garmin' });
  });
});

describe('normalizeGarminSummaries — robustness', () => {
  it('returns [] for an unknown summary type', () => {
    expect(normalizeGarminSummaries('userMetrics', { startTimeInSeconds: START })).toEqual([]);
  });

  it('drops non-finite / non-positive values', () => {
    const out = normalizeGarminSummaries('dailies', {
      startTimeInSeconds: START,
      restingHeartRateInBeatsPerMinute: -1, // Garmin invalid sentinel
      timeOffsetHeartRateSamples: { '0': 0, '60': 61 },
    });
    expect(out).toEqual([rec({ metric: 'heartRate', value: 61, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' })]);
  });
});

// RA-2 of #275: a time a Date cannot hold (past ±8.64e12 s) is still a finite number, so it passed the start
// check, and every record of such a summary carried an Invalid Date, which no filter can compare and Mongo
// cannot cast. No record leaves the normaliser without a time a Date holds.
describe('normalizeGarminSummaries — a time a Date cannot hold (RA-2 of #275)', () => {
  const LAST = 8.64e12; // the last second a Date can hold

  it.each([['far future', 1e13], ['far past', -1e13]])('a %s start: no record, as for a summary with no start', (_label, start) => {
    expect(Number.isNaN(new Date(start * 1000).getTime())).toBe(true);
    expect(normalizeGarminSummaries('dailies', { startTimeInSeconds: start, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61 } })).toEqual([]);
    expect(normalizeGarminSummaries('sleeps', { startTimeInSeconds: start, durationInSeconds: NIGHT, deepSleepDurationInSeconds: 3600 })).toEqual([]);
    expect(normalizeGarminSummaries('hrv', { startTimeInSeconds: start, durationInSeconds: NIGHT, lastNightAvg: 48 })).toEqual([]);
  });

  it('a night whose end a Date cannot hold: no record', () => {
    const start = LAST - HOUR; // a time a Date holds, an hour before the last one
    expect(Number.isFinite(new Date(start * 1000).getTime())).toBe(true);
    expect(normalizeGarminSummaries('sleeps', { startTimeInSeconds: start, durationInSeconds: NIGHT, deepSleepDurationInSeconds: 3600 })).toEqual([]);
    expect(normalizeGarminSummaries('hrv', { startTimeInSeconds: start, durationInSeconds: NIGHT, lastNightAvg: 48 })).toEqual([]);
  });

  it('a reading whose own time a Date cannot hold is left out, and its neighbour is kept', () => {
    const out = normalizeGarminSummaries('dailies', { startTimeInSeconds: START, timeOffsetHeartRateSamples: { [1e13]: 70, 60: 61 } });
    expect(out).toEqual([rec({ metric: 'heartRate', value: 61, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' })]);
  });
});

describe('normalizeGarminSummaries — physiological range bounds (audit T2.2)', () => {
  it('drops out-of-range heart-rate samples but keeps in-range ones', () => {
    const out = normalizeGarminSummaries('dailies', {
      startTimeInSeconds: START,
      timeOffsetHeartRateSamples: { '0': 300, '60': 61 }, // 300 bpm is physiologically impossible
    });
    expect(out).toEqual([rec({ metric: 'heartRate', value: 61, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' })]);
  });

  it('drops an impossible resting HR (> 260)', () => {
    const out = normalizeGarminSummaries('dailies', { startTimeInSeconds: START, restingHeartRateInBeatsPerMinute: 500 });
    expect(out).toEqual([]);
  });

  it('drops an out-of-range SpO2 (< 50%)', () => {
    const out = normalizeGarminSummaries('pulseox', { startTimeInSeconds: START, timeOffsetSpo2Values: { '0': 40 } });
    expect(out).toEqual([]);
  });

  it('drops an out-of-range HRV (> 500 ms)', () => {
    const out = normalizeGarminSummaries('hrv', { startTimeInSeconds: START, lastNightAvg: 600 });
    expect(out).toEqual([]);
  });

  it('logs a count of the dropped out-of-range values', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      normalizeGarminSummaries('dailies', { startTimeInSeconds: START, timeOffsetHeartRateSamples: { '0': 300, '60': 400 } });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 2'));
    } finally {
      warn.mockRestore();
    }
  });
});
