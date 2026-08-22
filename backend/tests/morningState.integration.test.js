'use strict';

// REAL-Mongo integration test (mongodb-memory-server) for MorningState (W4-012).
//
// Risk register R9: "every new encrypted field ships a round-trip test". Follows the
// vitalSample.integration.test.js precedent — assertions go through the DRIVER as well as the
// model, because a getter-only test cannot distinguish "encrypted at rest" from "not encrypted
// at all".
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const MorningState = require('../app/models/MorningState');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_morningstate' });
  // Mongoose builds indexes ASYNCHRONOUSLY after connect, so without this the
  // "one row per user per local day" case races the build of its own unique index: under full-suite
  // load the second create() can land first and succeed, and the test fails claiming the constraint
  // is missing when it is merely late. Observed as a real red in the session-55 full run, green in
  // isolation. `syncIndexes()` (rather than `init()`) matches the neighbouring
  // rewardEvent.integration.test.js, which already got this right.
  await MorningState.syncIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => { await MorningState.deleteMany({}); });

const uid = () => new mongoose.Types.ObjectId();
const raw = () => mongoose.connection.db.collection('morningstates');

const sample = (userId, overrides = {}) => ({
  userId,
  date: new Date('2026-08-01T00:00:00Z'),
  readiness: 0.72,
  readinessConfidence: 0.6,
  sleepDebt: { debt: 45, ratio: 0.2, need: 500, ceiling: 1000, nights: 12, confidence: 0.7 },
  night: { deep: 90, light: 300, rem: 90 },
  cosinor: { M: 62, A: 5.2, phi: 16.3, confidence: 0.8, source: 'fit' },
  cusum: {
    rhr: { cPlus: 1.2, cMinus: 0, flagged: false, direction: null, referenceDays: 30 },
    hrv: { cPlus: 0, cMinus: 2.1, flagged: false, direction: null, referenceDays: 30 },
  },
  ...overrides,
});

describe('MorningState — encryption at rest (audit F3, R9)', () => {
  it('stores ciphertext for every physiological-magnitude field and decrypts through the getters', async () => {
    const userId = uid();
    await MorningState.create(sample(userId));

    const stored = await raw().findOne({ userId });
    // Driver-level: the physiological magnitudes must NOT sit on disk as plaintext.
    for (const v of [stored.readiness, stored.sleepDebt.debt, stored.sleepDebt.ratio, stored.night.deep, stored.cosinor.M, stored.cusum.rhr.cPlus, stored.cusum.hrv.cMinus]) {
      expect(typeof v).toBe('string');
      expect(Number.isNaN(Number(v))).toBe(true);
    }
    // Category/confidence fields stay plain, mirroring MedicalProfile.stateVector's convention.
    expect(typeof stored.readinessConfidence).toBe('number');
    expect(typeof stored.cusum.rhr.flagged).toBe('boolean');

    const doc = await MorningState.findOne({ userId });
    expect(Number(doc.readiness)).toBe(0.72);
    expect(Number(doc.sleepDebt.debt)).toBe(45);
    expect(Number(doc.night.deep)).toBe(90);
    expect(Number(doc.cosinor.M)).toBe(62);
    expect(Number(doc.cusum.rhr.cPlus)).toBe(1.2);
    expect(Number(doc.cusum.hrv.cMinus)).toBe(2.1);
    expect(doc.readinessConfidence).toBe(0.6);
    expect(doc.cusum.rhr.flagged).toBe(false);
  });

  it('binds the ciphertext to its owner (AAD): a row lifted to another user reads null + alarms', async () => {
    const owner = uid();
    const attacker = uid();
    await MorningState.create(sample(owner));

    const lifted = (await raw().findOne({ userId: owner })).readiness;
    await raw().insertOne({
      userId: attacker, date: new Date(), readiness: lifted, v: 1,
    });

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stolen = await MorningState.findOne({ userId: attacker });
    expect(stolen.readiness).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[crypto-alarm]'));
    spy.mockRestore();
  });

  it('enforces one row per user per local day', async () => {
    const userId = uid();
    await MorningState.create(sample(userId));
    await expect(MorningState.create(sample(userId))).rejects.toThrow();
  });

  it('upserts idempotently via findOneAndUpdate, and the setter still encrypts raw values passed through $set', async () => {
    const userId = uid();
    const date = new Date('2026-08-02T00:00:00Z');
    await MorningState.findOneAndUpdate(
      { userId, date },
      { $set: { readiness: 0.4, readinessConfidence: 0.5, 'sleepDebt.ratio': 0.3 } },
      { upsert: true, new: true },
    );
    const stored = await raw().findOne({ userId, date });
    expect(typeof stored.readiness).toBe('string');
    expect(Number.isNaN(Number(stored.readiness))).toBe(true);

    // Re-run: must update the SAME row, not create a second one.
    await MorningState.findOneAndUpdate(
      { userId, date },
      { $set: { readiness: 0.9 } },
      { upsert: true, new: true },
    );
    expect(await MorningState.countDocuments({ userId, date })).toBe(1);
    const doc = await MorningState.findOne({ userId, date });
    expect(Number(doc.readiness)).toBe(0.9);
  });

  // Regression guard for a real bug this task's own tests caught: the schema originally named
  // the field `sleepDebt.value`, but `chronobiology.sleepDebt()` returns `debt` — and the worker
  // passes that object straight to `$set` with no translation layer, so the mismatch would have
  // silently dropped every persisted debt value (Mongoose strict mode drops unknown keys rather
  // than erroring). Pinned against the REAL engine output, not a hand-copied shape.
  it('the sleepDebt sub-schema keys match chronobiology.sleepDebt()\'s real output shape', async () => {
    const { sleepDebt } = require('../app/agents/runtime/physiology/chronobiology');
    const engineKeys = Object.keys(sleepDebt([{ deep: 90, light: 300, rem: 90 }])).sort();
    const schemaKeys = Object.keys(MorningState.schema.paths)
      .filter((p) => p.startsWith('sleepDebt.'))
      .map((p) => p.slice('sleepDebt.'.length))
      .filter((k) => k !== '_id')
      .sort();
    expect(schemaKeys).toEqual(engineKeys);
  });
});
