'use strict';

// The second resilience audit of #256 (BE-144), RA-6 to RA-8, on real Mongo.
//
// RA-6: a v2 refusal re-applies the erasure's orphan rule (RA-1). When that call fails, or a step
// before it does, the operation's journal has to outlive the failure so that the repair worker
// applies the rule from it: the reconcile's cleanup marker, the ingest's aborted batch journal. The
// client's retry is no substitute: the pending rows are gone, and after a disconnect or a withdrawal
// the retry stops at the start fence.
//
// RA-7: an ingest whose write phase fails after a staged row fooled the erasure's count removes that
// row in its catch, so the catch re-applies the rule as well.
//
// RA-8: the rule deletes the whole profile once no sample is left, so the repair pass applies it only
// where an erasure can have run since the batch was admitted, never to a batch that a crash or a lost
// lease cut while the grant and the connection held.

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
const MorningState = require('../app/models/MorningState');
const User = require('../app/models/User');
const VitalSample = require('../app/models/VitalSample');
const { enqueue } = require('../app/queues/queue');
const { HEALTH_CONSENT_PURPOSE, recordConsent } = require('../app/services/privacy/consent');
const { eraseWearableProvider } = require('../app/services/privacy/wearableErasure');
const { reconcileHealthSamples } = require('../app/services/wearable/healthSampleReconciliation');
const { ingestV2Batch, recoverStagedHealthSamples } = require('../app/services/wearable/healthStoreV2');
const {
  HealthIngestBatch,
  HealthProjectionCleanup,
} = require('../app/services/wearable/healthOperationJournal');
const repairWorker = require('../app/workers/healthSampleReconciliation.worker');

jest.setTimeout(120000);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RETENTION_MS = 90 * DAY;
const ago = (ms) => new Date(Date.now() - ms);
const yesterday = () => new Date(`${ago(DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);

const IN_RETENTION = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const OUT_OF_RETENTION = '1812265d-2516-4f6e-a1d4-7088487c46b1';

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'shadow_orphan_rule_durability' });
  await Promise.all([
    BiometricLog.syncIndexes(),
    ConsentRecord.syncIndexes(),
    HealthSample.syncIndexes(),
    MedicalProfile.syncIndexes(),
    MorningState.syncIndexes(),
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
    HealthIngestBatch.deleteMany({}),
    HealthProjectionCleanup.deleteMany({}),
    HealthSample.deleteMany({}),
    MedicalProfile.deleteMany({}),
    MorningState.deleteMany({}),
    User.deleteMany({}),
    VitalSample.deleteMany({}),
  ]);
});

function gate() {
  let open;
  const opened = new Promise((resolve) => { open = resolve; });
  return { opened, open };
}

const primaryLost = () => Object.assign(new Error('no primary'), { name: 'MongoServerSelectionError' });

const settle = (promise) => promise.then(
  (value) => ({ resolved: value }),
  (error) => error,
);

async function appleUserWithGrant() {
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

// The two derived aggregates the orphan rule governs. `maxHeartRate` has no Apple provenance, so the
// disconnect's provenance clear leaves it in place: only the orphan rule removes this profile.
async function derivedAggregates(owner) {
  await MedicalProfile.create({
    userId: owner._id,
    healthProjectionProvider: 'apple_health',
    restingHeartRate: 57,
    maxHeartRate: 181,
  });
  await MorningState.create({ userId: owner._id, date: yesterday(), readiness: 0.6 });
}

async function expectNoAggregates(owner) {
  expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
  expect(await MorningState.countDocuments({ userId: owner._id })).toBe(0);
}

function pendingRestingHr(owner, keyDigit) {
  const endAt = ago(2 * HOUR);
  return HealthSample.create({
    userId: owner._id,
    sampleKey: keyDigit.repeat(64),
    source: 'apple_health',
    metric: 'resting_heart_rate',
    value: 58,
    unit: 'bpm',
    startAt: new Date(endAt.getTime() - MINUTE),
    endAt,
    state: 'active',
    projectionState: 'pending',
    expiresAt: new Date(endAt.getTime() + RETENTION_MS),
  });
}

function heartRate(sampleId, endedAgoMs, value = 72) {
  const endAt = ago(endedAgoMs);
  return {
    sampleId,
    operation: 'upsert',
    type: 'heart_rate',
    value,
    unit: 'bpm',
    startDate: new Date(endAt.getTime() - MINUTE).toISOString(),
    endDate: endAt.toISOString(),
  };
}

// Holds `Model.create` before the insert; once the test commits it, signals the commit and holds the
// caller again until the test resumes it.
function holdCreate(Model) {
  const entered = gate();
  const commit = gate();
  const committed = gate();
  const resume = gate();
  const create = Model.create.bind(Model);
  jest.spyOn(Model, 'create').mockImplementation(async (...args) => {
    entered.open();
    await commit.opened;
    const created = await create(...args);
    committed.open();
    await resume.opened;
    return created;
  });
  return {
    entered: entered.opened,
    commit: commit.open,
    committed: committed.opened,
    resume: resume.open,
  };
}

// The race RA-1 names: the erasure is held after it has deleted the provider's samples and before it
// counts what remains, the held write commits in that gap, and the erasure then runs to the end.
async function eraseAroundWrite(owner, write) {
  const counting = gate();
  const proceed = gate();
  const updateMany = MedicalProfile.updateMany.bind(MedicalProfile);
  jest.spyOn(MedicalProfile, 'updateMany').mockImplementation(async (...args) => {
    counting.open();
    await proceed.opened;
    return updateMany(...args);
  });
  await write.entered;
  const erasure = eraseWearableProvider(await User.findById(owner._id), 'apple_health');
  await counting.opened;
  write.commit();
  await write.committed;
  proceed.open();
  return erasure;
}

// A reconcile whose projection commits inside the disconnect's erasure; the run is still held.
async function reconcileAcrossDisconnect(owner) {
  const projection = holdCreate(VitalSample);
  const run = settle(reconcileHealthSamples(owner._id, 'apple_health'));
  await expect(eraseAroundWrite(owner, projection)).resolves.toMatchObject({
    healthSamples: 1,
    vitalSamples: 0,
    medicalProfiles: 0,
    morningStates: 0,
  });
  return { resume: projection.resume, outcome: run };
}

// An ingest whose staged row commits inside the disconnect's erasure; the batch is still held.
async function ingestAcrossDisconnect(owner, samples) {
  const staged = holdCreate(HealthSample);
  const ingest = settle(ingestV2Batch(owner._id, 'healthkit', samples));
  await expect(eraseAroundWrite(owner, staged)).resolves.toMatchObject({
    healthSamples: 0,
    medicalProfiles: 0,
    morningStates: 0,
  });
  return { resume: staged.resume, outcome: ingest };
}

// The same batch, whose own cleanup fails twice, at its refusal and in its catch, so the staged row
// and the aborted journal are left for the repair pass.
async function abortedAcrossDisconnect(owner) {
  const { resume, outcome } = await ingestAcrossDisconnect(owner, [heartRate(IN_RETENTION, 2 * HOUR)]);
  const deleteMany = jest.spyOn(HealthSample, 'deleteMany')
    .mockRejectedValueOnce(new Error('temporary mongo failure'))
    .mockRejectedValueOnce(new Error('temporary mongo failure'));
  resume();
  expect(await outcome).toMatchObject({ message: 'temporary mongo failure' });
  deleteMany.mockRestore();
  expect(await HealthSample.countDocuments({ userId: owner._id, ingestState: 'staged' })).toBe(1);
  expect(await HealthIngestBatch.countDocuments({ userId: owner._id, status: 'aborted' })).toBe(1);
}

// A v1 user's profile: the v1 lane writes sleep to it alone, so no sample row backs it.
async function v1SleepAndMorningState(owner) {
  await MedicalProfile.create({
    userId: owner._id,
    sleepStages: { deep: 80, light: 220, rem: 95 },
    maxHeartRate: 181,
  });
  await MorningState.create({ userId: owner._id, date: yesterday(), readiness: 0.6 });
}

async function expectV1SleepAndMorningState(owner) {
  const profile = await MedicalProfile.findOne({ userId: owner._id });
  expect(profile).not.toBeNull();
  expect(Number(profile.sleepStages.deep)).toBe(80);
  expect(await MorningState.countDocuments({ userId: owner._id })).toBe(1);
}

// From here on the write fence's account read fails as an unreachable primary does. Only
// healthWriteFence selects `deletedAt` alone (healthWriteFence.js:40); every other read passes.
function failFenceReads() {
  const findById = User.findById.bind(User);
  return jest.spyOn(User, 'findById').mockImplementation((...args) => {
    const query = findById(...args);
    const select = query.select.bind(query);
    query.select = (fields) => {
      if (fields !== 'deletedAt') return select(fields);
      const unreachable = {
        read: () => unreachable,
        lean: () => Promise.reject(primaryLost()),
      };
      return unreachable;
    };
    return query;
  });
}

describe('RA-6: a failed orphan rule at a v2 refusal is applied by the repair worker', () => {
  it('reconcile: the rule fails once, and one worker pass leaves no aggregates', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await pendingRestingHr(owner, 'e');

    const run = await reconcileAcrossDisconnect(owner);
    const deleteMany = jest.spyOn(MedicalProfile, 'deleteMany').mockRejectedValueOnce(primaryLost());
    jest.spyOn(console, 'error').mockImplementation(() => {});
    run.resume();

    expect(await run.outcome).toBeInstanceOf(Error);
    expect(deleteMany).toHaveBeenCalled();
    await repairWorker.process();
    await expectNoAggregates(owner);
    expect(await HealthProjectionCleanup.countDocuments({ userId: owner._id })).toBe(0);
  });

  it('reconcile: the pending cleanup fails once, and one worker pass leaves no aggregates', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await pendingRestingHr(owner, 'f');

    const run = await reconcileAcrossDisconnect(owner);
    jest.spyOn(HealthSample, 'deleteMany').mockRejectedValueOnce(primaryLost());
    jest.spyOn(console, 'error').mockImplementation(() => {});
    run.resume();

    expect(await run.outcome).toBeInstanceOf(Error);
    await repairWorker.process();
    await expectNoAggregates(owner);
    expect(await HealthProjectionCleanup.countDocuments({ userId: owner._id })).toBe(0);
  });

  // The marker outlives the worker's own failed call as well: the recovery discharges it only once
  // the rule has run.
  it('reconcile: the rule fails in the run and again in the first worker pass, and the next pass applies it', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await pendingRestingHr(owner, 'a');

    const run = await reconcileAcrossDisconnect(owner);
    jest.spyOn(MedicalProfile, 'deleteMany')
      .mockRejectedValueOnce(primaryLost())
      .mockRejectedValueOnce(primaryLost());
    jest.spyOn(console, 'error').mockImplementation(() => {});
    run.resume();
    expect(await run.outcome).toMatchObject({ code: 'health_projection_pending', statusCode: 503 });

    await repairWorker.process();
    expect(await HealthProjectionCleanup.countDocuments({ userId: owner._id })).toBe(1);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(1);

    await repairWorker.process();
    await expectNoAggregates(owner);
    expect(await HealthProjectionCleanup.countDocuments({ userId: owner._id })).toBe(0);
  });

  // An unreadable fence decides nothing either way: the rule does not run (RA-8), and the marker
  // stays, so the obligation is not dropped with it.
  it('reconcile: a worker pass that cannot read the fence keeps the marker, and the next pass applies the rule', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await pendingRestingHr(owner, 'c');

    const run = await reconcileAcrossDisconnect(owner);
    jest.spyOn(MedicalProfile, 'deleteMany').mockRejectedValueOnce(primaryLost());
    jest.spyOn(console, 'error').mockImplementation(() => {});
    run.resume();
    expect(await run.outcome).toMatchObject({ code: 'health_projection_pending', statusCode: 503 });

    const fenceReads = failFenceReads();
    await repairWorker.process();
    expect(await HealthProjectionCleanup.countDocuments({ userId: owner._id })).toBe(1);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(1);
    expect(await MorningState.countDocuments({ userId: owner._id })).toBe(1);

    fenceReads.mockRestore();
    await repairWorker.process();
    await expectNoAggregates(owner);
    expect(await HealthProjectionCleanup.countDocuments({ userId: owner._id })).toBe(0);
  });

  it('ingest: the rule fails once, and one worker pass leaves no aggregates and no journal', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);

    const ingest = await ingestAcrossDisconnect(owner, [heartRate(IN_RETENTION, 2 * HOUR)]);
    const deleteMany = jest.spyOn(MedicalProfile, 'deleteMany').mockRejectedValueOnce(primaryLost());
    jest.spyOn(console, 'error').mockImplementation(() => {});
    ingest.resume();

    expect(await ingest.outcome).toBeInstanceOf(Error);
    expect(deleteMany).toHaveBeenCalled();
    await repairWorker.process();
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    await expectNoAggregates(owner);
  });

  // The catch's own call fails too: the aborted journal stays, and the repair pass applies the rule.
  it('ingest: the rule fails at the refusal and again in the catch, and one worker pass leaves no aggregates and no journal', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);

    const ingest = await ingestAcrossDisconnect(owner, [heartRate(IN_RETENTION, 2 * HOUR)]);
    jest.spyOn(MedicalProfile, 'deleteMany')
      .mockRejectedValueOnce(primaryLost())
      .mockRejectedValueOnce(primaryLost());
    jest.spyOn(console, 'error').mockImplementation(() => {});
    ingest.resume();

    expect(await ingest.outcome).toMatchObject({ code: 'health_projection_pending', statusCode: 503 });
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id, status: 'aborted' })).toBe(1);
    await repairWorker.process();
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    await expectNoAggregates(owner);
  });

  it('ingest: the refusal\'s staged-row removal fails once, and one worker pass leaves no aggregates', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);

    const ingest = await ingestAcrossDisconnect(owner, [heartRate(IN_RETENTION, 2 * HOUR)]);
    jest.spyOn(HealthSample, 'deleteMany').mockRejectedValueOnce(new Error('temporary mongo failure'));
    ingest.resume();

    expect(await ingest.outcome).toBeInstanceOf(Error);
    await repairWorker.process();
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    await expectNoAggregates(owner);
  });
});

describe('RA-7: the ingest catch re-applies the rule after a write-phase error', () => {
  it('RA-7: a 422 after the staged row fooled the erasure leaves no aggregates once the worker has run', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);

    const ingest = await ingestAcrossDisconnect(owner, [
      heartRate(IN_RETENTION, 2 * HOUR),
      heartRate(OUT_OF_RETENTION, 91 * DAY, 70),
    ]);
    ingest.resume();

    expect(await ingest.outcome).toMatchObject({ code: 'health_sample_outside_retention', statusCode: 422 });
    await repairWorker.process();
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    await expectNoAggregates(owner);
  });

  // The catch cannot read the fence, so it decides nothing: the aborted journal stays, and the
  // worker's pass, which can read it, applies the rule.
  it('RA-7 with an unreadable fence: the catch keeps the aborted journal, and the worker applies the rule once the fence reads', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);

    const ingest = await ingestAcrossDisconnect(owner, [
      heartRate(IN_RETENTION, 2 * HOUR),
      heartRate(OUT_OF_RETENTION, 91 * DAY, 70),
    ]);
    const fenceReads = failFenceReads();
    ingest.resume();

    expect(await ingest.outcome).toMatchObject({ code: 'health_sample_outside_retention', statusCode: 422 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id, status: 'aborted' })).toBe(1);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(1);

    fenceReads.mockRestore();
    await repairWorker.process();
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    await expectNoAggregates(owner);
  });
});

describe('RA-8: the repair pass leaves a connected, consenting user\'s profile alone', () => {
  it('RA-8: keeps v1 sleep and MorningState when a crash aborted a batch whose grant and connection never changed', async () => {
    const owner = await appleUserWithGrant();
    const grant = await ConsentRecord.findOne({ userId: owner._id }).sort({ createdAt: -1 });
    // v1 writes sleep to the profile alone; no sample row backs it.
    await MedicalProfile.create({
      userId: owner._id,
      sleepStages: { deep: 80, light: 220, rem: 95 },
      maxHeartRate: 181,
    });
    await MorningState.create({ userId: owner._id, date: yesterday(), readiness: 0.6 });

    const ingestToken = 'd'.repeat(32);
    await HealthIngestBatch.create({
      _id: ingestToken,
      userId: owner._id,
      source: 'apple_health',
      connectionVersion: 0,
      consentFence: String(grant._id),
      status: 'writing',
      leaseUntil: ago(MINUTE),
      createdAt: ago(10 * MINUTE),
    });
    const endAt = ago(2 * HOUR);
    await HealthSample.create({
      userId: owner._id,
      sampleKey: 'c'.repeat(64),
      source: 'apple_health',
      metric: 'heart_rate',
      value: 72,
      unit: 'bpm',
      startAt: new Date(endAt.getTime() - MINUTE),
      endAt,
      state: 'active',
      projectionState: 'pending',
      ingestState: 'staged',
      ingestToken,
      consentFence: String(grant._id),
      connectionVersion: 0,
      expiresAt: new Date(endAt.getTime() + RETENTION_MS),
    });

    await expect(recoverStagedHealthSamples({ userId: owner._id }))
      .resolves.toEqual({ recovered: 0, removed: 1, failed: 0 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    const profile = await MedicalProfile.findOne({ userId: owner._id });
    expect(profile).not.toBeNull();
    expect(Number(profile.sleepStages.deep)).toBe(80);
    expect(await MorningState.countDocuments({ userId: owner._id })).toBe(1);
  });

  // The ingest's catch runs on every failed batch, so it takes the same gate: a write-phase error
  // under an unchanged grant and connection removes the batch's own rows and nothing else.
  it('RA-8: a write-phase 422 under an unchanged grant and connection keeps v1 sleep and MorningState', async () => {
    const owner = await appleUserWithGrant();
    await v1SleepAndMorningState(owner);

    await expect(ingestV2Batch(owner._id, 'healthkit', [
      heartRate(IN_RETENTION, 2 * HOUR),
      heartRate(OUT_OF_RETENTION, 91 * DAY, 70),
    ])).rejects.toMatchObject({ code: 'health_sample_outside_retention', statusCode: 422 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    await expectV1SleepAndMorningState(owner);
  });

  // An unreadable fence says nothing about the grant: the repair pass removes the aborted batch's
  // rows but neither runs the rule nor drops the journal, and the next pass that reads it decides.
  it('RA-8: an unreadable fence keeps the aborted journal, and the pass that reads it applies the rule', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await abortedAcrossDisconnect(owner);

    const fenceReads = failFenceReads();
    await expect(recoverStagedHealthSamples({ userId: owner._id }))
      .resolves.toEqual({ recovered: 0, removed: 1, failed: 1 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id, status: 'aborted' })).toBe(1);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(1);
    expect(await MorningState.countDocuments({ userId: owner._id })).toBe(1);

    fenceReads.mockRestore();
    await expect(recoverStagedHealthSamples({ userId: owner._id }))
      .resolves.toEqual({ recovered: 0, removed: 0, failed: 0 });
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    await expectNoAggregates(owner);
  });
});
