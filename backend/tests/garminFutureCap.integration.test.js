'use strict';

// BE-206 (security-auditor SEC-273-2, architect R3 and R5): the Garmin lane stores nothing stamped more
// than MAX_FUTURE_SKEW_MS past the server's clock.
//
// The Health Connect batch contract and the personal-lane envelope each refused a future stamp, with a
// five-minute allowance defined twice; the Garmin webhook lane had no cap at all. A far-future night then
// held MedicalProfile.lastNightSleep for good (the night-date guard keeps the LATEST night, so no real
// night could replace it), and its rows outlived their TTL, which counts from recordedAt. The seam now has
// the store drop those metrics before any write and count them in `droppedInFuture`. The allowance is
// defined once, in adapter.js; the contract, the envelope and the store import it.
//
// Real semantics: the REAL consent read, normaliser and stores on a REAL Mongo (mongodb-memory-server);
// the clock is injected (`now`) only where a case needs an exact boundary. Redis is absent, so the
// recompute enqueue at the tail of persistMetrics is a no-op.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;

const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const { MAX_FUTURE_SKEW_MS } = require('../app/services/wearable/adapter');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_future_cap' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const nowSec = () => Math.floor(Date.now() / 1000);
const utcDate = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

async function consentedUser() {
  const userId = new mongoose.Types.ObjectId();
  await ConsentRecord.create({
    userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date(),
  });
  return userId;
}

// A day's summary: a resting heart rate (VitalSample, and its median on MedicalProfile) and two
// heart-rate readings a minute apart (BiometricLog). Three metrics.
const daily = (start) => ({
  type: 'dailies',
  summary: { startTimeInSeconds: start, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61, 60: 62 } },
});
// An eight-hour night, and its HRV, stamped where they end.
const night = (start, deepSeconds) => ({
  type: 'sleeps',
  summary: { startTimeInSeconds: start, durationInSeconds: 8 * HOUR, deepSleepDurationInSeconds: deepSeconds, lightSleepDurationInSeconds: 14400, remSleepInSeconds: 5400 },
});
const nightHrv = (start) => ({ type: 'hrv', summary: { startTimeInSeconds: start, durationInSeconds: 8 * HOUR, lastNightAvg: 48 } });

const stored = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId }),
  vitals: await VitalSample.countDocuments({ userId }),
  profile: await MedicalProfile.countDocuments({ userId }),
});

describe('the Garmin seam drops what is stamped past the clock (BE-206)', () => {
  it('a summary an hour ahead writes no row, and its three metrics are counted in droppedInFuture', async () => {
    const userId = await consentedUser();

    const res = await ingestSummaries(userId, [daily(nowSec() + HOUR)]);

    expect(res.accepted).toBe(3); // still what cleared the consent gate and the normaliser
    expect(res.droppedInFuture).toBe(3);
    expect(res.inserted).toBe(0);
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('a night that ends in 2030 is not stored, and lastNightSleep stays on the real night', async () => {
    const userId = await consentedUser();
    const realStart = Math.floor(nowSec() / DAY) * DAY - DAY - 2 * HOUR; // ends yesterday, 06:00 UTC
    await ingestSummaries(userId, [night(realStart, 3600)]);
    const real = await MedicalProfile.findOne({ userId });
    expect(real.lastNightSleep.date).toEqual(new Date(utcDate(realStart + 8 * HOUR)));

    const futureStart = Date.UTC(2030, 0, 1) / 1000 - 2 * HOUR; // ends 2030-01-01, 06:00 UTC
    const res = await ingestSummaries(userId, [night(futureStart, 7200), nightHrv(futureStart)]);

    expect(res.droppedInFuture).toBe(4); // three sleep stages and the night's HRV
    const after = await MedicalProfile.findOne({ userId });
    expect(after.lastNightSleep.date).toEqual(real.lastNightSleep.date);
    expect(Number(after.lastNightSleep.deep)).toBe(60); // the 2030 night's would be 120
    expect(Number(after.sleepStages.deep)).toBe(60); // and it is in no median
    expect(await VitalSample.countDocuments({ userId })).toBe(0);
  });

  it('the allowance is exactly MAX_FUTURE_SKEW_MS: now + 5 min is kept, now + 5 min + 1 s is dropped', async () => {
    expect(MAX_FUTURE_SKEW_MS).toBe(5 * 60 * 1000);
    const userId = await consentedUser();
    const now = new Date(nowSec() * 1000);
    const edge = now.getTime() / 1000 + MAX_FUTURE_SKEW_MS / 1000;

    // Two summaries, so each reading is the first of its own minute (the normaliser keeps one a minute).
    const res = await ingestSummaries(userId, [
      { type: 'dailies', summary: { startTimeInSeconds: edge, timeOffsetHeartRateSamples: { 0: 61 } } },
      { type: 'dailies', summary: { startTimeInSeconds: edge + 1, timeOffsetHeartRateSamples: { 0: 62 } } },
    ], { now });

    expect(res.droppedInFuture).toBe(1);
    expect(res.inserted).toBe(1);
    const rows = await BiometricLog.find({ userId });
    expect(rows.map((r) => r.recordedAt.getTime())).toEqual([edge * 1000]);
  });

  it('a refusal reports droppedInFuture as 0 with every other count', async () => {
    const userId = new mongoose.Types.ObjectId(); // no consent record
    const res = await ingestSummaries(userId, [daily(nowSec() + HOUR)]);
    expect(res).toMatchObject({ refused: 'consent_not_current', droppedInFuture: 0 });
  });

  // RA-2 of #275, on the store itself: a time a Date cannot hold reached BiometricLog.find as an Invalid Date,
  // whose cast threw, and the whole push failed. The cap drops it before any read or write and counts it.
  it('the store\'s cap drops a metric whose time a Date cannot hold, counts it, and writes its neighbour', async () => {
    const userId = await consentedUser();
    const now = new Date(nowSec() * 1000);

    const res = await persistMetrics(userId, [
      { metric: 'heartRate', value: 61, unit: 'bpm', recordedAt: new Date(NaN), source: 'garmin', tzOffsetMinutes: null },
      { metric: 'heartRate', value: 62, unit: 'bpm', recordedAt: new Date(now.getTime() - 60 * 1000), source: 'garmin', tzOffsetMinutes: null },
    ], { dropOutsideRetention: true, dropInFuture: true, now });

    expect(res.droppedInFuture).toBe(1);
    expect(res.inserted).toBe(1);
    expect((await BiometricLog.find({ userId })).map((r) => Number(r.heartRate))).toEqual([62]);
  });
});

// ── One definition (architect R5) ─────────────────────────────────────────────────────────────────

const APP = path.resolve(__dirname, '../app');
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
  .join('\n');
const ALL = walk(APP).map((f) => ({ file: path.relative(APP, f).replace(/\\/g, '/'), code: stripComments(fs.readFileSync(f, 'utf8')) }));

const definitionsIn = (files) => files
  .filter((f) => /\b(?:const|let|var)\s+MAX_FUTURE_SKEW_MS\s*=/.test(f.code))
  .map((f) => f.file)
  .sort();

describe('MAX_FUTURE_SKEW_MS is defined once (architect R5)', () => {
  it('the scan finds every definition, and a destructured import is not one', () => {
    expect(definitionsIn([
      { file: 'a.js', code: 'const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;' },
      { file: 'b.js', code: "const { MAX_FUTURE_SKEW_MS } = require('./a');" },
      { file: 'c.js', code: 'let MAX_FUTURE_SKEW_MS=300000;' },
    ])).toEqual(['a.js', 'c.js']);
  });

  it('app/ defines it once, in services/wearable/adapter.js', () => {
    expect(definitionsIn(ALL)).toEqual(['services/wearable/adapter.js']);
  });

  // Imported, not copied: under a registry where adapter.js allows an hour, the contract and the envelope
  // admit a reading half an hour ahead, which the real five minutes refuse. (The store's twin is in
  // metricStore.test.js, whose models are mocked: this file's mongoose cannot be loaded twice.)
  it('the Health Connect contract and the personal-lane envelope follow adapter.js', () => {
    const adapterPath = '../app/services/wearable/adapter';
    const now = new Date('2026-10-27T12:00:00.000Z');
    const ahead = new Date(now.getTime() + 30 * 60 * 1000);
    const sample = {
      sampleId: '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b', operation: 'upsert', type: 'heart_rate', value: 61, unit: 'bpm',
      startDate: ahead.toISOString(), endDate: ahead.toISOString(),
    };
    const batch = { schemaVersion: 2, platform: 'health_connect', batchId: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d', samples: [sample] };
    const envelope = { schemaVersion: 1, items: [{ type: 'dailies', summary: { startTimeInSeconds: ahead.getTime() / 1000, restingHeartRateInBeatsPerMinute: 52 } }] };

    const { parseHealthBatchRequest } = require('../app/services/wearable/healthBatchContract');
    const { parseGarminPersonalEnvelope } = require('../app/services/wearable/garminPersonalEnvelope');
    expect(() => parseHealthBatchRequest(batch, { now })).toThrow('invalid_health_sample');
    expect(() => parseGarminPersonalEnvelope(envelope, { now })).toThrow('garmin_summary_in_future');

    try {
      jest.isolateModules(() => {
        jest.doMock(adapterPath, () => ({ ...jest.requireActual(adapterPath), MAX_FUTURE_SKEW_MS: HOUR * 1000 }));
        const contract = require('../app/services/wearable/healthBatchContract');
        const personal = require('../app/services/wearable/garminPersonalEnvelope');
        expect(contract.parseHealthBatchRequest(batch, { now }).samples).toHaveLength(1);
        expect(personal.parseGarminPersonalEnvelope(envelope, { now }).items).toHaveLength(1);
      });
    } finally {
      jest.dontMock(adapterPath);
    }
  });
});
