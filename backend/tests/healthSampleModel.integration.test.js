'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const HealthSample = require('../app/models/HealthSample');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_health_samples' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => { await HealthSample.deleteMany({}); });

const uid = () => new mongoose.Types.ObjectId();
const raw = () => mongoose.connection.db.collection('healthsamples');
const future = () => new Date('2026-12-31T00:00:00.000Z');

function active(overrides = {}) {
  return {
    userId: uid(),
    sampleKey: '1'.repeat(64),
    source: 'apple_health',
    metric: 'heart_rate',
    value: 72.5,
    unit: 'bpm',
    startAt: new Date('2026-10-06T08:00:00.000Z'),
    endAt: new Date('2026-10-06T08:00:05.000Z'),
    state: 'active',
    projectionState: 'pending',
    expiresAt: future(),
    ...overrides,
  };
}

describe('HealthSample encryption and ownership', () => {
  it('stores ciphertext at rest and decrypts the physiological value for its owner', async () => {
    const input = active();
    await HealthSample.create(input);

    const stored = await raw().findOne({ userId: input.userId });
    expect(typeof stored.value).toBe('string');
    expect(stored.value).not.toContain('72.5');
    expect(Number(stored.value)).toBeNaN();

    const roundTrip = await HealthSample.findOne({ userId: input.userId });
    expect(Number(roundTrip.value)).toBe(72.5);
  });

  it('binds ciphertext to userId so moving it to another owner never reveals the value', async () => {
    const input = active();
    await HealthSample.create(input);
    const stored = await raw().findOne({ userId: input.userId });
    const attacker = uid();
    await raw().insertOne({ ...stored, _id: new mongoose.Types.ObjectId(), userId: attacker, sampleKey: '2'.repeat(64) });

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const lifted = await HealthSample.findOne({ userId: attacker });
    expect(lifted.value).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[crypto-alarm]'));
    spy.mockRestore();
  });
});

describe('HealthSample state and HRV method rules', () => {
  it('requires an explicit method for active HRV samples', async () => {
    await expect(HealthSample.create(active({ metric: 'hrv', unit: 'ms', method: null })))
      .rejects.toThrow(/method/i);
    await expect(HealthSample.create(active({ metric: 'hrv', unit: 'ms', method: 'sdnn' })))
      .resolves.toBeDefined();
  });

  it('rejects an HRV method on a non-HRV sample', async () => {
    await expect(HealthSample.create(active({ method: 'sdnn' }))).rejects.toThrow(/method/i);
  });

  it('accepts an unseen-deletion tombstone without metric, value, unit or dates', async () => {
    const userId = uid();
    const doc = await HealthSample.create({
      userId,
      sampleKey: '3'.repeat(64),
      source: 'apple_health',
      state: 'deleted',
      projectionState: 'pending',
      deletedAt: new Date('2026-10-06T09:00:00.000Z'),
      expiresAt: future(),
    });

    expect(doc.metric).toBeUndefined();
    expect(doc.value).toBeUndefined();
    expect(doc.unit).toBeUndefined();
    expect(doc.startAt).toBeUndefined();
    expect(doc.endAt).toBeUndefined();
  });

  it('requires the absolute retention deadline on every row', async () => {
    await expect(HealthSample.create(active({ expiresAt: undefined }))).rejects.toThrow(/expiresAt/i);
  });
});

describe('HealthSample schema contract', () => {
  it('stores the current schema version on every row', async () => {
    const doc = await HealthSample.create(active());
    expect(doc.v).toBe(2);
    expect(doc.v).toBe(HealthSample.HEALTH_SAMPLE_VERSION);
  });

  it('declares unique identity, pending scan and absolute TTL indexes', () => {
    const indexes = HealthSample.schema.indexes();
    const unique = indexes.find(([keys, options]) => options.unique
      && JSON.stringify(keys) === JSON.stringify({ userId: 1, source: 1, sampleKey: 1 }));
    const pending = indexes.find(([keys]) =>
      JSON.stringify(keys) === JSON.stringify({ projectionState: 1, updatedAt: 1 }));
    const ttl = indexes.find(([keys, options]) => options.expireAfterSeconds === 0
      && JSON.stringify(keys) === JSON.stringify({ expiresAt: 1 }));

    expect(unique).toBeDefined();
    expect(pending).toBeDefined();
    expect(ttl).toBeDefined();
  });
});
