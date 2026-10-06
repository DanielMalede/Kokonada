'use strict';

// A6 — daily analysis, WIRING half (W4-012). REAL-Mongo integration test (mongodb-memory-server):
// the worker's decrypt boundary, eligibility, idempotent upsert, sleep-night continuity, and the
// zero-knowledge job summary. The pure math (CUSUM/readiness) is covered by dailyAnalysis.test.js;
// this file proves the WIRING moves real data through it correctly.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { connectRedis, getRedis } = require('../app/config/redis');

const DB = 'kokonada_wave4_dailyanalysis_worker';
let mem;
beforeAll(async () => {
  // Test commands on: J2's S1 test makes the users read fail on the server (a `failCommand` fail point).
  mem = await MongoMemoryServer.create({ instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
  await mongoose.connect(mem.getUri(), { dbName: DB });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const MedicalProfile = require('../app/models/MedicalProfile');
const VitalSample = require('../app/models/VitalSample');
const MorningState = require('../app/models/MorningState');
const User = require('../app/models/User');
const { process: runDailyAnalysis } = require('../app/workers/dailyAnalysis.worker');
const { localDayIndex } = require('../app/agents/runtime/physiology/baselineEngine');
const baselinesService = require('../app/services/biosonic/baselines');

beforeEach(async () => {
  await Promise.all([
    MedicalProfile.deleteMany({}), VitalSample.deleteMany({}), MorningState.deleteMany({}), User.deleteMany({}),
  ]);
});

const uid = () => new mongoose.Types.ObjectId();
const DAY = 86400000;

// J2 (BE-094, S1; fixture F3): the job processes a profile only while its account exists, so every user
// these tests mean to be processed has a User doc, as every real user does.
const account = (userId) => User.create({ _id: userId, ssoProvider: 'google', ssoId: `sso-${userId}`, email: `${userId}@example.com` });

// Seed N days of plausible restingHeartRate + hrv VitalSample rows ending "yesterday" relative
// to `now`, plus a MedicalProfile whose lastNightSleep buckets to yesterday.
async function seedUser(userId, now, { days = 20, rhr = 60, hrv = 55, tzOffsetMinutes = 0 } = {}) {
  await account(userId);
  const rows = [];
  for (let d = days; d >= 1; d--) {
    const at = new Date(now - d * DAY);
    rows.push({ userId, metric: 'restingHeartRate', value: rhr + (d % 2), recordedAt: at, source: 'garmin', tzOffsetMinutes });
    rows.push({ userId, metric: 'hrv', value: hrv + (d % 3), recordedAt: at, source: 'garmin', tzOffsetMinutes });
  }
  await VitalSample.insertMany(rows);
  await MedicalProfile.create({
    userId,
    lastNightSleep: { deep: 90, light: 300, rem: 90, date: new Date(now - 1 * DAY) },
  });
}

describe('dailyAnalysis.worker — wiring', () => {
  it('only consolidates users who have a MedicalProfile (the eligible population)', async () => {
    const withProfile = uid();
    const without = uid();
    const now = Date.now();
    await seedUser(withProfile, now);
    // `without` has VitalSample rows but no MedicalProfile — must be skipped.
    await VitalSample.create({ userId: without, metric: 'hrv', value: 50, recordedAt: new Date(now - DAY), source: 'garmin' });

    const summary = await runDailyAnalysis({ data: {} });

    expect(summary.eligible).toBe(1);
    expect(summary.processed).toBe(1);
    expect(await MorningState.countDocuments({ userId: withProfile })).toBe(1);
    expect(await MorningState.countDocuments({ userId: without })).toBe(0);
  });

  it('writes a well-formed MorningState row for today\'s local day, decrypted correctly', async () => {
    const userId = uid();
    const now = Date.now();
    await seedUser(userId, now);

    await runDailyAnalysis({ data: {} });

    const dayIndex = localDayIndex(now, 0);
    const row = await MorningState.findOne({ userId, date: new Date(dayIndex * DAY) });
    expect(row).toBeTruthy();
    expect(Number(row.readiness)).toBeGreaterThanOrEqual(0);
    expect(Number(row.readiness)).toBeLessThanOrEqual(1);
    expect(row.sleepDebt.nights).toBeGreaterThanOrEqual(1);
    expect(Number(row.night.deep)).toBe(90);
    expect(row.cusum.rhr.flagged).toBe(false); // stationary seed data
  });

  it('is idempotent: re-running the same night upserts the SAME row, not a duplicate', async () => {
    const userId = uid();
    const now = Date.now();
    await seedUser(userId, now);

    await runDailyAnalysis({ data: {} });
    await runDailyAnalysis({ data: {} });

    expect(await MorningState.countDocuments({ userId })).toBe(1);
  });

  it('carries sleep-debt continuity across nights via its OWN persisted history', async () => {
    const userId = uid();
    const day0 = Date.now();
    await seedUser(userId, day0, { days: 5 });

    await runDailyAnalysis({ data: { now: day0 } });
    const first = await MorningState.findOne({ userId }).sort({ date: -1 });
    expect(first.sleepDebt.nights).toBe(1); // only today's lastNightSleep counted so far

    // Advance one day: a new lastNightSleep bucket, the OLD row becomes "prior night" history
    // that `_priorNights` reads back — the continuity mechanism this test exists to prove.
    // Injected via job.data.now (not a faked global clock, which would also stall the Mongo
    // driver's own keepalive timers).
    const day1 = day0 + DAY;
    await MedicalProfile.updateOne(
      { userId },
      { $set: { lastNightSleep: { deep: 80, light: 280, rem: 80, date: new Date(day1 - DAY) } } },
    );
    await runDailyAnalysis({ data: { now: day1 } });

    const second = await MorningState.findOne({ userId }).sort({ date: -1 });
    expect(second.sleepDebt.nights).toBe(2); // yesterday's row's `night` + today's
  });

  it('does not fail the whole batch when one user\'s consolidation throws', async () => {
    const good = uid();
    const bad = uid();
    const now = Date.now();
    await seedUser(good, now);
    await account(bad);
    await MedicalProfile.create({ userId: bad });

    const real = baselinesService.computeBaselines.bind(baselinesService);
    const spy = jest.spyOn(baselinesService, 'computeBaselines').mockImplementation((userId) => {
      if (String(userId) === String(bad)) throw new Error('boom');
      return real(userId);
    });

    try {
      const summary = await runDailyAnalysis({ data: {} });

      expect(summary.eligible).toBe(2);
      expect(summary.processed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(await MorningState.countDocuments({ userId: good })).toBe(1);
      expect(await MorningState.countDocuments({ userId: bad })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('the job summary carries zero vitals — bookkeeping only (§0.2.2)', async () => {
    const userId = uid();
    const now = Date.now();
    await seedUser(userId, now);

    const summary = await runDailyAnalysis({ data: {} });
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/readiness/);
    expect(json).not.toMatch(/rhr|hrv|cusum|cosinor/i);
    expect(Object.keys(summary).sort()).toEqual(['eligible', 'failed', 'flagged', 'processed']);
  });
});

// J2 (BE-094; Plan B T8, DT-11 S1). A MedicalProfile whose account is gone is a deleted account's
// leftover: a recompute or a health-data sync that wrote it after the deletion. The nightly job picked it
// up like any other profile, so every night it re-wrote the `bio:baseline:` key of the deleted ID, added a
// MorningState row for it and logged a [biometric-access] line naming it, for good. It now skips such a
// profile, whose removal is the daily sweep's job, not this one's.
describe('S1: a profile whose account is gone is skipped (BE-094)', () => {
  /** A deleted account's leftovers: everything seedUser writes, then the User doc is gone. */
  async function seedLeftover(userId, now) {
    await seedUser(userId, now);
    await User.deleteOne({ _id: userId });
  }
  async function failUsersRead() {
    await mongoose.connection.db.admin().command({
      configureFailPoint: 'failCommand',
      mode: 'alwaysOn',
      data: { failCommands: ['find'], errorCode: 2, namespace: `${DB}.users` },
    });
  }
  const failPointOff = () => mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });

  it('gets no MorningState, no baseline write and no [biometric-access] line; a real user is processed as before', async () => {
    const real = uid();
    const gone = uid();
    const now = Date.now();
    await seedUser(real, now);
    await seedLeftover(gone, now);
    const cached = [];
    const cache = baselinesService.cacheBaselines.bind(baselinesService);
    const cacheSpy = jest.spyOn(baselinesService, 'cacheBaselines').mockImplementation((id, stats) => {
      cached.push(String(id));
      return cache(id, stats);
    });
    const lines = [];
    const logSpy = jest.spyOn(console, 'info').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });

    let summary;
    try {
      summary = await runDailyAnalysis({ data: {} });
    } finally {
      cacheSpy.mockRestore();
      logSpy.mockRestore();
    }

    expect(summary).toEqual(expect.objectContaining({ eligible: 1, processed: 1, failed: 0 }));
    expect(await MorningState.countDocuments({ userId: gone })).toBe(0);
    expect(await MorningState.countDocuments({ userId: real })).toBe(1);
    expect(cached).toEqual([String(real)]);
    // Not vacuous: the real user's lines are there (its baseline read and the analysis' own).
    expect(lines.filter((l) => l.startsWith(`[biometric-access] user=${real} purpose=daily-analysis `))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain(String(gone));
    expect(await MedicalProfile.countDocuments({ userId: gone })).toBe(1); // left for the sweep, never deleted here
  });

  it('a users read that fails fails the run with no ID or driver text, and processes nobody (fails closed)', async () => {
    const real = uid();
    const now = Date.now();
    await seedUser(real, now);
    await failUsersRead();

    let rejection;
    try {
      rejection = await runDailyAnalysis({ data: {} }).then(() => null, (e) => e);
    } finally {
      await failPointOff();
    }

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection.message).toBe('[dailyAnalysis] account read failed (MongoServerError)');
    expect(await MorningState.countDocuments({})).toBe(0);
  });
});

describeRealRedis('S1 on a real Redis: a deleted account\'s bio:baseline: key is never written (BE-094)', (url) => {
  let redis;

  beforeAll(async () => {
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url; // the app's own client (config/redis.connectRedis) writes the baseline cache here
    await connectRedis();
  });
  beforeEach(() => flushTestDb(redis));
  afterAll(() => {
    getRedis()?.disconnect();
    redis?.disconnect();
    delete process.env.REDIS_URL;
  });

  it('the real user\'s key is written and the deleted account\'s is not', async () => {
    const real = uid();
    const gone = uid();
    const now = Date.now();
    await seedUser(real, now);
    await seedUser(gone, now);
    await User.deleteOne({ _id: gone });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); // 'Redis connected'

    try {
      await runDailyAnalysis({ data: {} });
    } finally {
      logSpy.mockRestore();
    }

    expect(await redis.exists(`bio:baseline:${real}`)).toBe(1);
    expect(await redis.exists(`bio:baseline:${gone}`)).toBe(0);
  });
});
