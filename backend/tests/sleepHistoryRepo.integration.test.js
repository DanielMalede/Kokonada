'use strict';

// W4-D68 — REAL-Mongo integration test for the one reader of a listener's night history.
//
// WHY THIS IS AN INTEGRATION TEST AND NOT A MOCK. Everything this reader is responsible for is a
// property of the QUERY, not of the JavaScript around it: that `.sort({date:-1}).limit(n)` takes
// the NEWEST n rows and the `.reverse()` hands them back OLDEST-FIRST (§M.6's accumulator consumes
// nights in order, so a reversed history is a silently wrong debt, not a crash); that `$lt` is
// strict, which is the whole reason the nightly lane can append today's night itself without
// double-counting it; and that an encrypted `night` sub-document survives the round trip through
// the model's getters. A mocked `find()` chain asserts that this file calls the methods it calls.
//
// Follows the `morningState.integration.test.js` harness exactly, including `syncIndexes()` — the
// reader sorts on `{userId, date}` and a test that races the index build tests a collection scan.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const MorningState = require('../app/models/MorningState');
const { readNightHistory, HISTORY_NIGHTS } = require('../app/repositories/sleepHistoryRepo');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_sleephistory' });
  await MorningState.syncIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => { await MorningState.deleteMany({}); });

const uid = () => new mongoose.Types.ObjectId();
const day = (n) => new Date(Date.UTC(2026, 7, n, 0, 0, 0));

/** One MorningState row whose night is identifiable by its `deep` minutes. */
const seedNight = (userId, n, deep) => MorningState.create({
  userId,
  date: day(n),
  night: { deep, light: 300, rem: 90 },
});

describe('sleepHistoryRepo.readNightHistory', () => {
  it('returns the nights OLDEST-FIRST, which is the order §M.6 consumes them in', async () => {
    const userId = uid();
    await seedNight(userId, 1, 10);
    await seedNight(userId, 2, 20);
    await seedNight(userId, 3, 30);

    const history = await readNightHistory(userId);

    expect(history.map((n) => n.deep)).toEqual([10, 20, 30]);
  });

  it('keeps the NEWEST `limit` nights, not the first `limit` it happens to read', async () => {
    const userId = uid();
    for (let d = 1; d <= 6; d++) await seedNight(userId, d, d * 10);

    const history = await readNightHistory(userId, { limit: 3 });

    // newest three are days 4,5,6 — and they still come back oldest-first
    expect(history.map((n) => n.deep)).toEqual([40, 50, 60]);
  });

  it('excludes the `before` date STRICTLY, so the nightly lane can append that night itself', async () => {
    const userId = uid();
    await seedNight(userId, 1, 10);
    await seedNight(userId, 2, 20);
    await seedNight(userId, 3, 30);

    const history = await readNightHistory(userId, { before: day(3) });

    expect(history.map((n) => n.deep)).toEqual([10, 20]);
  });

  it('never returns another listener\'s nights', async () => {
    const mine = uid();
    const theirs = uid();
    await seedNight(mine, 1, 11);
    await seedNight(theirs, 1, 99);
    await seedNight(theirs, 2, 98);

    const history = await readNightHistory(mine);

    expect(history.map((n) => n.deep)).toEqual([11]);
  });

  it('drops rows with no night at all rather than passing nulls to the accumulator', async () => {
    const userId = uid();
    await seedNight(userId, 1, 10);
    await MorningState.create({ userId, date: day(2), readiness: 0.5 }); // consolidated, no sleep
    await seedNight(userId, 3, 30);

    const history = await readNightHistory(userId);

    expect(history).toEqual([
      { deep: 10, light: 300, rem: 90 },
      { deep: 30, light: 300, rem: 90 },
    ]);
  });

  it('round-trips the ENCRYPTED stage minutes — the reader hands back plaintext', async () => {
    const userId = uid();
    await seedNight(userId, 1, 123);

    const stored = await mongoose.connection.db.collection('morningstates').findOne({ userId });
    expect(typeof stored.night.deep).toBe('string');       // ciphertext at rest
    expect(stored.night.deep).not.toContain('123');

    const history = await readNightHistory(userId);
    expect(history[0]).toEqual({ deep: 123, light: 300, rem: 90 }); // plaintext to the engine
  });

  it('keeps `userId` in the projection, so an ordinary read never fires a crypto alarm', async () => {
    // The AAD for every `encryptedNumber` comes from the OWNER document's `userId`. A projection
    // of `night` alone strips it, and for an AAD-BOUND row the getter then fails authentication
    // and reads null — after logging `[crypto-alarm] ... owner=unknown` per field.
    //
    // These rows are seeded with `.create()`, which is precisely the bound case. Production writes
    // this collection with `findOneAndUpdate($set)`, whose setter has no document context and
    // therefore encrypts UNBOUND, which is why the narrow projection the repository replaced has
    // never actually failed in production. This test exists to keep it that way for the first
    // caller that writes a night through a document. The pin is on the SYMPTOM as well as the
    // value: a routine read must be silent.
    const userId = uid();
    await seedNight(userId, 1, 77);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const history = await readNightHistory(userId);

    const alarms = spy.mock.calls.filter((c) => String(c[0]).includes('crypto-alarm'));
    spy.mockRestore();
    expect(alarms).toEqual([]);
    expect(history[0].deep).toBe(77);
  });

  it('returns [] for a listener with no consolidated nights — mass 0, not a throw', async () => {
    await expect(readNightHistory(uid())).resolves.toEqual([]);
  });

  it('returns [] for a missing userId rather than reading every row in the collection', async () => {
    const userId = uid();
    await seedNight(userId, 1, 10);

    await expect(readNightHistory(null)).resolves.toEqual([]);
    await expect(readNightHistory(undefined)).resolves.toEqual([]);
  });

  it('clamps a nonsense limit instead of trusting it — an unbounded read is a caller bug', async () => {
    const userId = uid();
    for (let d = 1; d <= 4; d++) await seedNight(userId, d, d);

    await expect(readNightHistory(userId, { limit: 0 })).resolves.toHaveLength(4);
    await expect(readNightHistory(userId, { limit: -3 })).resolves.toHaveLength(4);
    await expect(readNightHistory(userId, { limit: 1e6 })).resolves.toHaveLength(4);
    expect(HISTORY_NIGHTS).toBeGreaterThan(0);
  });
});
