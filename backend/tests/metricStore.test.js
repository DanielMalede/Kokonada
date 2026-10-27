'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

// Regression for the double-encryption bug (Pulse showed "—" despite a good sync):
// Mongoose 9 runs the encryptedNumber setter on findOneAndUpdate($set), so persistMetrics
// must pass RAW numbers — pre-encrypting double-encrypted, and the getter then read back NaN.

const mockFindOneAndUpdate = jest.fn().mockResolvedValue({});
jest.mock('../app/models/MedicalProfile', () => ({
  findOneAndUpdate: (...a) => mockFindOneAndUpdate(...a),
  findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }), // no prior night
}));
// The indexes each store declares, in the shape a real schema reports them ([fields, options]
// pairs): a compound index on recordedAt that is NOT the TTL, then the TTL itself. The two windows
// differ (10 and 30 days) so a test can tell "read from the model" from "assumed to be 90".
const DAY_S = 24 * 60 * 60;
const mockBiometricIndexes = jest.fn(() => [
  [{ userId: 1, recordedAt: -1 }, {}],
  [{ recordedAt: 1 }, { expireAfterSeconds: 10 * DAY_S }],
]);
const mockVitalIndexes = jest.fn(() => [
  [{ userId: 1, metric: 1, recordedAt: -1 }, {}],
  [{ recordedAt: 1 }, { expireAfterSeconds: 30 * DAY_S }],
]);
jest.mock('../app/models/BiometricLog', () => ({
  find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  // W4-D08: the real return is an accounting object, not an array of docs.
  insertMany: jest.fn(async (docs) => ({
      acknowledged: true,
      insertedCount: docs.length,
      insertedIds: {},
      mongoose: { validationErrors: [], results: docs },
    })),
  schema: { indexes: (...a) => mockBiometricIndexes(...a) },
}));
// W4-004 added a VitalSample write to this path. Without a mock the real model runs against no
// connection, the best-effort catch swallows the CastError, and this suite goes green while
// exercising the FAILURE path — the false-green class this run keeps finding. Mocked so the
// write really happens here; no assertion below changes meaning.
const mockVitalInsertMany = jest.fn(async (docs) => ({
  acknowledged: true, insertedCount: docs.length, insertedIds: {},
  mongoose: { validationErrors: [], results: docs },
}));
jest.mock('../app/models/VitalSample', () => ({
  find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  insertMany: (...a) => mockVitalInsertMany(...a),
  schema: { indexes: (...a) => mockVitalIndexes(...a) },
  // the REAL vocabulary: which metrics VitalSample stores is the model's to say, not this file's
  VITAL_METRICS: jest.requireActual('../app/models/VitalSample').VITAL_METRICS,
}));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn().mockResolvedValue(undefined) }));

const { persistMetrics } = require('../app/services/wearable/metricStore');

describe('persistMetrics — RAW values into $set (Mongoose 9 setter encrypts once)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes plain numbers for restingHeartRate + sleep, never pre-encrypted ciphertext', async () => {
    const at = new Date('2026-07-10T08:00:00Z');
    await persistMetrics('u1', [
      { metric: 'restingHeartRate', value: 51, recordedAt: at },
      { metric: 'sleepDeep',        value: 90, recordedAt: at },
      { metric: 'sleepRem',         value: 44, recordedAt: at },
    ]);

    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = mockFindOneAndUpdate.mock.calls[0];

    // The whole point: raw numbers, so the encryptedNumber setter encrypts exactly once.
    expect(update.$set.restingHeartRate).toBe(51);

    // …and the SAME reading is now also kept as an individual VitalSample row, which is what
    // gives the baseline engine a spread instead of a lone median (D1). The aggregated scalar
    // above is deliberately KEPT — this is additive, not a replacement.
    expect(mockVitalInsertMany).toHaveBeenCalledTimes(1);
    expect(mockVitalInsertMany.mock.calls[0][0]).toEqual([
      expect.objectContaining({ userId: 'u1', metric: 'restingHeartRate', value: 51 }),
    ]);
    expect(typeof update.$set.restingHeartRate).toBe('number');
    expect(update.$set['sleepStages.deep']).toBe(90);            // median baseline
    expect(update.$set['lastNightSleep.deep']).toBe(90);         // last-night total
    expect(update.$set['lastNightSleep.rem']).toBe(44);
    // guard against a regression back to pre-encryption
    for (const v of [update.$set.restingHeartRate, update.$set['lastNightSleep.deep']]) {
      expect(typeof v).not.toBe('string');
    }
  });
});

// T2: dropping what a store's TTL would reap is opt-in. The Garmin lane asks for it (its real-Mongo
// pin is garminRetentionFilter.integration.test.js); every other caller writes exactly as before.
describe('persistMetrics — retention is opt-in; the default path is unchanged', () => {
  beforeEach(() => jest.clearAllMocks());

  it('without the option, a reading far older than any window is written, nothing is reported dropped, and no TTL is read', async () => {
    const res = await persistMetrics('u1', [
      { metric: 'restingHeartRate', value: 51, recordedAt: new Date('2025-01-01T08:00:00Z'), source: 'health_connect' },
    ]);
    expect(res.droppedOutsideRetention).toBe(0);
    expect(mockVitalInsertMany).toHaveBeenCalledTimes(1);
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockBiometricIndexes).not.toHaveBeenCalled();
    expect(mockVitalIndexes).not.toHaveBeenCalled();
  });
});

describe('persistMetrics({ dropOutsideRetention: true }) — each store\'s own TTL draws the line', () => {
  const BiometricLog = require('../app/models/BiometricLog');
  const DAY_MS = DAY_S * 1000;
  const ago = (days) => new Date(Date.now() - days * DAY_MS);

  beforeEach(() => jest.clearAllMocks());

  it('heart rate by BiometricLog\'s window, vitals by VitalSample\'s, a profile-only metric by the shorter of the two', async () => {
    const res = await persistMetrics('u1', [
      { metric: 'heartRate', value: 61, recordedAt: ago(15), source: 'garmin' },        // past 10 days: dropped
      { metric: 'heartRate', value: 62, recordedAt: ago(5), source: 'garmin' },
      { metric: 'restingHeartRate', value: 51, recordedAt: ago(15), source: 'garmin' }, // inside 30 days: kept
      { metric: 'restingHeartRate', value: 53, recordedAt: ago(45), source: 'garmin' }, // past 30 days: dropped
      { metric: 'sleepDeep', value: 90, recordedAt: ago(15), source: 'garmin' },        // past the shorter 10: dropped
      { metric: 'sleepDeep', value: 70, recordedAt: ago(5), source: 'garmin' },
    ], { dropOutsideRetention: true });

    expect(res.droppedOutsideRetention).toBe(3);
    expect(BiometricLog.insertMany.mock.calls[0][0].map((d) => d.heartRate)).toEqual([62]);
    expect(mockVitalInsertMany.mock.calls[0][0].map((d) => d.value)).toEqual([51]);
    const { $set } = mockFindOneAndUpdate.mock.calls[0][1];
    expect($set.restingHeartRate).toBe(51);       // the dropped 53 is in no median
    expect($set['sleepStages.deep']).toBe(70);    // nor the dropped 90
  });

  it('a store that declares no TTL keeps everything: the filter never invents a window', async () => {
    mockBiometricIndexes.mockReturnValueOnce([[{ userId: 1, recordedAt: -1 }, {}]]);
    mockVitalIndexes.mockReturnValueOnce([]);
    const res = await persistMetrics('u1', [
      { metric: 'heartRate', value: 61, recordedAt: ago(400), source: 'garmin' },
      { metric: 'restingHeartRate', value: 51, recordedAt: ago(400), source: 'garmin' },
      { metric: 'sleepDeep', value: 90, recordedAt: ago(400), source: 'garmin' },
    ], { dropOutsideRetention: true });

    expect(res.droppedOutsideRetention).toBe(0);
    expect(BiometricLog.insertMany).toHaveBeenCalledTimes(1);
    expect(mockVitalInsertMany).toHaveBeenCalledTimes(1);
  });
});
