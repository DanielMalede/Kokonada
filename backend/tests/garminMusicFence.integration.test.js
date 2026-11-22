'use strict';

// BE-245 (DEC-047, ADR-0018) — while the Garmin music fence is closed, nothing Garmin's Health API sends can
// shape the music.
//
// Layer 1, the quarantine at ingest: garminIngest.ingestSummaries still runs the Art. 9 consent gate and the
// consent-version gate, then writes NOTHING: no BiometricLog row, no VitalSample row, no MedicalProfile field,
// no state-vector recompute queued. It answers { fenced: true, fencedDropped: N } and logs one count-only line.
//
// Real semantics: the REAL consent read, normaliser, seam and stores on a REAL Mongo (mongodb-memory-server).
// Faked: the BullMQ queue, by a STATEFUL in-memory queue that records every job it is handed (so "nothing
// queued" is measured on the real enqueue call the store makes), and Redis, by a stateful in-memory store.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;

jest.mock('../app/queues/queue', () => {
  const jobs = [];
  return {
    enqueue: jest.fn(async (name, data, opts) => { jobs.push({ name, data, opts }); return { queued: true }; }),
    __jobs: jobs,
  };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const ConsentRecord = require('../app/models/ConsentRecord');
const { __jobs: queued } = require('../app/queues/queue');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_music_fence' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let logged;
beforeEach(() => {
  queued.length = 0;
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { logged.push({ level, line: args.map(String).join(' ') }); });
  }
});
afterEach(() => jest.restoreAllMocks());

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
// Yesterday's UTC midnight: every reading below is inside retention and behind the clock.
const MIDNIGHT = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;

// A full push, every lane the normaliser admits at consent v1: three per-minute heart-rate samples and a
// resting HR (dailies), a night's HRV (hrv), a night's three sleep stages (sleeps) = 8 metrics. Plus a pulse-ox
// summary whose two SpO2 values the consent-version gate drops before the fence ever counts them.
const fullPush = (shift = 0) => [
  { type: 'dailies', summary: { startTimeInSeconds: MIDNIGHT + shift, restingHeartRateInBeatsPerMinute: 71, timeOffsetHeartRateSamples: { 0: 91, 60: 92, 120: 93 } } },
  { type: 'hrv', summary: { startTimeInSeconds: MIDNIGHT + shift - 2 * HOUR, durationInSeconds: 8 * HOUR, lastNightAvg: 23 } },
  {
    type: 'sleeps',
    summary: {
      startTimeInSeconds: MIDNIGHT + shift - 2 * HOUR,
      durationInSeconds: 8 * HOUR,
      deepSleepDurationInSeconds: 600,
      lightSleepDurationInSeconds: 7200,
      remSleepInSeconds: 900,
    },
  },
  { type: 'pulseox', summary: { startTimeInSeconds: MIDNIGHT + shift, timeOffsetSpo2Values: { 0: 95, 60: 96 } } },
];
const FULL_PUSH_ADMITTED = 8;

const grant = (userId, consentVersion = CURRENT_CONSENT_VERSION) => ConsentRecord.create({
  userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion, status: 'granted', grantedAt: new Date(),
});
const stored = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId }),
  vitals: await VitalSample.countDocuments({ userId }),
  profile: await MedicalProfile.countDocuments({ userId }),
});
const lines = () => logged.map((l) => l.line);

describe('layer 1 — the quarantine at ingest (fence closed, the shipped default)', () => {
  it('a full push for a consented user writes nothing a generation reads, queues nothing, and counts what it dropped', async () => {
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);

    const res = await ingestSummaries(userId, fullPush());

    expect(res).toMatchObject({ fenced: true, fencedDropped: FULL_PUSH_ADMITTED, inserted: 0, refused: null });
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    expect(queued).toEqual([]);
  });

  it('logs one count-only line: the number, never the user id or a value (T1)', async () => {
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);

    await ingestSummaries(userId, fullPush());

    const fenceLines = lines().filter((l) => l.includes('fenced'));
    expect(fenceLines).toEqual([`[garmin] fenced metrics=${FULL_PUSH_ADMITTED}`]);
    for (const l of lines()) {
      expect(l).not.toContain(String(userId));
      for (const value of ['71', '91', '92', '93', '23', '95', '96']) expect(l).not.toMatch(new RegExp(`\\b${value}\\b`));
    }
  });

  it('the consent gate still runs first: no current grant is a refusal, not a fenced drop, and nothing is logged as fenced', async () => {
    const userId = new mongoose.Types.ObjectId();

    const res = await ingestSummaries(userId, fullPush());

    expect(res.refused).toBe('consent_not_current');
    expect(res.fenced).not.toBe(true);
    expect(lines().filter((l) => l.includes('fenced'))).toEqual([]);
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('the consent-version gate still runs: the SpO2 values it drops are not counted as fenced', async () => {
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);

    const res = await ingestSummaries(userId, fullPush().filter(({ type }) => type === 'pulseox'));

    expect(res).toMatchObject({ fenced: true, fencedDropped: 0 });
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('a replayed backfill writes nothing either, however many times it arrives', async () => {
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);

    for (let day = 0; day < 5; day += 1) await ingestSummaries(userId, fullPush(-day * DAY));

    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    expect(queued).toEqual([]);
  });
});
