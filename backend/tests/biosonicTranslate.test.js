'use strict';

process.env.NODE_ENV = 'test';

const { translate } = require('../app/services/biosonic/translate');

// Shared fixtures: a personal baseline and two physiological states.
const BASELINES = { rhrMedian: 60, rhrMAD: 4, hrvMedian: 45, hrvMAD: 8 };

const WRECKED = {
  live: { heartRate: 105, activity: 'walking' },
  baselines: BASELINES,
  sleep: { lastNight: { deep: 45, light: 150, rem: 45 } }, // ~4h
  state: { hrv: 25 }, // heavily suppressed vs baseline 45 → high stress
  hourOfDay: 8,
  moodKey: null,
};

const RESTED = {
  live: { heartRate: 105, activity: 'walking' },
  baselines: BASELINES,
  sleep: { lastNight: { deep: 100, light: 320, rem: 95 } }, // ~8.5h
  state: { hrv: 50, bodyBattery: 85, dailyReadiness: 90 },
  hourOfDay: 8,
  moodKey: null,
};

describe('translate() — the golden scenario (4h sleep + high stress + walking)', () => {
  const out = translate(WRECKED);

  it('cadence-locks walking BPM regardless of recovery', () => {
    expect(out.bpmCenter).toBe(118);
    expect(out.tempoBand).toBe('active');
  });

  it('caps energy physiologically — a wrecked body gets no bangers', () => {
    expect(out.energyCeiling).toBeGreaterThanOrEqual(0.45);
    expect(out.energyCeiling).toBeLessThanOrEqual(0.58);
  });

  it('high stress narrows the BPM window and biases texture', () => {
    expect(out.bpmWidth).toBe(8);
    expect(out.acousticnessBias).toBeCloseTo(0.3, 5);
    expect(out.instrumentalBias).toBeCloseTo(0.2, 5);
  });

  it('raises the valence floor gently under stress', () => {
    expect(out.valenceTarget).toBeCloseTo(0.6, 5);
  });

  it('is fully confident with every input group present', () => {
    expect(out.confidence).toBe(1);
  });
});

describe('translate() — the well-rested control (same walk, different body)', () => {
  const out = translate(RESTED);

  it('lifts the ceiling, widens the window, drops the biases', () => {
    expect(out.energyCeiling).toBeGreaterThanOrEqual(0.8);
    expect(out.bpmWidth).toBe(20);
    expect(out.acousticnessBias).toBe(0);
    expect(out.instrumentalBias).toBe(0);
  });

  it('recovery separates the two states by a wide margin', () => {
    const wrecked = translate(WRECKED);
    expect(out.energyCeiling - wrecked.energyCeiling).toBeGreaterThanOrEqual(0.2);
  });
});

describe('translate() — entrainment & context rules', () => {
  it('resting + calm intent lands in the 60–80 wind-down band', () => {
    const out = translate({
      ...RESTED,
      live: { heartRate: 62, activity: 'resting' },
      moodKey: 'calm',
    });
    expect(out.bpmCenter).toBeGreaterThanOrEqual(60);
    expect(out.bpmCenter).toBeLessThanOrEqual(80);
    expect(out.tempoBand).toBe('resting');
  });

  it('late-night circadian phase compresses energy and warms the texture', () => {
    const day   = translate(RESTED);
    const night = translate({ ...RESTED, hourOfDay: 23 });
    expect(night.energyCeiling).toBeLessThan(day.energyCeiling);
    expect(night.acousticnessBias).toBeGreaterThan(day.acousticnessBias);
  });

  it('exposes the derived state (recovery/stress/exertion) for receipts and the state vector', () => {
    const out = translate(WRECKED);
    expect(out.state.recovery).toBeGreaterThan(0);
    expect(out.state.recovery).toBeLessThan(0.45);
    expect(out.state.stress).toBeGreaterThanOrEqual(0.6);
    expect(out.state.exertion).toBeGreaterThan(0);
  });
});

describe('translate() — activity chips drive the target (the app\'s primary input)', () => {
  it('an explicit workout drives energetic targets even on a wrecked body at 2am (activity wins over the recovery/night gate)', () => {
    const out = translate({
      ...WRECKED,
      hourOfDay: 2,
      live: { activity: 'workout' }, // no HR — an explicit manual chip
      moodKey: 'calm',               // a stale calm tap must NOT keep it calm
    });
    expect(out.energyCeiling).toBeGreaterThanOrEqual(0.85);
    expect(out.energyFloor).toBeGreaterThan(0.4);
    expect(out.tempoBand).toBe('peak');
    expect(out.bpmCenter).toBeGreaterThanOrEqual(136);
  });

  it('running cadence-locks to an energetic tempo despite a stale calm mood tap', () => {
    const out = translate({ live: { activity: 'running' }, moodKey: 'calm', hourOfDay: 2 });
    expect(out.bpmCenter).toBe(162);
    expect(out.tempoBand).toBe('peak');
    expect(out.energyCeiling).toBeGreaterThanOrEqual(0.8);
  });

  it('a low-exertion activity keeps a calm tempo even if a high-energy mood was tapped', () => {
    const out = translate({ live: { activity: 'resting' }, moodKey: 'energize', hourOfDay: 14 });
    expect(out.tempoBand).toBe('resting');
    expect(out.bpmCenter).toBeLessThan(100);
  });

  it('flags an activity-driven request so the scorer can let the biosonic target dominate', () => {
    expect(translate({ live: { activity: 'running' } }).activityDriven).toBe(true);
    expect(translate({ moodKey: 'calm' }).activityDriven).toBe(false);
    expect(translate({}).activityDriven).toBe(false);
  });
});

describe('translate() — degradation & purity', () => {
  it('produces a complete, in-range result from ZERO inputs (cold start)', () => {
    const out = translate({});
    expect(out.bpmCenter).toBeGreaterThanOrEqual(30);
    expect(out.bpmCenter).toBeLessThanOrEqual(260);
    expect(out.energyCeiling).toBeGreaterThanOrEqual(0.2);
    expect(out.energyCeiling).toBeLessThanOrEqual(0.95);
    expect(out.energyFloor).toBeLessThanOrEqual(out.energyCeiling);
    expect(out.confidence).toBeLessThanOrEqual(0.45);
    expect(out.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('confidence steps down as input groups disappear', () => {
    const full = translate(WRECKED);
    const noSleep = translate({ ...WRECKED, sleep: {} });
    const noSleepNoState = translate({ ...WRECKED, sleep: {}, state: {} });
    expect(full.confidence).toBeGreaterThan(noSleep.confidence);
    expect(noSleep.confidence).toBeGreaterThan(noSleepNoState.confidence);
  });

  it('is pure: identical input → identical output, input untouched', () => {
    const input = JSON.parse(JSON.stringify(WRECKED));
    const a = translate(input);
    const b = translate(input);
    expect(a).toEqual(b);
    expect(input).toEqual(JSON.parse(JSON.stringify(WRECKED)));
  });

  it('has no I/O dependencies (loads with no mocks, no redis, no models)', () => {
    jest.isolateModules(() => {
      expect(() => require('../app/services/biosonic/translate')).not.toThrow();
    });
  });
});
