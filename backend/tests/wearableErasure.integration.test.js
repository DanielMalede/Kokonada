'use strict';

// REAL-Mongo integration test (mongodb-memory-server) for per-provider wearable erasure (M3).
// The unit test asserts toHaveBeenCalledWith on mocked models — this proves the source-scoping
// and MedicalProfile-retention actually hold against real query semantics: erasing one provider
// removes EXACTLY that provider's samples and NOTHING belonging to another provider or user.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: () => null })); // no real Redis; purge no-ops the blob

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog   = require('../app/models/BiometricLog');
const VitalSample    = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const MorningState   = require('../app/models/MorningState');
const { RewardEvent }     = require('../app/models/RewardEvent');
const { PersonalWeights } = require('../app/models/PersonalWeights');
const { purgeWearableData, eraseWearableProvider } = require('../app/services/privacy/wearableErasure');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave3_erasure_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await BiometricLog.deleteMany({});
  await VitalSample.deleteMany({});
  await MedicalProfile.deleteMany({});
  await MorningState.deleteMany({});
  await RewardEvent.deleteMany({});
  await PersonalWeights.deleteMany({});
});

const log = (userId, source, hr = 60) =>
  BiometricLog.create({ userId, heartRate: hr, source, activity: 'resting', recordedAt: new Date() });

const vital = (userId, source, metric = 'hrv', value = 60) =>
  VitalSample.create({ userId, metric, value, source, recordedAt: new Date() });

describe('purgeWearableData (real Mongo)', () => {
  it('deletes EXACTLY the provider\'s samples — other providers and other users untouched', async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await log(userA, 'garmin'); await log(userA, 'garmin'); await log(userA, 'garmin');
    await log(userA, 'apple_health'); await log(userA, 'apple_health');
    await log(userB, 'garmin'); await log(userB, 'garmin'); // different user — must survive
    await MedicalProfile.create({ userId: userA, restingHeartRate: 58 });

    const res = await purgeWearableData(userA, 'garmin');

    expect(res.biometricLogs).toBe(3);
    expect(await BiometricLog.countDocuments({ userId: userA, source: 'garmin' })).toBe(0);       // gone
    expect(await BiometricLog.countDocuments({ userId: userA, source: 'apple_health' })).toBe(2); // kept
    expect(await BiometricLog.countDocuments({ userId: userB, source: 'garmin' })).toBe(2);       // other user kept
    // Apple Health samples remain → the aggregated profile is NOT solely garmin-derived → kept.
    expect(res.medicalProfiles).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: userA })).toBe(1);
  });

  it('drops the aggregated MedicalProfile only when the purge leaves no samples behind', async () => {
    const userC = new mongoose.Types.ObjectId();
    await log(userC, 'garmin'); await log(userC, 'garmin');
    await MedicalProfile.create({ userId: userC, restingHeartRate: 55 });

    const res = await purgeWearableData(userC, 'garmin');

    expect(res.biometricLogs).toBe(2);
    expect(res.medicalProfiles).toBe(1);
    expect(await BiometricLog.countDocuments({ userId: userC })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: userC })).toBe(0); // orphaned → erased
  });
});

// W4-004 / S5. The unit test above this one asserts against a MOCKED VitalSample, and W4-D08 is
// the standing proof that a mocked model can keep a dead lane looking alive for two sessions.
// These run the REAL collection against real query semantics.
describe('purgeWearableData — VitalSample source scoping (real Mongo)', () => {
  it("deletes EXACTLY the provider's vitals — other providers and other users untouched", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await vital(userA, 'garmin', 'hrv', 61);
    await vital(userA, 'garmin', 'restingHeartRate', 52);
    await vital(userA, 'apple_health', 'hrv', 58);
    await vital(userB, 'garmin', 'hrv', 44);
    await log(userA, 'apple_health'); // keeps the profile alive

    const res = await purgeWearableData(userA, 'garmin');

    expect(res.vitalSamples).toBe(2);
    expect(await VitalSample.countDocuments({ userId: userA, source: 'garmin' })).toBe(0);
    expect(await VitalSample.countDocuments({ userId: userA, source: 'apple_health' })).toBe(1);
    expect(await VitalSample.countDocuments({ userId: userB })).toBe(1);
  });

  it("KEEPS the MedicalProfile when the user has no HR rows left but another provider's vitals remain", async () => {
    const userD = new mongoose.Types.ObjectId();
    await log(userD, 'garmin');                       // the only HR rows are garmin's...
    await vital(userD, 'apple_health', 'hrv', 55);    // ...but Apple Health still reports vitals
    await MedicalProfile.create({ userId: userD, restingHeartRate: 60 });

    const res = await purgeWearableData(userD, 'garmin');

    expect(await BiometricLog.countDocuments({ userId: userD })).toBe(0);
    expect(res.medicalProfiles).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: userD })).toBe(1); // NOT orphaned
  });

  it('still drops the profile when the purge leaves neither HR rows nor vitals', async () => {
    const userE = new mongoose.Types.ObjectId();
    await log(userE, 'garmin');
    await vital(userE, 'garmin', 'hrv', 50);
    await MedicalProfile.create({ userId: userE, restingHeartRate: 60 });

    const res = await purgeWearableData(userE, 'garmin');

    expect(res.medicalProfiles).toBe(1);
    expect(await MedicalProfile.countDocuments({ userId: userE })).toBe(0);
  });
});

// W4-012 / S5. MorningState is the same category of derived aggregate as MedicalProfile (a
// nightly consolidation with no per-source attribution of its own), so it rides the identical
// all-or-nothing rule — pinned here rather than assumed from MedicalProfile's coverage above.
describe('purgeWearableData — MorningState (real Mongo)', () => {
  it('KEEPS MorningState when another provider still reports vitals', async () => {
    const userF = new mongoose.Types.ObjectId();
    await log(userF, 'garmin');
    await vital(userF, 'apple_health', 'hrv', 55);
    await MorningState.create({ userId: userF, date: new Date('2026-08-01T00:00:00Z'), readiness: 0.6 });

    const res = await purgeWearableData(userF, 'garmin');

    expect(res.morningStates).toBe(0);
    expect(await MorningState.countDocuments({ userId: userF })).toBe(1);
  });

  it('drops MorningState when the purge leaves neither HR rows nor vitals', async () => {
    const userG = new mongoose.Types.ObjectId();
    await log(userG, 'garmin');
    await vital(userG, 'garmin', 'hrv', 50);
    await MorningState.create({ userId: userG, date: new Date('2026-08-01T00:00:00Z'), readiness: 0.6 });
    await MorningState.create({ userId: userG, date: new Date('2026-08-02T00:00:00Z'), readiness: 0.4 });

    const res = await purgeWearableData(userG, 'garmin');

    expect(res.morningStates).toBe(2);
    expect(await MorningState.countDocuments({ userId: userG })).toBe(0);
  });
});

// BE-015 / ADR-0015 — the same boundary as the unit suite's closing guard, against REAL query
// semantics. Withdrawing Art.9 consent erases the learned personalization (that promise is kept
// by learningErasure.js, proven in consentWithdrawalErasure.integration.test.js). Unpairing ONE
// WATCH must not: purgeWearableData is reached by the live "Disconnect Garmin" button and by
// DELETE /integrations/wearable/:provider, neither of which ever promised a taste profile would
// be destroyed. The unit guard asserts on mocks the module does not import; this one asserts the
// ROWS are still there afterwards, which is the claim that actually matters to a listener.
describe('purgeWearableData — the learned personalization SURVIVES a disconnect (real Mongo)', () => {
  const seedLearned = async (userId) => {
    await RewardEvent.create({
      userId, bucket: { stateDomain: 'movement', targetBand: 'peak', hourBin: 0 },
      rewardSum: 3.2, count: 9, updatedAt: new Date(),
    });
    await PersonalWeights.create({
      userId, deltas: { taste: 0.31, feature: -0.12, genre: 0.04, rotation: 0 },
      updates: 40, updatedAt: new Date(),
    });
  };

  it('keeps RewardEvent + PersonalWeights when the LAST provider is purged (nothing left to derive from)', async () => {
    // The hardest case on purpose: this purge leaves the user with no samples at all, so it is
    // the branch that drops MedicalProfile/MorningState. The learned rows still must not follow.
    const userH = new mongoose.Types.ObjectId();
    await log(userH, 'garmin');
    await vital(userH, 'garmin', 'hrv', 48);
    await MedicalProfile.create({ userId: userH, restingHeartRate: 59 });
    await seedLearned(userH);

    const res = await purgeWearableData(userH, 'garmin');

    expect(res.medicalProfiles).toBe(1);                                          // derived data went
    expect(await BiometricLog.countDocuments({ userId: userH })).toBe(0);
    expect(await RewardEvent.countDocuments({ userId: userH })).toBe(1);          // taste stayed
    expect(await PersonalWeights.countDocuments({ userId: userH })).toBe(1);
  });

  it('the LIVE disconnect path (eraseWearableProvider) keeps them too', async () => {
    const userI = new mongoose.Types.ObjectId();
    // A plain object stands in for the User doc — this suite has no User rows, and the credential
    // clearing is already covered by the unit suite; what is under test is the DATA footprint.
    const user = { _id: userI, wearableProvider: 'garmin', wearableToken: null, save: async () => {} };
    await log(userI, 'garmin');
    await seedLearned(userI);

    await eraseWearableProvider(user, 'garmin');

    expect(await BiometricLog.countDocuments({ userId: userI })).toBe(0);         // its own job done
    expect(await RewardEvent.countDocuments({ userId: userI })).toBe(1);
    expect(await PersonalWeights.countDocuments({ userId: userI })).toBe(1);
  });
});
