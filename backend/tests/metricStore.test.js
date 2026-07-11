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
jest.mock('../app/models/BiometricLog', () => ({
  find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  insertMany: jest.fn().mockResolvedValue([]),
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
