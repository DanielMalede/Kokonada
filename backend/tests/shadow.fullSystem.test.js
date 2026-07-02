'use strict';

// Shadow audit — Phase 4, FULL-SYSTEM. Attacks the new biosonic layer AND its
// boundaries with Phase 0 (queue seam), Phase 1 (identity), Phase 2 (feature
// store) and Phase 3 (ledger). Nothing is safe.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/models/BiometricLog', () => ({
  find: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve([]) }), sort: () => ({ limit: () => Promise.resolve([]) }) })),
  insertMany: jest.fn().mockResolvedValue([]),
}));
jest.mock('../app/models/MedicalProfile', () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
  findOne: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve(null) }) })),
}));
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/queues/queue', () => ({
  enqueue: jest.fn().mockResolvedValue({ queued: true }),
}));

const { enqueue } = require('../app/queues/queue');
const { getRedis } = require('../app/config/redis');
const BiometricLog = require('../app/models/BiometricLog');
const { encrypt } = require('../app/utils/encryption');
const { translate } = require('../app/services/biosonic/translate');
const baselines = require('../app/services/biosonic/baselines');
const { persistMetrics } = require('../app/services/wearable/metricStore');

const sleepMetric = (metric, value) => ({ metric, value, unit: 'min', recordedAt: new Date('2026-07-01T06:00:00Z'), source: 'health_connect' });

beforeEach(() => {
  jest.clearAllMocks();
  getRedis.mockReturnValue(null);
});

describe('ATTACK 1 — full-system regression boundaries', () => {
  it('recompute jobs are debounced per user — a backfill burst cannot flood the queue with heavy decrypt jobs', async () => {
    for (let chunk = 0; chunk < 5; chunk++) {
      await persistMetrics('u1', [sleepMetric('sleepDeep', 60)]);
    }

    for (const call of enqueue.mock.calls) {
      const [queueName, payload, opts] = call;
      expect(queueName).toBe('state-vector-recompute');
      expect(payload).toEqual({ userId: 'u1' });
      // Deterministic jobId + delay = BullMQ coalesces the burst into ONE run;
      // removeOnComplete frees the id so the NEXT batch can re-queue.
      expect(opts).toEqual(expect.objectContaining({
        jobId: 'state-vector:u1',
        delay: expect.any(Number),
        removeOnComplete: true,
        removeOnFail: true,
      }));
    }
  });

  it('the stateVector worker imports touch no other phase (identity/features/ledger stay isolated)', () => {
    jest.isolateModules(() => {
      const before = Object.keys(require.cache).length;
      require('../app/workers/stateVector.worker');
      const loaded = Object.keys(require.cache).slice(before);
      const forbidden = loaded.filter(p => /AudioFeature|ServeEvent|trackIdentity|serveLedger|featureService/.test(p));
      expect(forbidden).toEqual([]);
    });
  });
});

describe('ATTACK 2 — baseline math chaos', () => {
  it('one hour of sleep skews the ceiling DOWN but never breaks the floor or the ranges', () => {
    const out = translate({
      sleep: { lastNight: { deep: 10, light: 50, rem: 0 } },
      live: { heartRate: 70, activity: 'resting' },
    });

    expect(out.energyCeiling).toBeGreaterThanOrEqual(0.2);
    expect(out.energyCeiling).toBeLessThanOrEqual(0.5); // violently down, not violently wrong
    expect(out.energyFloor).toBeLessThanOrEqual(out.energyCeiling);
  });

  it('FUZZ: 300 rounds of hostile garbage never produce a crash, NaN, or out-of-range target', () => {
    const junk = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 9999, 'fast', '', {}, [], { deep: 'x' }, () => {}, true];
    const pick = (i, salt) => junk[(i * 7 + salt) % junk.length];

    for (let i = 0; i < 300; i++) {
      const out = translate({
        live: { heartRate: pick(i, 1), activity: pick(i, 2) },
        baselines: { rhrMedian: pick(i, 3), rhrMAD: pick(i, 4), hrvMedian: pick(i, 5), hrvMAD: pick(i, 6) },
        sleep: { lastNight: pick(i, 7), baseline: pick(i, 8) },
        state: { hrv: pick(i, 9), bodyBattery: pick(i, 10), dailyReadiness: pick(i, 11) },
        hourOfDay: pick(i, 12),
        moodKey: pick(i, 13),
      });

      expect(Number.isFinite(out.bpmCenter)).toBe(true);
      expect(out.bpmCenter).toBeGreaterThanOrEqual(30);
      expect(out.bpmCenter).toBeLessThanOrEqual(260);
      expect(out.energyCeiling).toBeGreaterThanOrEqual(0.2);
      expect(out.energyCeiling).toBeLessThanOrEqual(0.95);
      expect(out.energyFloor).toBeLessThanOrEqual(out.energyCeiling);
      expect(out.valenceTarget).toBeGreaterThanOrEqual(0);
      expect(out.valenceTarget).toBeLessThanOrEqual(1);
      expect(out.confidence).toBeGreaterThanOrEqual(0.3);
      expect(['resting', 'active', 'peak']).toContain(out.tempoBand);
    }
  });

  it('an all-workout history (no resting samples) yields null baselines, never a fabricated resting HR', async () => {
    BiometricLog.find.mockImplementationOnce(() => ({
      sort: () => ({ limit: () => Promise.resolve(Array.from({ length: 30 }, (_, i) => ({ _id: i, heartRate: 150, activity: 'running' }))) }),
    }));

    const stats = await baselines.computeBaselines('u1');

    expect(stats.rhrMedian).toBeNull();
    expect(stats.sampleCount).toBe(0);
  });
});

describe('ATTACK 3 — zero-knowledge leak hunting', () => {
  it('a cross-user cache replay (user A blob under user B key) is rejected by the AAD binding', async () => {
    const stolenBlob = encrypt(JSON.stringify({ rhrMedian: 44, rhrMAD: 2, sampleCount: 99 }), 'userA');
    getRedis.mockReturnValue({
      get: jest.fn().mockResolvedValue(stolenBlob), // poisoned under userB's key
      set: jest.fn().mockResolvedValue('OK'),
    });
    BiometricLog.find.mockImplementationOnce(() => ({
      sort: () => ({ limit: () => Promise.resolve(Array.from({ length: 12 }, (_, i) => ({ _id: i, heartRate: 70, activity: 'resting' }))) }),
    }));

    const stats = await baselines.getBaselines('userB');

    expect(stats.rhrMedian).toBe(70);      // fresh compute from userB's own data
    expect(stats.rhrMedian).not.toBe(44);  // userA's stats never cross the boundary
  });

  it('translate() output carries only derived targets — no raw vital echoes in its shape', () => {
    const out = translate({ live: { heartRate: 105, activity: 'walking' }, state: { hrv: 25 } });

    expect(Object.keys(out).sort()).toEqual([
      'acousticnessBias', 'bpmCenter', 'bpmWidth', 'confidence', 'energyCeiling',
      'energyFloor', 'instrumentalBias', 'state', 'tempoBand', 'valenceTarget', 'version',
    ]);
    expect(Object.keys(out.state).sort()).toEqual(['exertion', 'recovery', 'stress']);
  });

  it('every biometric value written by ingestion is ciphertext or a date — no plaintext vitals in the DB write', async () => {
    const MedicalProfile = require('../app/models/MedicalProfile');
    await persistMetrics('u1', [
      sleepMetric('sleepDeep', 60), sleepMetric('sleepLight', 200),
      { metric: 'restingHeartRate', value: 58, unit: 'bpm', recordedAt: new Date('2026-07-01T06:00:00Z'), source: 'health_connect' },
    ]);

    const $set = MedicalProfile.findOneAndUpdate.mock.calls[0][1].$set;
    for (const [field, value] of Object.entries($set)) {
      const isDate = value instanceof Date;
      const isCiphertext = typeof value === 'string' && Buffer.from(value, 'base64').length >= 28; // iv+tag minimum
      expect(isDate || isCiphertext).toBe(true);
      if (isCiphertext) {
        expect(value).not.toContain('60');
        expect(value).not.toMatch(/^\d+$/);
      }
      expect(String(field)).not.toMatch(/heartRate.*plain|raw/i);
    }
  });
});
