'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null) }));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn().mockResolvedValue({ queued: true }) }));
jest.mock('../app/queues/userJobPurge', () => ({
  purgeUserJobs: jest.fn().mockResolvedValue({
    removed: 0,
    byQueue: {
      'reward-ingest': { removed: 0 },
      'state-vector-recompute': { removed: 0 },
    },
  }),
}));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog = require('../app/models/BiometricLog');
const ConsentRecord = require('../app/models/ConsentRecord');
const HealthSample = require('../app/models/HealthSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const User = require('../app/models/User');
const VitalSample = require('../app/models/VitalSample');
const { enqueue } = require('../app/queues/queue');
const {
  HEALTH_CONSENT_PURPOSE,
  recordConsent,
  withdrawConsent,
} = require('../app/services/privacy/consent');
const { eraseUserChildData } = require('../app/services/privacy/erasure');
const { eraseWearableProvider } = require('../app/services/privacy/wearableErasure');
const {
  reconcileHealthSamples,
  recoverOwedHealthProjectionCleanups,
} = require('../app/services/wearable/healthSampleReconciliation');

jest.setTimeout(120000);

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'health_sample_consent_race' });
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
  jest.restoreAllMocks();
  enqueue.mockClear();
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

async function grantedUser() {
  const owner = await User.create({
    ssoProvider: 'google',
    ssoId: new mongoose.Types.ObjectId().toString(),
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    wearableProvider: 'apple_health',
  });
  await recordConsent(owner._id, {
    purpose: HEALTH_CONSENT_PURPOSE,
    dataCategories: ['heart_rate', 'resting_heart_rate'],
  });
  return owner;
}

async function pending(owner, keyDigit, metric) {
  return HealthSample.create({
    userId: owner._id,
    sampleKey: keyDigit.repeat(64),
    source: 'apple_health',
    metric,
    value: metric === 'heart_rate' ? 72 : 58,
    unit: 'bpm',
    startAt: new Date('2026-10-07T08:00:00Z'),
    endAt: new Date('2026-10-07T08:01:00Z'),
    state: 'active',
    projectionState: 'pending',
    expiresAt: new Date('2027-01-05T08:01:00Z'),
  });
}

async function existingAppleProfile(owner) {
  return MedicalProfile.create({
    userId: owner._id,
    healthProjectionProvider: 'apple_health',
    restingHeartRate: 57,
    maxHeartRate: 181,
  });
}

function holdBefore(object, method) {
  const original = object[method].bind(object);
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  jest.spyOn(object, method).mockImplementation(async (...args) => {
    entered();
    await releasePromise;
    return original(...args);
  });
  return { entered: enteredPromise, release };
}

describe('health sample reconciliation privacy fences', () => {
  it('reads no pending health sample into a projection without a current consent grant', async () => {
    const owner = await User.create({
      ssoProvider: 'google',
      ssoId: new mongoose.Types.ObjectId().toString(),
      email: `${new mongoose.Types.ObjectId()}@example.test`,
      wearableProvider: 'apple_health',
    });
    const row = await pending(owner, '0', 'heart_rate');

    await expect(reconcileHealthSamples(owner._id, 'apple_health')).resolves.toEqual({
      projected: 0,
      removed: 0,
      profileUpdated: false,
    });

    expect(await BiometricLog.countDocuments({ userId: owner._id })).toBe(0);
    // A definitive missing/withdrawn grant is also the durable cleanup path: the pending
    // authoritative row is removed instead of waiting up to its retention limit.
    expect(await HealthSample.findById(row._id)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not recreate a time-series row after health-consent withdrawal erased it', async () => {
    const owner = await grantedUser();
    await pending(owner, '1', 'heart_rate');
    const hold = holdBefore(BiometricLog, 'create');

    const run = reconcileHealthSamples(owner._id, 'apple_health');
    await hold.entered;
    await withdrawConsent(owner._id, HEALTH_CONSENT_PURPOSE);
    hold.release();
    await run;

    expect(await BiometricLog.countDocuments({ userId: owner._id })).toBe(0);
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not recreate an Apple-owned profile after the provider was disconnected', async () => {
    const owner = await grantedUser();
    await existingAppleProfile(owner);
    await pending(owner, '2', 'resting_heart_rate');
    const hold = holdBefore(MedicalProfile, 'findOneAndUpdate');

    const run = reconcileHealthSamples(owner._id, 'apple_health');
    await hold.entered;
    await eraseWearableProvider(await User.findById(owner._id), 'apple_health');
    hold.release();
    await run;

    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not restore an erased Apple-owned profile snapshot after consent withdrawal', async () => {
    const owner = await grantedUser();
    await existingAppleProfile(owner);
    await pending(owner, '5', 'resting_heart_rate');
    const hold = holdBefore(MedicalProfile, 'findOneAndUpdate');

    const run = reconcileHealthSamples(owner._id, 'apple_health');
    await hold.entered;
    await withdrawConsent(owner._id, HEALTH_CONSENT_PURPOSE);
    hold.release();
    await run;

    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects a reconciliation from the connection generation before disconnect and reconnect', async () => {
    const owner = await grantedUser();
    await existingAppleProfile(owner);
    await pending(owner, '6', 'resting_heart_rate');
    const hold = holdBefore(MedicalProfile, 'findOneAndUpdate');

    const run = reconcileHealthSamples(owner._id, 'apple_health');
    await hold.entered;
    await eraseWearableProvider(await User.findById(owner._id), 'apple_health');
    await User.updateOne(
      { _id: owner._id },
      { $set: { wearableProvider: 'apple_health' }, $inc: { wearableConnectionVersion: 1 } },
    );
    hold.release();
    await run;

    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not recreate a vital row after account deletion erased the user and children', async () => {
    const owner = await grantedUser();
    await existingAppleProfile(owner);
    await pending(owner, '3', 'resting_heart_rate');
    const hold = holdBefore(VitalSample, 'create');

    const run = reconcileHealthSamples(owner._id, 'apple_health');
    await hold.entered;
    await eraseUserChildData(owner._id);
    await User.deleteOne({ _id: owner._id });
    hold.release();
    await run;

    expect(await User.countDocuments({ _id: owner._id })).toBe(0);
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('undoes its write when withdrawal and re-grant change the consent fence mid-run', async () => {
    const owner = await grantedUser();
    await pending(owner, '4', 'heart_rate');
    const hold = holdBefore(BiometricLog, 'create');

    const run = reconcileHealthSamples(owner._id, 'apple_health');
    await hold.entered;
    await withdrawConsent(owner._id, HEALTH_CONSENT_PURPOSE);
    await recordConsent(owner._id, {
      purpose: HEALTH_CONSENT_PURPOSE,
      dataCategories: ['heart_rate'],
    });
    await User.updateOne({ _id: owner._id }, { $set: { wearableProvider: 'apple_health' } });
    hold.release();
    await run;

    expect(await BiometricLog.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('keeps a durable marker when compensation fails and the repair sweep finishes it', async () => {
    const owner = await grantedUser();
    await pending(owner, '7', 'heart_rate');
    const hold = holdBefore(BiometricLog, 'create');

    const run = reconcileHealthSamples(owner._id, 'apple_health');
    await hold.entered;
    await withdrawConsent(owner._id, HEALTH_CONSENT_PURPOSE);
    const deleteSpy = jest.spyOn(BiometricLog, 'deleteMany')
      .mockRejectedValueOnce(new Error('temporary cleanup failure'));
    hold.release();

    await expect(run).rejects.toMatchObject({
      code: 'health_projection_pending',
      statusCode: 503,
    });
    expect(await BiometricLog.countDocuments({ userId: owner._id })).toBe(1);
    const marked = await User.findById(owner._id).lean();
    expect(marked.healthProjectionCleanupPending).toHaveLength(1);
    deleteSpy.mockRestore();

    await expect(recoverOwedHealthProjectionCleanups())
      .resolves.toEqual({ cleaned: 1, deferred: 0, failed: 0 });
    expect(await BiometricLog.countDocuments({ userId: owner._id })).toBe(0);
    const repaired = await User.findById(owner._id).lean();
    expect(repaired.healthProjectionCleanupPending).toEqual([]);
  });
});
