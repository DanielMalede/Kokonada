import {
  mapHeartRate,
  mapHrv,
  mapSleep,
  toBackendSamples,
  summarizeSleep,
} from '../mapToBackend';

describe('mapHeartRate', () => {
  it('flattens per-record samples into heart_rate entries', () => {
    const records = [
      { samples: [{ time: '2026-01-01T10:00:00Z', beatsPerMinute: 70 }, { time: '2026-01-01T10:01:00Z', beatsPerMinute: 72 }] },
      { samples: [{ time: '2026-01-01T11:00:00Z', beatsPerMinute: 65 }] },
    ];
    expect(mapHeartRate(records)).toEqual([
      { type: 'heart_rate', value: 70, startDate: '2026-01-01T10:00:00Z' },
      { type: 'heart_rate', value: 72, startDate: '2026-01-01T10:01:00Z' },
      { type: 'heart_rate', value: 65, startDate: '2026-01-01T11:00:00Z' },
    ]);
  });

  it('tolerates records with no samples array', () => {
    expect(mapHeartRate([{}])).toEqual([]);
  });
});

describe('mapHrv', () => {
  it('maps heartRateVariabilityMillis to hrv entries', () => {
    const records = [{ time: '2026-01-01T03:00:00Z', heartRateVariabilityMillis: 42 }];
    expect(mapHrv(records)).toEqual([{ type: 'hrv', value: 42, startDate: '2026-01-01T03:00:00Z' }]);
  });
});

describe('toBackendSamples', () => {
  it('combines HR + HRV and drops non-finite values', () => {
    const out = toBackendSamples({
      heartRate: [{ samples: [{ time: 't1', beatsPerMinute: 80 }, { time: 't2', beatsPerMinute: null }] }],
      hrv: [{ time: 't3', heartRateVariabilityMillis: 50 }],
    });
    expect(out).toEqual([
      { type: 'heart_rate', value: 80, startDate: 't1' },
      { type: 'hrv', value: 50, startDate: 't3' },
    ]);
  });
});

describe('mapSleep', () => {
  it('emits one per-stage minute sample per session for deep/light/rem', () => {
    const records = [
      {
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T06:00:00Z',
        stages: [
          { stage: 5, startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T01:00:00Z' }, // 60m deep
          { stage: 4, startTime: '2026-01-01T01:00:00Z', endTime: '2026-01-01T03:00:00Z' }, // 120m light
          { stage: 6, startTime: '2026-01-01T03:00:00Z', endTime: '2026-01-01T03:30:00Z' }, // 30m rem
          { stage: 1, startTime: '2026-01-01T03:30:00Z', endTime: '2026-01-01T03:40:00Z' }, // awake — ignored
        ],
      },
    ];
    expect(mapSleep(records)).toEqual([
      { type: 'sleep_deep', value: 60, startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-01T06:00:00Z' },
      { type: 'sleep_light', value: 120, startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-01T06:00:00Z' },
      { type: 'sleep_rem', value: 30, startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-01T06:00:00Z' },
    ]);
  });
});

describe('toBackendSamples with sleep', () => {
  it('includes sleep stage samples alongside HR and HRV', () => {
    const out = toBackendSamples({
      heartRate: [{ samples: [{ time: 't', beatsPerMinute: 70 }] }],
      sleep: [{ startTime: 's', endTime: 'e', stages: [{ stage: 5, startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T01:00:00Z' }] }],
    });
    expect(out).toContainEqual({ type: 'sleep_deep', value: 60, startDate: 's', endDate: 'e' });
    expect(out).toContainEqual({ type: 'heart_rate', value: 70, startDate: 't' });
  });
});

describe('summarizeSleep', () => {
  it('sums minutes per stage across sessions', () => {
    const records = [
      {
        stages: [
          { stage: 5, startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T01:00:00Z' }, // 60m deep
          { stage: 4, startTime: '2026-01-01T01:00:00Z', endTime: '2026-01-01T03:00:00Z' }, // 120m light
          { stage: 6, startTime: '2026-01-01T03:00:00Z', endTime: '2026-01-01T03:30:00Z' }, // 30m rem
        ],
      },
    ];
    expect(summarizeSleep(records)).toEqual({
      sessions: 1,
      deepMinutes: 60,
      lightMinutes: 120,
      remMinutes: 30,
      awakeMinutes: 0,
    });
  });
});

describe('mapRestingHeartRate (D-4a — the classifier input that was never sent)', () => {
  it('maps RestingHeartRate records to resting_heart_rate samples', () => {
    const { mapRestingHeartRate } = require('../mapToBackend');
    expect(mapRestingHeartRate([{ time: '2026-01-01T08:00:00Z', beatsPerMinute: 52 }])).toEqual([
      { type: 'resting_heart_rate', value: 52, startDate: '2026-01-01T08:00:00Z' },
    ]);
  });

  it('toBackendSamples includes resting HR and drops non-numeric values', () => {
    const { toBackendSamples } = require('../mapToBackend');
    const out = toBackendSamples({
      heartRate: [], hrv: [], sleep: [],
      restingHeartRate: [
        { time: 't1', beatsPerMinute: 51 },
        { time: 't2', beatsPerMinute: null },
        { time: 't3', beatsPerMinute: NaN },
      ],
    });
    expect(out).toEqual([{ type: 'resting_heart_rate', value: 51, startDate: 't1' }]);
  });
});
