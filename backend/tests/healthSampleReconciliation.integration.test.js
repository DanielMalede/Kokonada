'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const mockRedis = { del: jest.fn().mockResolvedValue(2) };
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => mockRedis) }));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn().mockResolvedValue({ queued: true }) }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog = require('../app/models/BiometricLog');
const ConsentRecord = require('../app/models/ConsentRecord');
const HealthSample = require('../app/models/HealthSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const User = require('../app/models/User');
const VitalSample = require('../app/models/VitalSample');
const { enqueue } = require('../app/queues/queue');
const { QUEUES } = require('../app/queues/definitions');
const { stateVectorJobId } = require('../app/queues/stateVectorJob');
const {
  HEALTH_CONSENT_PURPOSE,
  recordConsent,
} = require('../app/services/privacy/consent');
const { reconcileHealthSamples } = require('../app/services/wearable/healthSampleReconciliation');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_health_reconciliation' });
  await Promise.all([
    BiometricLog.syncIndexes(),
    ConsentRecord.syncIndexes(),
    HealthSample.syncIndexes(),
    MedicalProfile.syncIndexes(),
    User.syncIndexes(),
    VitalSample.syncIndexes(),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockRedis.del.mockResolvedValue(2);
  enqueue.mockResolvedValue({ queued: true });
  await Promise.all([
    BiometricLog.deleteMany({}),
    ConsentRecord.deleteMany({}),
    HealthSample.deleteMany({}),
    MedicalProfile.deleteMany({}),
    User.deleteMany({}),
    VitalSample.deleteMany({}),
  ]);
});

async function user(wearableProvider = 'apple_health') {
  const owner = await User.create({
    ssoProvider: 'google',
    ssoId: new mongoose.Types.ObjectId().toString(),
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    wearableProvider,
  });
  await recordConsent(owner._id, {
    purpose: HEALTH_CONSENT_PURPOSE,
    dataCategories: ['heart_rate', 'resting_heart_rate', 'hrv', 'sleep'],
  });
  return owner;
}

async function sample(owner, keyDigit, overrides = {}) {
  return HealthSample.create({
    userId: owner._id,
    sampleKey: keyDigit.repeat(64),
    source: 'apple_health',
    metric: 'heart_rate',
    value: 72,
    unit: 'count/min',
    startAt: new Date('2026-10-06T08:00:00Z'),
    endAt: new Date('2026-10-06T08:01:00Z'),
    state: 'active',
    projectionState: 'pending',
    expiresAt: new Date('2027-01-04T08:01:00Z'),
    ...overrides,
  });
}

const sleep = (owner, keyDigit, metric, startAt, endAt) => sample(owner, keyDigit, {
  metric,
  value: (new Date(endAt) - new Date(startAt)) / 60000,
  unit: 'min',
  startAt: new Date(startAt),
  endAt: new Date(endAt),
});

describe('reconcileHealthSamples', () => {
  it('projects time series, rebuilds Apple profile fields, invalidates caches, queues state and applies last', async () => {
    const owner = await user();
    await Promise.all([
      sample(owner, '1'),
      sample(owner, '2', { metric: 'resting_heart_rate', value: 58 }),
      sample(owner, '3', { metric: 'hrv', method: 'sdnn', value: 92, unit: 'ms' }),
      sleep(owner, '4', 'sleep_deep', '2026-10-05T05:00:00Z', '2026-10-05T06:00:00Z'),
      sleep(owner, '5', 'sleep_light', '2026-10-05T02:00:00Z', '2026-10-05T05:00:00Z'),
      sleep(owner, '6', 'sleep_rem', '2026-10-05T06:00:00Z', '2026-10-05T06:40:00Z'),
      sleep(owner, '7', 'sleep_deep', '2026-10-06T04:40:00Z', '2026-10-06T06:00:00Z'),
      sleep(owner, '8', 'sleep_light', '2026-10-06T01:40:00Z', '2026-10-06T05:00:00Z'),
      sleep(owner, '9', 'sleep_rem', '2026-10-06T06:00:00Z', '2026-10-06T06:50:00Z'),
    ]);

    await expect(reconcileHealthSamples(owner._id, 'apple_health')).resolves.toEqual({
      projected: 3, removed: 0, profileUpdated: true,
    });

    expect(await BiometricLog.countDocuments({ userId: owner._id })).toBe(1);
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(2);
    const profile = await MedicalProfile.findOne({ userId: owner._id });
    expect(profile.healthProjectionProvider).toBe('apple_health');
    expect(Number(profile.restingHeartRate)).toBe(58);
    expect(profile.hrv).toBeNull();
    expect(Number(profile.sleepStages.deep)).toBe(70);
    expect(Number(profile.sleepStages.light)).toBe(190);
    expect(Number(profile.sleepStages.rem)).toBe(45);
    expect(Number(profile.lastNightSleep.deep)).toBe(80);
    expect(profile.lastNightSleep.date).toEqual(new Date('2026-10-06'));
    expect(mockRedis.del).toHaveBeenCalledWith(
      `bio:baseline:${owner._id}`,
      `bio:affect:${owner._id}`,
    );
    expect(enqueue).toHaveBeenCalledWith(
      QUEUES.STATE_VECTOR_RECOMPUTE,
      { userId: owner._id },
      expect.objectContaining({ jobId: stateVectorJobId(owner._id) }),
    );
    expect(await HealthSample.countDocuments({ userId: owner._id, projectionState: 'applied' })).toBe(9);
  });

  it('rebuilds sleep from remaining active intervals after a deletion', async () => {
    const owner = await user();
    const removed = await sleep(owner, 'a', 'sleep_deep', '2026-10-06T04:00:00Z', '2026-10-06T05:00:00Z');
    await sleep(owner, 'b', 'sleep_deep', '2026-10-06T05:00:00Z', '2026-10-06T05:30:00Z');
    await reconcileHealthSamples(owner._id, 'apple_health');

    const tombstone = await HealthSample.findById(removed._id);
    tombstone.state = 'deleted';
    tombstone.deletedAt = new Date('2026-10-07T08:00:00Z');
    tombstone.projectionState = 'pending';
    await tombstone.save();
    expect((await HealthSample.findById(removed._id)).state).toBe('deleted');
    expect(await HealthSample.countDocuments({ userId: owner._id, state: 'active' })).toBe(1);
    await expect(reconcileHealthSamples(owner._id, 'apple_health')).resolves.toEqual({
      projected: 0, removed: 0, profileUpdated: true,
    });

    const profile = await MedicalProfile.findOne({ userId: owner._id });
    expect(Number(profile.sleepStages.deep)).toBe(30);
    expect(Number(profile.lastNightSleep.deep)).toBe(30);
    expect((await HealthSample.findById(removed._id)).projectionState).toBe('applied');
  });

  it('does not overwrite a profile while another wearable provider is active', async () => {
    const owner = await user('garmin');
    await MedicalProfile.create({
      userId: owner._id,
      restingHeartRate: 63,
      hrv: 55,
      sleepStages: { deep: 91, light: 211, rem: 61 },
    });
    await sleep(owner, 'c', 'sleep_deep', '2026-10-06T04:00:00Z', '2026-10-06T05:00:00Z');

    const result = await reconcileHealthSamples(owner._id, 'apple_health');
    const profile = await MedicalProfile.findOne({ userId: owner._id });

    expect(result.profileUpdated).toBe(false);
    expect(profile.healthProjectionProvider).toBeNull();
    expect(Number(profile.sleepStages.deep)).toBe(91);
    expect(Number(profile.hrv)).toBe(55);
  });

  it('keeps rows pending after a projection failure and repairs idempotently on retry', async () => {
    const owner = await user();
    const pending = await sample(owner, 'd');
    const create = jest.spyOn(BiometricLog, 'create').mockRejectedValueOnce(new Error('projection unavailable'));

    await expect(reconcileHealthSamples(owner._id, 'apple_health')).rejects.toThrow('projection unavailable');
    expect((await HealthSample.findById(pending._id)).projectionState).toBe('pending');
    expect(enqueue).not.toHaveBeenCalled();

    await expect(reconcileHealthSamples(owner._id, 'apple_health')).resolves.toEqual({
      projected: 1, removed: 0, profileUpdated: false,
    });
    expect(await BiometricLog.countDocuments({ userId: owner._id })).toBe(1);
    expect((await HealthSample.findById(pending._id)).projectionState).toBe('applied');
    create.mockRestore();
  });

  it('keeps rows pending when rebuilding the active Apple profile fails', async () => {
    const owner = await user();
    const pending = await sleep(owner, 'f', 'sleep_deep', '2026-10-06T04:00:00Z', '2026-10-06T05:00:00Z');
    const update = jest.spyOn(MedicalProfile, 'findOneAndUpdate')
      .mockRejectedValueOnce(new Error('profile unavailable'));

    await expect(reconcileHealthSamples(owner._id, 'apple_health')).rejects.toThrow('profile unavailable');
    expect((await HealthSample.findById(pending._id)).projectionState).toBe('pending');
    expect(enqueue).not.toHaveBeenCalled();
    update.mockRestore();
  });

  it('does not mark rows applied when cache invalidation or state enqueue fails', async () => {
    const owner = await user();
    const pending = await sample(owner, 'e');
    mockRedis.del.mockRejectedValueOnce(new Error('redis down'));

    await expect(reconcileHealthSamples(owner._id, 'apple_health')).rejects.toThrow('redis down');
    expect((await HealthSample.findById(pending._id)).projectionState).toBe('pending');

    enqueue.mockResolvedValueOnce({ queued: false, reason: 'redis-error' });
    await expect(reconcileHealthSamples(owner._id, 'apple_health')).rejects.toThrow('health_projection_pending');
    expect((await HealthSample.findById(pending._id)).projectionState).toBe('pending');
  });
});
