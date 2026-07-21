'use strict';

// D-4 (#90) CI guard: the REAL Mongoose 9 encrypted-number seam on a $set update.
//
// healthStore.test.js MOCKS MedicalProfile.findOneAndUpdate and only asserts that $set carries the
// RAW numbers — it CANNOT prove the security-load-bearing half: that Mongoose 9 actually runs the
// encryptedNumber setter on findOneAndUpdate($set) so special-category vitals land as CIPHERTEXT at
// rest, and that the getter decrypts them back on read. That seam is exactly what the #90 fix depends
// on (pre-encrypting double-encrypted → getter read NaN → Pulse showed "—"). This exercises it end to
// end against mongodb-memory-server + real AES-256-GCM.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV       = 'test';
// The state-vector recompute enqueue at the tail of persistMetrics is a graceful no-op without a
// Redis URL — make sure none is inherited so the test never reaches for a broker.
delete process.env.REDIS_URL;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const MedicalProfile          = require('../app/models/MedicalProfile');
const { persistMetrics }      = require('../app/services/wearable/metricStore');
const { toPulseStateDTO }     = require('../app/controllers/pulseController');
const { isCiphertextFormat }  = require('../app/utils/encryption');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_medprofile_enc_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await MedicalProfile.deleteMany({});
});

describe('MedicalProfile encryption round-trip (real Mongo, real crypto)', () => {
  // A distinct userId per run so the upsert always creates a fresh document.
  const userId = new mongoose.Types.ObjectId().toString();

  // Sleep record carries recordedAt = session END; a few hours ago buckets it into "last night".
  const lastNight = new Date(Date.now() - 8 * 60 * 60 * 1000);
  const metrics = [
    { metric: 'restingHeartRate', value: 55, unit: 'bpm', recordedAt: new Date(), source: 'apple_health' },
    { metric: 'hrv',              value: 46, unit: 'ms',  recordedAt: new Date(), source: 'apple_health' },
    { metric: 'sleepDeep',        value: 60, unit: 'min', recordedAt: lastNight,  source: 'health_connect' },
  ];

  it('F3 plaintext-at-rest: restingHeartRate, hrv, and the sleep-deep scalar are stored as CIPHERTEXT, never plaintext', async () => {
    await persistMetrics(userId, metrics);

    // Raw read (.lean bypasses the decrypting getters) → the actual bytes on disk.
    const raw = await MedicalProfile.findOne({ userId }).lean();
    expect(raw).toBeTruthy();

    // Special-category vitals: our AES-256-GCM ciphertext format, and provably NOT the plaintext value.
    expect(typeof raw.restingHeartRate).toBe('string');
    expect(isCiphertextFormat(raw.restingHeartRate)).toBe(true);
    expect(raw.restingHeartRate).not.toBe('55');
    expect(raw.restingHeartRate).not.toBe(55);

    expect(isCiphertextFormat(raw.hrv)).toBe(true);
    expect(raw.hrv).not.toBe('46');
    expect(raw.hrv).not.toBe(46);

    // Both sleep-deep scalars the pipeline writes are encrypted at rest: the median baseline
    // (sleepStages.deep) AND the last-night total (lastNightSleep.deep) — the one the DTO reads back.
    expect(isCiphertextFormat(raw.sleepStages.deep)).toBe(true);
    expect(raw.sleepStages.deep).not.toBe('60');
    expect(isCiphertextFormat(raw.lastNightSleep.deep)).toBe(true);
    expect(raw.lastNightSleep.deep).not.toBe('60');
    expect(raw.lastNightSleep.deep).not.toBe(60);
  });

  it('read-back through the getter + DTO decrypts the vitals (the "—" symptom guard): rHR=55, hrv=46, deep=60', async () => {
    await persistMetrics(userId, metrics);

    // Non-lean load → the encryptedNumber getters decrypt on access, exactly as the Pulse controller does.
    const doc = await MedicalProfile.findOne({ userId });
    expect(doc).toBeTruthy();
    const dto = toPulseStateDTO(doc);

    expect(dto.vitals.restingHeartRate).toBe(55);
    expect(dto.vitals.hrv).toBe(46);
    expect(dto.sleep.lastNight.deep).toBe(60);
  });
});
