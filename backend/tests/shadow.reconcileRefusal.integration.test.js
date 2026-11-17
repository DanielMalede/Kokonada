'use strict';

// The resilience audit of #256 (BE-144), RA-1 and RA-2, on real Mongo.
//
// RA-1: a write that commits after an erasure deleted the provider's samples and before it counted
// what remains is seen by that count, so MedicalProfile and MorningState survive the erasure. When a
// refusal then removes the write, the erasure's own rule (wearableErasure.purgeOrphanedAggregates)
// has to run again, or both aggregates outlive every sample behind them. The live lane does this
// already (sockets/biometricHandler.js, _compensateIfConsentLapsed). Each case first proves the race
// happened: the erasure reports that it kept both aggregates.
//
// RA-2: an after-fence that cannot read says nothing about the grant, so the reconcile keeps the
// pending authoritative rows for the next pass, as its start fence and both ingest fences do.

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

jest.setTimeout(120000);

// RA-9 (the second audit of #256): every date is relative to the run's clock. ingestV2Batch refuses
// a sample that ended more than 90 days before now, and the TTL index on `expiresAt` (and on
// MorningState's `date`) removes a row once that date has passed (shadow.sampleClock.test.js).
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RETENTION_MS = 90 * DAY;
const ago = (ms) => new Date(Date.now() - ms);
const yesterday = () => new Date(`${ago(DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'shadow_reconcile_refusal' });
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

// The two derived aggregates the orphan rule governs. `maxHeartRate` has no Apple provenance, so
// the disconnect's provenance clear leaves it in place: only the orphan rule removes this profile.
async function derivedAggregates(owner) {
  await MedicalProfile.create({
    userId: owner._id,
    healthProjectionProvider: 'apple_health',
    restingHeartRate: 57,
    maxHeartRate: 181,
  });
  await MorningState.create({
    userId: owner._id,
    date: yesterday(),
    readiness: 0.6,
  });
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

function heartRateUpsert() {
  const endAt = ago(2 * HOUR);
  return {
    sampleId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    operation: 'upsert',
    type: 'heart_rate',
    value: 72,
    unit: 'bpm',
    startDate: new Date(endAt.getTime() - MINUTE).toISOString(),
    endDate: endAt.toISOString(),
  };
}

// Holds `Model.create` before the insert; once the test commits it, signals the commit and holds
// the caller again until the test resumes it.
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

// The race RA-1 names. The erasure is held after it has deleted the provider's samples and before
// it counts what remains (clearOwnedHealthProjection's MedicalProfile.updateMany sits between the
// two), the held write commits in that gap, and the erasure then runs to the end. Resolves to the
// erasure's own report.
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
  // The erasure deleted the authoritative row, missed the projection in its own delete, and
  // counted it: both aggregates survived.
  await expect(eraseAroundWrite(owner, projection)).resolves.toMatchObject({
    healthSamples: 1,
    vitalSamples: 0,
    medicalProfiles: 0,
    morningStates: 0,
  });
  return { resume: projection.resume, outcome: run };
}

// An ingest whose staged row commits inside the disconnect's erasure; the batch is still held.
async function ingestAcrossDisconnect(owner) {
  const staged = holdCreate(HealthSample);
  const ingest = settle(ingestV2Batch(owner._id, 'healthkit', [heartRateUpsert()]));
  // The staged row did not exist at the erasure's delete, and its count saw it.
  await expect(eraseAroundWrite(owner, staged)).resolves.toMatchObject({
    healthSamples: 0,
    medicalProfiles: 0,
    morningStates: 0,
  });
  return { resume: staged.resume, outcome: ingest };
}

// The same batch, whose own cleanup fails twice, at its refusal and in its catch, so the staged
// row and the aborted journal are left for the repair pass.
async function abortedAcrossDisconnect(owner) {
  const { resume, outcome } = await ingestAcrossDisconnect(owner);
  const deleteMany = jest.spyOn(HealthSample, 'deleteMany')
    .mockRejectedValueOnce(new Error('temporary mongo failure'))
    .mockRejectedValueOnce(new Error('temporary mongo failure'));
  resume();
  expect(await outcome).toMatchObject({ message: 'temporary mongo failure' });
  deleteMany.mockRestore();
  expect(await HealthSample.countDocuments({ userId: owner._id, ingestState: 'staged' })).toBe(1);
  expect(await HealthIngestBatch.countDocuments({ userId: owner._id, status: 'aborted' })).toBe(1);
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

describe('v2 reconcile refusals (resilience audit of #256)', () => {
  it('RA-1: a disconnect inside a reconcile leaves no profile once the run has undone its projection', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await pendingRestingHr(owner, 'e');

    const run = await reconcileAcrossDisconnect(owner);
    run.resume();

    expect(await run.outcome).toEqual({
      resolved: { projected: 0, removed: 0, profileUpdated: false },
    });
    expect(await BiometricLog.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MorningState.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('RA-1: a failing orphan rule after a refusal answers the retryable 503', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await pendingRestingHr(owner, 'b');

    const run = await reconcileAcrossDisconnect(owner);
    jest.spyOn(MedicalProfile, 'deleteMany').mockRejectedValueOnce(primaryLost());
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    run.resume();

    expect(await run.outcome).toMatchObject({ code: 'health_projection_pending', statusCode: 503 });
    // One closed-token line, no user reference and no value: what an operator needs to look again.
    expect(errors.mock.calls.map((call) => call.join(' '))).toContain(
      '[healthProjection] orphan-rule reason=provider_not_current outcome=failed error=MongoServerSelectionError',
    );
    // The run's own writes are still undone, and its marker stays, so the repair worker re-applies
    // the rule (RA-6, the second audit of #256; shadow.orphanRuleDurability.integration.test.js).
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthProjectionCleanup.countDocuments({ userId: owner._id })).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('RA-2: an after-fence read error keeps the pending authoritative rows for the next pass', async () => {
    const owner = await appleUserWithGrant();
    const row = await pendingRestingHr(owner, 'f');
    const projection = holdCreate(VitalSample);

    const run = settle(reconcileHealthSamples(owner._id, 'apple_health'));
    await projection.entered;
    projection.commit();
    await projection.committed;
    const fenceReads = failFenceReads();
    projection.resume();

    const outcome = await run;
    // Fail closed on the run's own writes: its projection and the profile it created are undone.
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthSample.countDocuments({ userId: owner._id, projectionState: 'pending' })).toBe(1);
    // Retryable, so the batch and the repair worker come back; the run's marker is discharged.
    expect(outcome).toMatchObject({ code: 'health_projection_pending', statusCode: 503 });
    expect(await HealthProjectionCleanup.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();

    // The primary is back: the next pass projects the row it kept.
    fenceReads.mockRestore();
    await expect(reconcileHealthSamples(owner._id, 'apple_health')).resolves.toEqual({
      projected: 1,
      removed: 0,
      profileUpdated: true,
    });
    expect((await HealthSample.findById(row._id)).projectionState).toBe('applied');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  // The choice RA-2 leaves open, pinned: an unreadable after-fence still re-applies the orphan rule.
  // The rule deletes only when no sample of any provider remains, and the pending rows are kept on
  // that reason, so it removes nothing unless an erasure has already taken every sample.
  it('RA-1 with RA-2: a read error after a disconnect still drops the aggregates the erasure left', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await pendingRestingHr(owner, 'd');

    const run = await reconcileAcrossDisconnect(owner);
    failFenceReads();
    run.resume();

    const outcome = await run.outcome;
    expect(await VitalSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MorningState.countDocuments({ userId: owner._id })).toBe(0);
    expect(outcome).toMatchObject({ code: 'health_projection_pending', statusCode: 503 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('v2 ingest refusals (resilience audit of #256)', () => {
  it('RA-1: a disconnect inside an ingest leaves no profile once the refusal has removed the staged row', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);

    const ingest = await ingestAcrossDisconnect(owner);
    ingest.resume();

    expect(await ingest.outcome).toMatchObject({ code: 'wearable_connection_changed', statusCode: 409 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MorningState.countDocuments({ userId: owner._id })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('RA-1: a failing orphan rule after an ingest refusal answers the retryable 503', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);

    const ingest = await ingestAcrossDisconnect(owner);
    jest.spyOn(MedicalProfile, 'deleteMany').mockRejectedValueOnce(primaryLost());
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    ingest.resume();

    expect(await ingest.outcome).toMatchObject({ code: 'health_projection_pending', statusCode: 503 });
    // One closed-token line, as the reconcile's: no user reference and no value (RA-6).
    expect(errors.mock.calls.map((call) => call.join(' '))).toContain(
      '[healthIngest] orphan-rule reason=connection_changed outcome=failed error=MongoServerSelectionError',
    );
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
  });

  it('RA-1: the repair pass that removes a refused batch\'s staged row leaves no profile behind', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await abortedAcrossDisconnect(owner);

    await expect(recoverStagedHealthSamples({ userId: owner._id }))
      .resolves.toEqual({ recovered: 0, removed: 1, failed: 0 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MorningState.countDocuments({ userId: owner._id })).toBe(0);
  });

  it('RA-1: a failing orphan rule in the repair pass keeps the journal, and the next pass applies it', async () => {
    const owner = await appleUserWithGrant();
    await derivedAggregates(owner);
    await abortedAcrossDisconnect(owner);

    jest.spyOn(MedicalProfile, 'deleteMany').mockRejectedValueOnce(primaryLost());
    await expect(recoverStagedHealthSamples({ userId: owner._id }))
      .resolves.toEqual({ recovered: 0, removed: 1, failed: 1 });
    expect(await HealthSample.countDocuments({ userId: owner._id })).toBe(0);
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id, status: 'aborted' })).toBe(1);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(1);

    await expect(recoverStagedHealthSamples({ userId: owner._id }))
      .resolves.toEqual({ recovered: 0, removed: 0, failed: 0 });
    expect(await HealthIngestBatch.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: owner._id })).toBe(0);
    expect(await MorningState.countDocuments({ userId: owner._id })).toBe(0);
  });
});
