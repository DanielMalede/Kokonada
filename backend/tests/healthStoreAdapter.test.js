'use strict';

// Pure-unit tests for the multi-metric HealthKit / Health Connect normalizer.
// No DB or mongoose — same style as the normalize() adapter tests in integrations.test.js.

const { normalizeHealthStoreSamples } = require('../app/services/wearable/adapter');

const ts = '2026-01-15T03:30:00Z';

describe('normalizeHealthStoreSamples — HealthKit (iOS)', () => {
  it('maps a heart rate sample to a canonical heartRate record with apple_health source', () => {
    const out = normalizeHealthStoreSamples('healthkit', [
      { type: 'heart_rate', value: 72, startDate: ts },
    ]);
    expect(out).toEqual([
      { metric: 'heartRate', value: 72, unit: 'bpm', recordedAt: new Date(ts), source: 'apple_health' },
    ]);
  });

  it('maps resting heart rate to the restingHeartRate metric', () => {
    const [r] = normalizeHealthStoreSamples('healthkit', [
      { type: 'resting_heart_rate', value: 55, startDate: ts },
    ]);
    expect(r.metric).toBe('restingHeartRate');
    expect(r.value).toBe(55);
    expect(r.unit).toBe('bpm');
  });

  it('maps HRV (SDNN) to the hrv metric in ms', () => {
    const [r] = normalizeHealthStoreSamples('healthkit', [
      { type: 'hrv', value: 42, startDate: ts },
    ]);
    expect(r.metric).toBe('hrv');
    expect(r.value).toBe(42);
    expect(r.unit).toBe('ms');
  });

  it('maps respiratory rate to the respirationRate metric', () => {
    const [r] = normalizeHealthStoreSamples('healthkit', [
      { type: 'respiratory_rate', value: 14, startDate: ts },
    ]);
    expect(r.metric).toBe('respirationRate');
    expect(r.value).toBe(14);
  });

  it('converts HealthKit SpO2 fraction (0–1) to a 0–100 percentage', () => {
    const [r] = normalizeHealthStoreSamples('healthkit', [
      { type: 'spo2', value: 0.97, startDate: ts },
    ]);
    expect(r.metric).toBe('spO2');
    expect(r.value).toBe(97); // 0.97 → 97, not 97.0000001
    expect(r.unit).toBe('%');
  });
});

describe('normalizeHealthStoreSamples — Health Connect (Android)', () => {
  it('labels samples with the health_connect source', () => {
    const [r] = normalizeHealthStoreSamples('health_connect', [
      { type: 'heart_rate', value: 80, startDate: ts },
    ]);
    expect(r.source).toBe('health_connect');
  });

  it('keeps Health Connect SpO2 as an already-percentage value', () => {
    const [r] = normalizeHealthStoreSamples('health_connect', [
      { type: 'spo2', value: 96, startDate: ts },
    ]);
    expect(r.metric).toBe('spO2');
    expect(r.value).toBe(96);
  });
});

describe('normalizeHealthStoreSamples — sleep stages', () => {
  it('maps sleep stage minutes to sleepDeep/sleepLight/sleepRem metrics', () => {
    const out = normalizeHealthStoreSamples('health_connect', [
      { type: 'sleep_deep', value: 60, startDate: ts },
      { type: 'sleep_light', value: 120, startDate: ts },
      { type: 'sleep_rem', value: 30, startDate: ts },
    ]);
    expect(out.map((r) => r.metric)).toEqual(['sleepDeep', 'sleepLight', 'sleepRem']);
    expect(out[0]).toEqual(
      expect.objectContaining({ metric: 'sleepDeep', value: 60, unit: 'min', source: 'health_connect' }),
    );
  });
});

describe('normalizeHealthStoreSamples — robustness', () => {
  it('drops samples of unrecognised metric types', () => {
    const out = normalizeHealthStoreSamples('healthkit', [
      { type: 'blood_glucose', value: 5, startDate: ts },
      { type: 'heart_rate', value: 70, startDate: ts },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].metric).toBe('heartRate');
  });

  it('drops samples whose value is not a finite number', () => {
    const out = normalizeHealthStoreSamples('healthkit', [
      { type: 'heart_rate', value: null, startDate: ts },
      { type: 'hrv', value: 'NaN', startDate: ts },
    ]);
    expect(out).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeHealthStoreSamples('healthkit', [])).toEqual([]);
  });

  it('throws on an unrecognised platform', () => {
    expect(() => normalizeHealthStoreSamples('fitbit', [{ type: 'heart_rate', value: 70, startDate: ts }]))
      .toThrow('Unknown health platform');
  });
});
