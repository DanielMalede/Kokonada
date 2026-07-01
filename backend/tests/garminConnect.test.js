'use strict';

// Unit tests for the unofficial Garmin Connect pull service. The `garmin-connect`
// wrapper is mocked so nothing here touches the network; fetchAllBiometrics is
// driven with a stub client, and toCanonicalMetrics is pure.

const mockExportToken = jest.fn(() => ({ oauth1: { oauth_token: 't' }, oauth2: { access_token: 'a' } }));
const mockLogin = jest.fn().mockResolvedValue(undefined);
const mockLoadToken = jest.fn();
jest.mock('garmin-connect', () => ({
  GarminConnect: jest.fn().mockImplementation(function (creds) {
    this.creds = creds;
    this.login = mockLogin;
    this.exportToken = mockExportToken;
    this.loadToken = mockLoadToken;
  }),
}));

const { GarminConnect } = require('garmin-connect');
const svc = require('../app/services/wearable/garminConnect');

beforeEach(() => jest.clearAllMocks());

// A fake authenticated client returning representative Garmin payload shapes.
function fakeClient(overrides = {}) {
  return {
    getUserProfile: jest.fn().mockResolvedValue({ displayName: 'abc-display', profileId: 12345 }),
    getHeartRate: jest.fn().mockResolvedValue({
      restingHeartRate: 52, minHeartRate: 48, maxHeartRate: 150,
      lastSevenDaysAvgRestingHeartRate: 54,
      heartRateValues: [[1000, 60], [2000, null], [3000, 72]], // last non-null = 72
    }),
    getSleepData: jest.fn().mockResolvedValue({
      dailySleepDTO: {
        sleepTimeSeconds: 27000, deepSleepSeconds: 6000, lightSleepSeconds: 18000,
        remSleepSeconds: 3000, awakeSleepSeconds: 600, avgSleepStress: 18,
        averageRespirationValue: 14, lowestRespirationValue: 11, highestRespirationValue: 18,
        sleepScores: { overall: { value: 82, qualifierKey: 'GOOD' } },
      },
      avgOvernightHrv: 65, hrvStatus: 'BALANCED',
    }),
    getSteps: jest.fn().mockResolvedValue(8500),
    getActivities: jest.fn().mockResolvedValue([
      { activityId: 1, activityName: 'Run', activityType: { typeKey: 'running' }, duration: 1800, averageHR: 140, maxHR: 165, activityTrainingLoad: 120, startTimeLocal: '2026-07-01 07:00:00' },
    ]),
    get: jest.fn().mockImplementation((url) => {
      if (url.includes('/usersummary-service/usersummary/daily/')) return Promise.resolve({
        totalSteps: 8500, dailyStepGoal: 10000,
        averageStressLevel: 30, maxStressLevel: 80,
        averageSpo2: 96, lowestSpo2: 92,
        bodyBatteryMostRecentValue: 70, bodyBatteryHighestValue: 90, bodyBatteryLowestValue: 20,
        bodyBatteryChargedValue: 50, bodyBatteryDrainedValue: 30,
        moderateIntensityMinutes: 25, vigorousIntensityMinutes: 10,
      });
      if (url.includes('/hrv-service/hrv/')) return Promise.resolve({ hrvSummary: { lastNightAvg: 68, weeklyAvg: 64, status: 'BALANCED', baseline: { balancedLow: 50 } } });
      if (url.includes('/metrics-service/metrics/trainingreadiness/')) return Promise.resolve([{ score: 75, level: 'HIGH', feedbackShort: 'READY' }]);
      return Promise.resolve(null);
    }),
    ...overrides,
  };
}

describe('isEnabled', () => {
  const prev = process.env.GARMIN_CONNECT_PULL;
  afterAll(() => { process.env.GARMIN_CONNECT_PULL = prev; });

  it('is off by default', () => {
    delete process.env.GARMIN_CONNECT_PULL;
    expect(svc.isEnabled()).toBe(false);
  });

  it('is on only for "1" or "true"', () => {
    process.env.GARMIN_CONNECT_PULL = '1';    expect(svc.isEnabled()).toBe(true);
    process.env.GARMIN_CONNECT_PULL = 'true';  expect(svc.isEnabled()).toBe(true);
    process.env.GARMIN_CONNECT_PULL = 'maybe'; expect(svc.isEnabled()).toBe(false);
  });
});

describe('login / restoreSession', () => {
  it('logs in and returns the wrapper session tokens (not the password)', async () => {
    const { client, sessionTokens } = await svc.login({ email: 'e@x.com', password: 'pw' });
    expect(mockLogin).toHaveBeenCalledWith('e@x.com', 'pw');
    expect(sessionTokens).toEqual({ oauth1: { oauth_token: 't' }, oauth2: { access_token: 'a' } });
    expect(client).toBeDefined();
    // The password is not retained anywhere on the returned bundle.
    expect(JSON.stringify(sessionTokens)).not.toContain('pw');
  });

  it('restoreSession loads stored oauth tokens into a fresh client', () => {
    svc.restoreSession({ oauth1: { a: 1 }, oauth2: { b: 2 } });
    expect(mockLoadToken).toHaveBeenCalledWith({ a: 1 }, { b: 2 });
  });
});

describe('fetchAllBiometrics', () => {
  it('assembles a comprehensive snapshot from typed + raw endpoints', async () => {
    const snap = await svc.fetchAllBiometrics(fakeClient(), { date: '2026-07-01' });

    expect(snap.warnings).toEqual([]);
    expect(snap.garminUserId).toBe('12345');
    expect(snap.heartRate).toMatchObject({ current: 72, resting: 52, min: 48, max: 150 });
    expect(snap.hrv).toMatchObject({ lastNightAvg: 68, status: 'BALANCED' });
    expect(snap.sleep).toMatchObject({ score: 82, deepSeconds: 6000, lightSeconds: 18000, remSeconds: 3000 });
    expect(snap.respiration).toMatchObject({ avg: 14 });
    expect(snap.bodyBattery).toMatchObject({ mostRecent: 70 });
    expect(snap.stress).toMatchObject({ avg: 30, max: 80 });
    expect(snap.spo2).toMatchObject({ avg: 96, lowest: 92 });
    expect(snap.trainingReadiness).toMatchObject({ score: 75, level: 'HIGH' });
    expect(snap.steps).toMatchObject({ total: 8500 });
    expect(snap.recentActivities).toHaveLength(1);
  });

  it('tolerates a failing sub-fetch — records a warning, keeps the rest', async () => {
    const client = fakeClient({ getSleepData: jest.fn().mockRejectedValue(new Error('boom')) });
    const snap = await svc.fetchAllBiometrics(client, { date: '2026-07-01' });

    expect(snap.sleep).toBeNull();
    expect(snap.warnings.some((w) => w.startsWith('sleep:'))).toBe(true);
    // Unaffected sections still resolve.
    expect(snap.heartRate.resting).toBe(52);
    expect(snap.trainingReadiness.score).toBe(75);
  });
});

describe('toCanonicalMetrics', () => {
  it('maps a snapshot to canonical metric records with correct units', async () => {
    const snap = await svc.fetchAllBiometrics(fakeClient(), { date: '2026-07-01' });
    const metrics = svc.toCanonicalMetrics(snap);

    const by = Object.fromEntries(metrics.map((m) => [m.metric, m]));
    expect(by.restingHeartRate).toMatchObject({ value: 52, unit: 'bpm' });
    expect(by.hrv).toMatchObject({ value: 68, unit: 'ms' });
    expect(by.respirationRate).toMatchObject({ value: 14, unit: 'brpm' });
    expect(by.spO2).toMatchObject({ value: 96, unit: '%' });
    expect(by.sleepDeep).toMatchObject({ value: 100, unit: 'min' });   // 6000s / 60
    expect(by.sleepLight).toMatchObject({ value: 300, unit: 'min' });  // 18000s / 60
    expect(by.sleepRem).toMatchObject({ value: 50, unit: 'min' });     // 3000s / 60
    expect(by.bodyBattery).toMatchObject({ value: 70, unit: 'score' });
    expect(by.dailyReadiness).toMatchObject({ value: 75, unit: 'score' });
    expect(by.heartRate).toMatchObject({ value: 72, unit: 'bpm' });

    // Every record carries a Date recordedAt + the garmin source, ready for persistMetrics.
    for (const m of metrics) {
      expect(m.source).toBe('garmin');
      expect(m.recordedAt).toBeInstanceOf(Date);
    }
  });

  it('skips metrics that are missing/non-finite instead of emitting nulls', () => {
    const metrics = svc.toCanonicalMetrics({
      fetchedAt: new Date().toISOString(),
      heartRate: { resting: null, current: 80 },
      hrv: { lastNightAvg: undefined },
      sleep: { deepSeconds: null, lightSeconds: 12000, remSeconds: null },
    });
    const names = metrics.map((m) => m.metric).sort();
    expect(names).toEqual(['heartRate', 'sleepLight']);
  });
});
