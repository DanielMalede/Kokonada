'use strict';

// T2 — the Garmin lane writes nothing its stores would only reap.
//
// BiometricLog and VitalSample expire rows on `recordedAt` through a TTL index (90 days unless
// BIOMETRIC_RETENTION_DAYS / VITAL_SAMPLE_RETENTION_DAYS say otherwise). Garmin's backfill reaches
// back 182 days and the personal lane's first pull covers the whole window, so before this filter the
// older half of a backfill was written, folded into MedicalProfile's medians, and then deleted by the
// TTL monitor within a minute. Now ingestSummaries drops those metrics before any write, counts them
// in `droppedOutsideRetention`, and keeps every other field of its result as it was.
//
// Real semantics: the REAL ingest seam on a REAL Mongo (mongodb-memory-server). The line the test
// expects is read off the models' own TTL indexes, the same place Mongo reads it, so neither this file
// nor the code under test restates the 90. Redis is absent, so the recompute enqueue is a no-op.
// Every timestamp is relative to the clock, on a UTC midnight, so the suite never ages out of its own
// fixtures.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_retention' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const TODAY = Math.floor(Date.now() / 1000 / DAY) * DAY; // today's UTC midnight
const daysAgo = (n) => TODAY - n * DAY;

// The TTL a store enforces, in days, read from its schema index: what Mongo builds and reaps by.
const ttlDays = (Model) => {
  const [, options] = Model.schema.indexes()
    .find(([fields, o]) => fields.recordedAt === 1 && Number.isFinite(o.expireAfterSeconds));
  return options.expireAfterSeconds / DAY;
};

// A day's summary as Garmin sends it: a resting heart rate (→ VitalSample) and two heart-rate
// readings a minute apart (→ BiometricLog). Three metrics.
const daily = (start) => ({
  type: 'dailies',
  summary: { startTimeInSeconds: start, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61, 60: 62 } },
});

const counts = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId }),
  vitals: await VitalSample.countDocuments({ userId }),
  profile: await MedicalProfile.countDocuments({ userId }),
});

describe('the Garmin lane drops what its stores would reap', () => {
  it('a dailies summary 120 days old writes 0 rows, and its 3 metrics are counted as dropped', async () => {
    const userId = new mongoose.Types.ObjectId();
    const res = await ingestSummaries(userId, [daily(daysAgo(120))]);

    expect(res.accepted).toBe(3); // still what cleared the normaliser and the consent gate
    expect(res.droppedOutsideRetention).toBe(3);
    expect(res.inserted).toBe(0);
    expect(await counts(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('one 10 days old writes its rows and drops nothing', async () => {
    const userId = new mongoose.Types.ObjectId();
    const res = await ingestSummaries(userId, [daily(daysAgo(10))]);

    expect(res.droppedOutsideRetention).toBe(0);
    expect(res.inserted).toBe(2);
    expect(await counts(userId)).toEqual({ heartRate: 2, vitals: 1, profile: 1 });
  });

  it('a backfill reaching back 182 days keeps only its in-window summaries', async () => {
    const userId = new mongoose.Types.ObjectId();
    const res = await ingestSummaries(userId, [182, 120, 60, 10].map((n) => daily(daysAgo(n))));

    expect(res.accepted).toBe(12);
    expect(res.droppedOutsideRetention).toBe(6);
    expect(res.inserted).toBe(4);
    expect(await counts(userId)).toEqual({ heartRate: 4, vitals: 2, profile: 1 });
  });

  it('the line is the stores\' own TTL: a day inside it is written, a day past it is not', async () => {
    const inside = new mongoose.Types.ObjectId();
    const outside = new mongoose.Types.ObjectId();
    const shortest = Math.min(ttlDays(BiometricLog), ttlDays(VitalSample));
    const longest = Math.max(ttlDays(BiometricLog), ttlDays(VitalSample));

    await ingestSummaries(inside, [daily(daysAgo(shortest - 1))]);
    await ingestSummaries(outside, [daily(daysAgo(longest + 1))]);

    expect(await counts(inside)).toEqual({ heartRate: 2, vitals: 1, profile: 1 });
    expect(await counts(outside)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('an out-of-window night never reaches MedicalProfile: no median, no last night', async () => {
    const userId = new mongoose.Types.ObjectId();
    const res = await ingestSummaries(userId, [{
      type: 'sleeps',
      summary: { startTimeInSeconds: daysAgo(120), durationInSeconds: 8 * HOUR, deepSleepDurationInSeconds: 3600, lightSleepDurationInSeconds: 14400 },
    }]);

    expect(res.droppedOutsideRetention).toBe(2);
    expect(await MedicalProfile.countDocuments({ userId })).toBe(0);
  });
});
