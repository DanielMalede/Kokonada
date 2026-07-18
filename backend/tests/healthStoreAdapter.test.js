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
});

describe('normalizeHealthStoreSamples — Health Connect (Android)', () => {
  it('labels samples with the health_connect source', () => {
    const [r] = normalizeHealthStoreSamples('health_connect', [
      { type: 'heart_rate', value: 80, startDate: ts },
    ]);
    expect(r.source).toBe('health_connect');
  });
});

// GDPR Art.9 (audit follow-up): spo2 / respiratory_rate are Garmin-only special categories that
// are NOT part of the mobile HEALTH_CONNECT_DATA_CATEGORIES — no shipped client sends them and
// Health Connect never reads them. The server MUST NOT emit them on this lane; they may flow only
// via the (v2-gated) Garmin server-to-server lane. Dropping them from HEALTH_METRIC_MAP is the
// leak-source fix (healthStore.ingestBatch's consent-version gate is the defense-in-depth backstop).
describe('normalizeHealthStoreSamples — special categories are NOT on the Health-Connect lane', () => {
  it('drops a HealthKit spo2 sample (no spO2 metric emitted)', () => {
    expect(normalizeHealthStoreSamples('healthkit', [{ type: 'spo2', value: 0.97, startDate: ts }])).toEqual([]);
  });

  it('drops a Health Connect spo2 sample (no spO2 metric emitted)', () => {
    expect(normalizeHealthStoreSamples('health_connect', [{ type: 'spo2', value: 96, startDate: ts }])).toEqual([]);
  });

  it('drops a respiratory_rate sample (no respirationRate metric emitted)', () => {
    expect(normalizeHealthStoreSamples('healthkit', [{ type: 'respiratory_rate', value: 14, startDate: ts }])).toEqual([]);
  });

  it('never emits spO2/respirationRate even mixed with HC-lane samples — those still pass', () => {
    const metrics = normalizeHealthStoreSamples('health_connect', [
      { type: 'heart_rate', value: 70, startDate: ts },
      { type: 'spo2', value: 96, startDate: ts },
      { type: 'resting_heart_rate', value: 55, startDate: ts },
      { type: 'respiratory_rate', value: 14, startDate: ts },
      { type: 'hrv', value: 42, startDate: ts },
      { type: 'sleep_deep', value: 60, startDate: ts },
    ]).map((r) => r.metric);
    expect(metrics).not.toContain('spO2');
    expect(metrics).not.toContain('respirationRate');
    // HC-lane (HEALTH_CONNECT_DATA_CATEGORIES) is unaffected — all still normalize.
    expect(metrics).toEqual(expect.arrayContaining(['heartRate', 'restingHeartRate', 'hrv', 'sleepDeep']));
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
