'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const HealthSample = require('../app/models/HealthSample');
const { healthSampleKey } = require('../app/services/wearable/healthSampleIdentity');

jest.setTimeout(120000);

const NOW = new Date('2026-10-07T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const SAMPLE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SAMPLE_ID = '22222222-2222-4222-8222-222222222222';

let mem;
let applyHealthOperations;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_health_sample_repository' });
  await HealthSample.syncIndexes();
  ({ applyHealthOperations } = require('../app/services/wearable/healthSampleRepository'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

beforeEach(async () => { await HealthSample.deleteMany({}); });

const uid = () => new mongoose.Types.ObjectId();

function upsert(overrides = {}) {
  return {
    sampleId: SAMPLE_ID,
    operation: 'upsert',
    type: 'heart_rate',
    value: 72,
    unit: 'bpm',
    startDate: '2026-10-07T11:59:55.000Z',
    endDate: '2026-10-07T12:00:00.000Z',
    tzOffsetMinutes: 180,
    method: null,
    ...overrides,
  };
}

const remove = (sampleId = SAMPLE_ID) => ({ sampleId, operation: 'delete' });

describe('applyHealthOperations upserts', () => {
  it('creates one encrypted authoritative row and returns only its internal pending key', async () => {
    const userId = uid();
    const result = await applyHealthOperations(userId, 'apple_health', [upsert()], { now: NOW });

    expect(result).toEqual({
      accepted: 1,
      created: 1,
      replayed: 0,
      deleted: 0,
      pendingKeys: [healthSampleKey(userId, 'apple_health', SAMPLE_ID)],
    });
    const row = await HealthSample.findOne({ userId });
    expect(row).toMatchObject({
      source: 'apple_health', metric: 'heart_rate', value: 72, unit: 'bpm',
      state: 'active', projectionState: 'pending', tzOffsetMinutes: 180,
    });
    expect(row.expiresAt.toISOString()).toBe('2027-01-05T12:00:00.000Z');
  });

  it('treats an identical retry as a replay even when non-contract batch context differs', async () => {
    const userId = uid();
    await applyHealthOperations(userId, 'apple_health', [{ ...upsert(), batchId: 'first' }], { now: NOW });
    const replay = await applyHealthOperations(
      userId,
      'apple_health',
      [{ ...upsert(), batchId: 'retry-under-another-envelope' }],
      { now: new Date(NOW.getTime() + 1000) },
    );

    expect(replay).toEqual(expect.objectContaining({ accepted: 1, created: 0, replayed: 1, deleted: 0 }));
    expect(await HealthSample.countDocuments({ userId })).toBe(1);
  });

  it('rejects different immutable content without echoing sensitive input or overwriting the winner', async () => {
    const userId = uid();
    await applyHealthOperations(userId, 'apple_health', [upsert()], { now: NOW });

    const changed = upsert({ value: 199, startDate: '2026-10-07T11:59:50.000Z' });
    await expect(applyHealthOperations(userId, 'apple_health', [changed], { now: NOW }))
      .rejects.toMatchObject({ code: 'health_sample_identity_conflict', statusCode: 409 });
    try {
      await applyHealthOperations(userId, 'apple_health', [changed], { now: NOW });
    } catch (error) {
      expect(error.message).toBe('health_sample_identity_conflict');
      expect(error.message).not.toContain(SAMPLE_ID);
      expect(error.message).not.toContain('199');
      expect(error.message).not.toContain(changed.startDate);
    }
    expect((await HealthSample.findOne({ userId })).value).toBe(72);
  });

  it('rejects an upsert whose retention deadline has already passed', async () => {
    const userId = uid();
    const staleEnd = new Date(NOW.getTime() - 90 * DAY_MS).toISOString();
    const stale = upsert({ startDate: staleEnd, endDate: staleEnd });

    await expect(applyHealthOperations(userId, 'apple_health', [stale], { now: NOW }))
      .rejects.toMatchObject({ code: 'health_sample_outside_retention', statusCode: 422 });
    expect(await HealthSample.countDocuments({ userId })).toBe(0);
  });

  it('caps expiry at 90 days from receipt when an accepted sample is slightly future-dated', async () => {
    const userId = uid();
    const future = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();

    await applyHealthOperations(
      userId,
      'apple_health',
      [upsert({ startDate: future, endDate: future })],
      { now: NOW },
    );

    const row = await HealthSample.findOne({ userId });
    expect(row.expiresAt.toISOString()).toBe(new Date(NOW.getTime() + 90 * DAY_MS).toISOString());
  });

  it('uses the unique index as the race guard for concurrent identical upserts', async () => {
    const userId = uid();
    const results = await Promise.all([
      applyHealthOperations(userId, 'apple_health', [upsert()], { now: NOW }),
      applyHealthOperations(userId, 'apple_health', [upsert()], { now: NOW }),
    ]);

    expect(results.map((r) => r.created).sort()).toEqual([0, 1]);
    expect(results.map((r) => r.replayed).sort()).toEqual([0, 1]);
    expect(await HealthSample.countDocuments({ userId })).toBe(1);
  });

  it('finds an identity through a previous key and migrates it to the current blind index', async () => {
    const userId = uid();
    const oldKey = process.env.ENCRYPTION_KEY;
    await applyHealthOperations(userId, 'apple_health', [upsert()], { now: NOW });
    const oldSampleKey = healthSampleKey(userId, 'apple_health', SAMPLE_ID);

    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.ENCRYPTION_KEY_PREVIOUS = oldKey;
    try {
      const currentSampleKey = healthSampleKey(userId, 'apple_health', SAMPLE_ID);
      const replay = await applyHealthOperations(userId, 'apple_health', [upsert()], { now: NOW });

      expect(currentSampleKey).not.toBe(oldSampleKey);
      expect(replay).toEqual(expect.objectContaining({ created: 0, replayed: 1 }));
      expect((await HealthSample.findOne({ userId })).sampleKey).toBe(currentSampleKey);
      expect(await HealthSample.countDocuments({ userId })).toBe(1);
    } finally {
      process.env.ENCRYPTION_KEY = oldKey;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
    }
  });
});

describe('applyHealthOperations tombstones', () => {
  it('turns an active sample into a pending tombstone without clearing its immutable content', async () => {
    const userId = uid();
    await applyHealthOperations(userId, 'apple_health', [upsert()], { now: NOW });
    const deletionAt = new Date(NOW.getTime() + 2000);
    const result = await applyHealthOperations(userId, 'apple_health', [remove()], { now: deletionAt });

    expect(result).toEqual(expect.objectContaining({ accepted: 1, created: 0, replayed: 0, deleted: 1 }));
    const row = await HealthSample.findOne({ userId });
    expect(row).toMatchObject({ state: 'deleted', metric: 'heart_rate', value: 72, projectionState: 'pending' });
    expect(row.deletedAt.toISOString()).toBe(deletionAt.toISOString());
  });

  it('treats a repeated delete as a replay', async () => {
    const userId = uid();
    await applyHealthOperations(userId, 'apple_health', [remove()], { now: NOW });
    const again = await applyHealthOperations(userId, 'apple_health', [remove()], { now: new Date(NOW.getTime() + 5000) });

    expect(again).toEqual(expect.objectContaining({ accepted: 1, created: 0, replayed: 1, deleted: 0 }));
    expect(await HealthSample.countDocuments({ userId })).toBe(1);
  });

  it('creates a minimal 90-day tombstone for an unseen deletion', async () => {
    const userId = uid();
    const result = await applyHealthOperations(userId, 'apple_health', [remove()], { now: NOW });
    const row = await HealthSample.findOne({ userId });

    expect(result).toEqual(expect.objectContaining({ accepted: 1, created: 0, replayed: 0, deleted: 1 }));
    expect(row.state).toBe('deleted');
    expect(row.metric).toBeUndefined();
    expect(row.value).toBeUndefined();
    expect(row.expiresAt.toISOString()).toBe(new Date(NOW.getTime() + 90 * DAY_MS).toISOString());
  });

  it('keeps a delete-before-upsert tombstone authoritative', async () => {
    const userId = uid();
    await applyHealthOperations(userId, 'apple_health', [remove()], { now: NOW });
    const late = await applyHealthOperations(userId, 'apple_health', [upsert()], { now: new Date(NOW.getTime() + 1000) });

    expect(late).toEqual(expect.objectContaining({ created: 0, replayed: 1, deleted: 0 }));
    expect((await HealthSample.findOne({ userId })).state).toBe('deleted');
  });

  it.each([
    [[upsert(), remove()], 'upsert then delete'],
    [[remove(), upsert()], 'delete then upsert'],
  ])('makes delete dominant for one identity: %s', async (operations) => {
    const userId = uid();
    const result = await applyHealthOperations(userId, 'apple_health', operations, { now: NOW });

    expect(result).toEqual(expect.objectContaining({ accepted: 2, created: 0, replayed: 0, deleted: 1 }));
    expect(await HealthSample.countDocuments({ userId })).toBe(1);
    expect((await HealthSample.findOne({ userId })).state).toBe('deleted');
  });

  it('reduces unrelated identities independently', async () => {
    const userId = uid();
    const result = await applyHealthOperations(userId, 'apple_health', [
      upsert(),
      remove(OTHER_SAMPLE_ID),
    ], { now: NOW });

    expect(result).toEqual(expect.objectContaining({ accepted: 2, created: 1, replayed: 0, deleted: 1 }));
    expect(await HealthSample.countDocuments({ userId })).toBe(2);
  });
});
