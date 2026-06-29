'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Mock the mongoose models (Node 21 / mongoose 9 incompatibility — same pattern as
// the other backend suites). The adapter + aggregation it uses are real (pure).
jest.mock('../app/models/BiometricLog', () => ({ insertMany: jest.fn().mockResolvedValue([]), find: jest.fn() }));
jest.mock('../app/models/MedicalProfile', () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}) }));

const BiometricLog   = require('../app/models/BiometricLog');
const MedicalProfile = require('../app/models/MedicalProfile');
const { decrypt }    = require('../app/utils/encryption');
const { ingestBatch } = require('../app/services/wearable/healthStore');

const ts = '2026-01-15T03:30:00Z';

// Mock the dedupe lookup `BiometricLog.find(...).select(...).lean()` to return the
// given already-stored rows (default: none).
function mockExisting(rows = []) {
  BiometricLog.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(rows) }) });
}

describe('healthStore.ingestBatch', () => {
  beforeEach(() => { jest.clearAllMocks(); mockExisting([]); });

  it('writes heart-rate samples to BiometricLog tagged with the platform source', async () => {
    await ingestBatch('user-1', 'healthkit', [
      { type: 'heart_rate', value: 72, startDate: ts },
    ]);

    expect(BiometricLog.insertMany).toHaveBeenCalledTimes(1);
    const [docs] = BiometricLog.insertMany.mock.calls[0];
    expect(docs).toEqual([
      expect.objectContaining({ userId: 'user-1', heartRate: 72, source: 'apple_health', recordedAt: new Date(ts) }),
    ]);
  });

  it('tags Android heart-rate samples with the health_connect source', async () => {
    await ingestBatch('user-1', 'health_connect', [
      { type: 'heart_rate', value: 80, startDate: ts },
    ]);
    const [docs] = BiometricLog.insertMany.mock.calls[0];
    expect(docs[0].source).toBe('health_connect');
  });

  it('aggregates profile scalars and upserts them ENCRYPTED into MedicalProfile', async () => {
    await ingestBatch('user-1', 'healthkit', [
      { type: 'resting_heart_rate', value: 50, startDate: ts },
      { type: 'resting_heart_rate', value: 60, startDate: ts },
      { type: 'hrv', value: 46, startDate: ts },
    ]);

    expect(MedicalProfile.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = MedicalProfile.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ userId: 'user-1' });
    expect(opts).toEqual({ upsert: true, new: true });
    // Stored ciphertext, not plaintext (audit F3) — decrypt to verify
    expect(update.$set.restingHeartRate).not.toBe('55');
    expect(decrypt(update.$set.restingHeartRate)).toBe('55'); // median(50,60)
    expect(decrypt(update.$set.hrv)).toBe('46');
  });

  it('writes sleep stage medians to the nested MedicalProfile.sleepStages.* fields, encrypted', async () => {
    await ingestBatch('user-1', 'health_connect', [
      { type: 'sleep_deep', value: 60, startDate: ts },
      { type: 'sleep_rem', value: 30, startDate: ts },
    ]);

    const [, update] = MedicalProfile.findOneAndUpdate.mock.calls[0];
    expect(decrypt(update.$set['sleepStages.deep'])).toBe('60');
    expect(decrypt(update.$set['sleepStages.rem'])).toBe('30');
    // not stored as a flat field
    expect(update.$set.sleepDeep).toBeUndefined();
  });

  it('skips heart-rate samples already stored at the same timestamp (idempotent re-sync)', async () => {
    mockExisting([{ source: 'apple_health', recordedAt: new Date(ts) }]); // ts already stored
    await ingestBatch('user-1', 'healthkit', [
      { type: 'heart_rate', value: 72, startDate: ts },                       // dup → skip
      { type: 'heart_rate', value: 70, startDate: '2026-01-15T03:31:00Z' },   // new → insert
    ]);
    const [docs] = BiometricLog.insertMany.mock.calls[0];
    expect(docs).toHaveLength(1);
    expect(docs[0].recordedAt).toEqual(new Date('2026-01-15T03:31:00Z'));
  });

  it('reports inserted=0 when every heart-rate sample already exists, without calling insertMany', async () => {
    mockExisting([{ source: 'apple_health', recordedAt: new Date(ts) }]);
    const result = await ingestBatch('user-1', 'healthkit', [{ type: 'heart_rate', value: 72, startDate: ts }]);
    expect(BiometricLog.insertMany).not.toHaveBeenCalled();
    expect(result.inserted).toBe(0);
  });

  it('de-duplicates repeated timestamps within a single batch', async () => {
    await ingestBatch('user-1', 'healthkit', [
      { type: 'heart_rate', value: 72, startDate: ts },
      { type: 'heart_rate', value: 99, startDate: ts }, // same instant → one row only
    ]);
    const [docs] = BiometricLog.insertMany.mock.calls[0];
    expect(docs).toHaveLength(1);
  });

  it('does not touch MedicalProfile when the batch has only heart-rate samples', async () => {
    await ingestBatch('user-1', 'healthkit', [{ type: 'heart_rate', value: 70, startDate: ts }]);
    expect(MedicalProfile.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not touch BiometricLog when the batch has no heart-rate samples', async () => {
    await ingestBatch('user-1', 'healthkit', [{ type: 'resting_heart_rate', value: 55, startDate: ts }]);
    expect(BiometricLog.insertMany).not.toHaveBeenCalled();
  });

  it('makes no DB writes and reports zero accepted for an all-unrecognised batch', async () => {
    const result = await ingestBatch('user-1', 'healthkit', [{ type: 'blood_glucose', value: 5, startDate: ts }]);
    expect(BiometricLog.insertMany).not.toHaveBeenCalled();
    expect(MedicalProfile.findOneAndUpdate).not.toHaveBeenCalled();
    expect(result.accepted).toBe(0);
  });

  it('returns the number of accepted samples and the aggregated profile metrics', async () => {
    const result = await ingestBatch('user-1', 'healthkit', [
      { type: 'heart_rate', value: 72, startDate: ts },
      { type: 'resting_heart_rate', value: 55, startDate: ts },
    ]);
    expect(result.accepted).toBe(2);
    expect(result.inserted).toBe(1); // 1 new heart-rate row
    expect(result.profileMetrics).toEqual({ restingHeartRate: 55 });
  });
});
