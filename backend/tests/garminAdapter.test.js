'use strict';

// Pure-unit tests for the Garmin Health API summary normalizer. No DB.
// Field names follow Garmin's documented Health API summary schema (gated docs);
// the normalizer is tolerant of the known rem-sleep name variant. Verify against
// the approved app's sandbox payloads before go-live.

const { normalizeGarminSummaries } = require('../app/services/wearable/adapter');

const START = 1700000000; // epoch seconds
const startDate = new Date(START * 1000);

describe('normalizeGarminSummaries — sleeps', () => {
  it('maps deep/light/rem second-durations to per-night minute metrics', () => {
    const out = normalizeGarminSummaries('sleeps', {
      startTimeInSeconds: START,
      deepSleepDurationInSeconds: 3600,
      lightSleepDurationInSeconds: 7200,
      remSleepInSeconds: 1800,
    });
    expect(out).toEqual([
      { metric: 'sleepDeep', value: 60, unit: 'min', recordedAt: startDate, source: 'garmin' },
      { metric: 'sleepLight', value: 120, unit: 'min', recordedAt: startDate, source: 'garmin' },
      { metric: 'sleepRem', value: 30, unit: 'min', recordedAt: startDate, source: 'garmin' },
    ]);
  });

  it('accepts the remSleepDurationInSeconds name variant', () => {
    const out = normalizeGarminSummaries('sleeps', {
      startTimeInSeconds: START,
      remSleepDurationInSeconds: 1200,
    });
    expect(out).toEqual([{ metric: 'sleepRem', value: 20, unit: 'min', recordedAt: startDate, source: 'garmin' }]);
  });
});

describe('normalizeGarminSummaries — dailies', () => {
  it('maps resting HR and flattens timeOffsetHeartRateSamples', () => {
    const out = normalizeGarminSummaries('dailies', {
      startTimeInSeconds: START,
      restingHeartRateInBeatsPerMinute: 52,
      timeOffsetHeartRateSamples: { '0': 60, '60': 62 },
    });
    expect(out).toContainEqual({ metric: 'restingHeartRate', value: 52, unit: 'bpm', recordedAt: startDate, source: 'garmin' });
    expect(out).toContainEqual({ metric: 'heartRate', value: 60, unit: 'bpm', recordedAt: new Date(START * 1000), source: 'garmin' });
    expect(out).toContainEqual({ metric: 'heartRate', value: 62, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' });
  });
});

describe('normalizeGarminSummaries — hrv / respiration / pulseox / stress', () => {
  it('maps hrv lastNightAvg', () => {
    const out = normalizeGarminSummaries('hrv', { startTimeInSeconds: START, lastNightAvg: 48 });
    expect(out).toEqual([{ metric: 'hrv', value: 48, unit: 'ms', recordedAt: startDate, source: 'garmin' }]);
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
    expect(out).toEqual([{ metric: 'spO2', value: 97, unit: '%', recordedAt: startDate, source: 'garmin' }]);
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
    expect(out).toEqual([{ metric: 'heartRate', value: 61, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' }]);
  });
});

describe('normalizeGarminSummaries — physiological range bounds (audit T2.2)', () => {
  it('drops out-of-range heart-rate samples but keeps in-range ones', () => {
    const out = normalizeGarminSummaries('dailies', {
      startTimeInSeconds: START,
      timeOffsetHeartRateSamples: { '0': 300, '60': 61 }, // 300 bpm is physiologically impossible
    });
    expect(out).toEqual([{ metric: 'heartRate', value: 61, unit: 'bpm', recordedAt: new Date((START + 60) * 1000), source: 'garmin' }]);
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
