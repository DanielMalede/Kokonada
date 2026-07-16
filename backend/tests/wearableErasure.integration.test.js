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
const MedicalProfile = require('../app/models/MedicalProfile');
const { purgeWearableData } = require('../app/services/privacy/wearableErasure');

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
  await MedicalProfile.deleteMany({});
});

const log = (userId, source, hr = 60) =>
  BiometricLog.create({ userId, heartRate: hr, source, activity: 'resting', recordedAt: new Date() });

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
