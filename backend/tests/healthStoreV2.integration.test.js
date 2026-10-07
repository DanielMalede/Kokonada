'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

jest.mock('../app/services/wearable/healthSampleReconciliation', () => ({
  reconcileHealthSamples: jest.fn(),
}));

const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('fs');
const mongoose = require('mongoose');
const path = require('path');
const ConsentRecord = require('../app/models/ConsentRecord');
const HealthSample = require('../app/models/HealthSample');
const User = require('../app/models/User');
const {
  CURRENT_CONSENT_VERSION,
  HEALTH_CONSENT_PURPOSE,
} = require('../app/services/privacy/consentState');
const { reconcileHealthSamples } = require('../app/services/wearable/healthSampleReconciliation');
const { ingestV2Batch, recoverStagedHealthSamples } = require('../app/services/wearable/healthStoreV2');

const sampleId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const upsert = (overrides = {}) => ({
  sampleId,
  operation: 'upsert',
  type: 'heart_rate',
  value: 72,
  unit: 'bpm',
  startDate: '2026-10-06T06:30:00.000Z',
  endDate: '2026-10-06T06:31:00.000Z',
  ...overrides,
});

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_health_store_v2' });
  await HealthSample.syncIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  jest.clearAllMocks();
  reconcileHealthSamples.mockResolvedValue({ projected: 0, removed: 0, profileUpdated: false });
  await Promise.all([HealthSample.deleteMany({}), ConsentRecord.deleteMany({}), User.deleteMany({})]);
});

async function connectedUser() {
  const user = await User.create({
    ssoProvider: 'google',
    ssoId: new mongoose.Types.ObjectId().toString(),
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    wearableProvider: 'apple_health',
    wearableConnectionVersion: 0,
  });
  await ConsentRecord.create({
    userId: user._id,
    purpose: HEALTH_CONSENT_PURPOSE,
    consentVersion: CURRENT_CONSENT_VERSION,
    status: 'granted',
    grantedAt: new Date(),
  });
  return user;
}

describe('ingestV2Batch', () => {
  it('leaves the legacy Health Connect store independent of HealthSample', () => {
    const legacySource = fs.readFileSync(
      path.join(__dirname, '../app/services/wearable/healthStore.js'),
      'utf8',
    );
    expect(legacySource).not.toMatch(/HealthSample|healthSampleRepository|healthStoreV2/);
  });

  it('maps HealthKit to apple_health and lets delete dominate duplicate operations', async () => {
    const { _id: userId } = await connectedUser();
    const samples = [upsert(), { sampleId, operation: 'delete' }];

    await expect(ingestV2Batch(userId, 'healthkit', samples)).resolves.toEqual({
      accepted: 2,
      created: 0,
      replayed: 0,
      deleted: 1,
      projected: 0,
    });

    const row = await HealthSample.findOne({ userId });
    expect(row).toMatchObject({ source: 'apple_health', state: 'deleted', projectionState: 'pending' });
    expect(reconcileHealthSamples).toHaveBeenCalledWith(
      userId,
      'apple_health',
      { connectionVersion: 0 },
    );
  });

  it('returns operational projection counts without identities or values', async () => {
    const { _id: userId } = await connectedUser();
    reconcileHealthSamples.mockResolvedValue({ projected: 1, removed: 0, profileUpdated: false });

    const result = await ingestV2Batch(userId, 'healthkit', [upsert()]);

    expect(result).toEqual({ accepted: 1, created: 1, replayed: 0, deleted: 0, projected: 1 });
    expect(JSON.stringify(result)).not.toMatch(/6ba7b810|72|2026-10-06/);
  });

  it('preserves fixed 409 identity conflicts without exposing submitted data', async () => {
    const { _id: userId } = await connectedUser();
    await ingestV2Batch(userId, 'healthkit', [upsert()]);

    await expect(ingestV2Batch(userId, 'healthkit', [upsert({ value: 173 })]))
      .rejects.toMatchObject({ code: 'health_sample_identity_conflict', statusCode: 409 });
  });

  it('preserves the retryable 503 when synchronous projection remains pending', async () => {
    const { _id: userId } = await connectedUser();
    reconcileHealthSamples.mockRejectedValue(Object.assign(new Error('health_projection_pending'), {
      code: 'health_projection_pending',
      statusCode: 503,
    }));

    await expect(ingestV2Batch(userId, 'healthkit', [upsert()]))
      .rejects.toMatchObject({ code: 'health_projection_pending', statusCode: 503 });
    expect(await HealthSample.countDocuments({ userId, projectionState: 'pending' })).toBe(1);
  });

  it('rejects a batch from an older wearable connection before storing any sample', async () => {
    const owner = await connectedUser();
    await User.updateOne(
      { _id: owner._id },
      { $set: { wearableConnectionVersion: 2 } },
    );

    await expect(ingestV2Batch(
      owner._id,
      'healthkit',
      [upsert()],
      { connectionVersion: 1 },
    )).rejects.toMatchObject({ code: 'wearable_connection_changed', statusCode: 409 });

    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(reconcileHealthSamples).not.toHaveBeenCalled();
  });

  it('rolls back a sample whose write finishes after the wearable was disconnected', async () => {
    const owner = await connectedUser();
    const create = HealthSample.create.bind(HealthSample);
    let releaseCreate;
    let createStarted;
    const started = new Promise((resolve) => { createStarted = resolve; });
    const held = new Promise((resolve) => { releaseCreate = resolve; });
    const createSpy = jest.spyOn(HealthSample, 'create').mockImplementation(async (...args) => {
      createStarted();
      await held;
      return create(...args);
    });

    const ingest = ingestV2Batch(owner._id, 'healthkit', [upsert()]);
    await started;
    await User.updateOne(
      { _id: owner._id },
      { $set: { wearableProvider: null }, $inc: { wearableConnectionVersion: 1 } },
    );
    releaseCreate();

    await expect(ingest).rejects.toMatchObject({
      code: 'wearable_connection_changed',
      statusCode: 409,
    });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(reconcileHealthSamples).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('rolls back a held write when consent is withdrawn after admission', async () => {
    const owner = await connectedUser();
    const create = HealthSample.create.bind(HealthSample);
    let releaseCreate;
    let createStarted;
    const started = new Promise((resolve) => { createStarted = resolve; });
    const held = new Promise((resolve) => { releaseCreate = resolve; });
    const createSpy = jest.spyOn(HealthSample, 'create').mockImplementation(async (...args) => {
      createStarted();
      await held;
      return create(...args);
    });

    const ingest = ingestV2Batch(owner._id, 'healthkit', [upsert()]);
    await started;
    await ConsentRecord.create({
      userId: owner._id,
      purpose: HEALTH_CONSENT_PURPOSE,
      consentVersion: CURRENT_CONSENT_VERSION,
      status: 'withdrawn',
      withdrawnAt: new Date(),
    });
    releaseCreate();

    await expect(ingest).rejects.toMatchObject({ code: 'health_consent_changed', statusCode: 409 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(reconcileHealthSamples).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('rolls back a held write when the account disappears after admission', async () => {
    const owner = await connectedUser();
    const create = HealthSample.create.bind(HealthSample);
    let releaseCreate;
    let createStarted;
    const started = new Promise((resolve) => { createStarted = resolve; });
    const held = new Promise((resolve) => { releaseCreate = resolve; });
    const createSpy = jest.spyOn(HealthSample, 'create').mockImplementation(async (...args) => {
      createStarted();
      await held;
      return create(...args);
    });

    const ingest = ingestV2Batch(owner._id, 'healthkit', [upsert()]);
    await started;
    await User.deleteOne({ _id: owner._id });
    releaseCreate();

    await expect(ingest).rejects.toMatchObject({ code: 'wearable_connection_changed', statusCode: 409 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(reconcileHealthSamples).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('does not let an older held batch delete a reconnect generation row with the same identity', async () => {
    const owner = await connectedUser();
    const create = HealthSample.create.bind(HealthSample);
    let releaseCreate;
    let createStarted;
    const started = new Promise((resolve) => { createStarted = resolve; });
    const held = new Promise((resolve) => { releaseCreate = resolve; });
    let heldOnce = false;
    const createSpy = jest.spyOn(HealthSample, 'create').mockImplementation(async (...args) => {
      if (!heldOnce) {
        heldOnce = true;
        createStarted();
        await held;
      }
      return create(...args);
    });

    const oldIngest = ingestV2Batch(owner._id, 'healthkit', [upsert()], { connectionVersion: 0 });
    await started;
    await User.updateOne(
      { _id: owner._id },
      { $set: { wearableProvider: 'apple_health', wearableConnectionVersion: 2 } },
    );
    await HealthSample.create({
      userId: owner._id,
      sampleKey: require('../app/services/wearable/healthSampleIdentity')
        .healthSampleKey(owner._id, 'apple_health', sampleId),
      source: 'apple_health',
      metric: 'heart_rate',
      value: 72,
      unit: 'bpm',
      startAt: new Date('2026-10-06T06:30:00.000Z'),
      endAt: new Date('2026-10-06T06:31:00.000Z'),
      state: 'active',
      projectionState: 'pending',
      ingestState: 'committed',
      connectionVersion: 2,
      expiresAt: new Date('2027-01-04T06:31:00.000Z'),
    });
    releaseCreate();

    await expect(oldIngest).rejects.toMatchObject({ code: 'wearable_connection_changed', statusCode: 409 });
    const survivor = await HealthSample.findOne({ userId: owner._id });
    expect(survivor).toMatchObject({ connectionVersion: 2, ingestState: 'committed' });
    createSpy.mockRestore();
  });

  it('keeps failed cleanup staged and the repair path removes it durably', async () => {
    const owner = await connectedUser();
    const create = HealthSample.create.bind(HealthSample);
    let releaseCreate;
    let createStarted;
    const started = new Promise((resolve) => { createStarted = resolve; });
    const held = new Promise((resolve) => { releaseCreate = resolve; });
    const createSpy = jest.spyOn(HealthSample, 'create').mockImplementation(async (...args) => {
      createStarted();
      await held;
      return create(...args);
    });
    const deleteSpy = jest.spyOn(HealthSample, 'deleteMany');

    const ingest = ingestV2Batch(owner._id, 'healthkit', [upsert()]);
    await started;
    await User.updateOne(
      { _id: owner._id },
      { $set: { wearableProvider: null }, $inc: { wearableConnectionVersion: 1 } },
    );
    deleteSpy.mockRejectedValueOnce(new Error('temporary mongo failure'));
    releaseCreate();

    await expect(ingest).rejects.toThrow('temporary mongo failure');
    expect(await HealthSample.countDocuments({ userId: owner._id, ingestState: 'staged' })).toBe(1);
    deleteSpy.mockRestore();
    createSpy.mockRestore();

    await expect(recoverStagedHealthSamples({ userId: owner._id, source: 'apple_health' }))
      .resolves.toMatchObject({ removed: 1, failed: 0 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
  });

  it('does not enable the authoritative v2 lane for Health Connect yet', async () => {
    await expect(ingestV2Batch(new mongoose.Types.ObjectId(), 'health_connect', [upsert()]))
      .rejects.toMatchObject({ code: 'health_v2_platform_not_supported', statusCode: 400 });
    expect(await HealthSample.countDocuments()).toBe(0);
  });
});
