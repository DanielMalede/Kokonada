'use strict';

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/services/biosonic/baselines', () => ({
  computeBaselines: jest.fn().mockResolvedValue({ rhrMedian: 60, rhrMAD: 4, sampleCount: 40 }),
  cacheBaselines: jest.fn().mockResolvedValue(undefined),
  getBaselines: jest.fn(),
}));
jest.mock('../app/services/medicalProfileService', () => ({
  upsertStateVector: jest.fn().mockResolvedValue({}),
  computeStateVector: jest.fn(),
  aggregateProfileMetrics: jest.fn(),
  computeLastNightSleep: jest.fn(),
}));
jest.mock('../app/models/MedicalProfile', () => ({
  findOne: jest.fn().mockResolvedValue({
    hrv: 45, restingHeartRate: 60, bodyBattery: 80, dailyReadiness: 85,
    toObject: function () { return { hrv: 45, restingHeartRate: 60, bodyBattery: 80, dailyReadiness: 85 }; },
  }),
}));

const baselines = require('../app/services/biosonic/baselines');
const { upsertStateVector } = require('../app/services/medicalProfileService');
const worker = require('../app/workers/stateVector.worker');
const { DEFAULT_PROCESSORS } = require('../app/workers');
const { QUEUES } = require('../app/queues/definitions');

describe('stateVector worker', () => {
  it('recomputes baselines fresh, refreshes the encrypted cache, and upserts the state vector', async () => {
    await worker.process({ data: { userId: 'u1' } });

    expect(baselines.computeBaselines).toHaveBeenCalledWith('u1');
    expect(baselines.cacheBaselines).toHaveBeenCalledWith('u1', expect.objectContaining({ rhrMedian: 60 }));
    expect(upsertStateVector).toHaveBeenCalledWith('u1', expect.any(Object));
  });

  it('returns a summary that carries NO raw biometric values (zero-knowledge boundary)', async () => {
    const out = await worker.process({ data: { userId: 'u1' } });

    const flat = JSON.stringify(out);
    expect(flat).not.toContain('"rhrMedian"');
    expect(flat).not.toContain('60');
    expect(out).toEqual(expect.objectContaining({ userId: 'u1', recomputed: true }));
  });

  it('is registered as the default processor for state-vector-recompute', () => {
    expect(DEFAULT_PROCESSORS[QUEUES.STATE_VECTOR_RECOMPUTE]).toBe(worker.process);
  });

  it('a missing profile degrades gracefully (baselines still cached)', async () => {
    const MedicalProfile = require('../app/models/MedicalProfile');
    MedicalProfile.findOne.mockResolvedValueOnce(null);

    await expect(worker.process({ data: { userId: 'ghost' } })).resolves.toEqual(
      expect.objectContaining({ recomputed: true })
    );
  });
});
