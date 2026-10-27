'use strict';

// BE-191 (RA-3, the resilience audit of #273 at 326ecb4): a Garmin night keeps ONE HRV row, whatever
// Garmin later says about the length of its window.
//
// The normaliser stamps a Garmin HRV where its window ends (adapter.js), and a VitalSample's identity was
// `metric@source@recordedAt`. When Garmin revises a night's window (a later sync, a re-pull of the same
// day), the end moves, the identity moved with it, and the same night got a second hrv row, so the
// baseline engine counted one night twice (EG-1 needs exactly one). For a Garmin HRV the identity is now
// the night, filed under the UTC date of its end, and the first write wins. Every other series keeps its
// per-reading identity: two Health Connect HRV readings in one night are two facts.
//
// Real semantics: the REAL consent read, normalisers and stores on a REAL Mongo (mongodb-memory-server),
// through both real ingest lanes (garminIngest.ingestSummaries, healthStore.ingestBatch). No schema change
// and no index: the identity is the store's own dedupe. Redis is absent, so the recompute enqueue at the
// tail of persistMetrics is a no-op.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const VitalSample = require('../app/models/VitalSample');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');
const healthStore = require('../app/services/wearable/healthStore');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_hrv_identity' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Yesterday's UTC midnight. The night below starts two hours before it and ends six hours after, so it is
// behind the clock and inside retention whenever the suite runs.
const MIDNIGHT = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
const NIGHT_START = MIDNIGHT - 2 * HOUR;
const NIGHT = 8 * HOUR;

async function consentedUser() {
  const userId = new mongoose.Types.ObjectId();
  await ConsentRecord.create({
    userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date(),
  });
  return userId;
}

const hrv = (start, duration, lastNightAvg) => ({ type: 'hrv', summary: { startTimeInSeconds: start, durationInSeconds: duration, lastNightAvg } });
const hrvRows = async (userId) => (await VitalSample.find({ userId, metric: 'hrv' }).sort({ recordedAt: 1 }))
  .map((r) => ({ source: r.source, value: Number(r.value), at: r.recordedAt.getTime() }));

describe('one Garmin HRV row per night (BE-191)', () => {
  it.each([
    ['40 minutes later', 40 * MINUTE],
    ['40 minutes earlier', -40 * MINUTE],
  ])('the same night re-ingested with its end %s and a different value: still one row, holding the first value', async (_label, shift) => {
    const userId = await consentedUser();

    await ingestSummaries(userId, [hrv(NIGHT_START, NIGHT, 48)]);
    const res = await ingestSummaries(userId, [hrv(NIGHT_START, NIGHT + shift, 55)]);

    expect(res.refused).toBeNull(); // the re-pull was admitted; the store kept the night it already had
    expect(await hrvRows(userId)).toEqual([{ source: 'garmin', value: 48, at: (NIGHT_START + NIGHT) * 1000 }]);
  });

  it('two summaries of the same night in one push write one row, the first', async () => {
    const userId = await consentedUser();

    await ingestSummaries(userId, [hrv(NIGHT_START, NIGHT, 48), hrv(NIGHT_START, NIGHT + 40 * MINUTE, 55)]);

    expect(await hrvRows(userId)).toEqual([{ source: 'garmin', value: 48, at: (NIGHT_START + NIGHT) * 1000 }]);
  });

  it('two consecutive nights are two rows: the identity is the night, not the day around it', async () => {
    const userId = await consentedUser();

    await ingestSummaries(userId, [hrv(NIGHT_START - DAY, NIGHT, 47)]);
    await ingestSummaries(userId, [hrv(NIGHT_START, NIGHT, 48)]);

    expect((await hrvRows(userId)).map((r) => r.value)).toEqual([47, 48]);
  });

  it('two Health Connect HRV readings in one night stay two rows: every other series keeps its per-reading identity', async () => {
    const userId = await consentedUser();
    const end = new Date((NIGHT_START + NIGHT) * 1000);
    const sample = (endDate, value) => ({ type: 'hrv', value, startDate: new Date(endDate.getTime() - 5 * MINUTE * 1000).toISOString(), endDate: endDate.toISOString() });

    await healthStore.ingestBatch(userId, 'health_connect', [sample(end, 40), sample(new Date(end.getTime() + 40 * MINUTE * 1000), 44)]);

    expect(await hrvRows(userId)).toEqual([
      { source: 'health_connect', value: 40, at: end.getTime() },
      { source: 'health_connect', value: 44, at: end.getTime() + 40 * MINUTE * 1000 },
    ]);
  });

  it('a Garmin HRV and a Health Connect HRV of the same night are two rows: the identity carries the source', async () => {
    const userId = await consentedUser();
    const end = new Date((NIGHT_START + NIGHT) * 1000);

    await ingestSummaries(userId, [hrv(NIGHT_START, NIGHT, 48)]);
    await healthStore.ingestBatch(userId, 'health_connect', [{ type: 'hrv', value: 40, startDate: end.toISOString(), endDate: end.toISOString() }]);

    expect((await hrvRows(userId)).map((r) => r.source).sort()).toEqual(['garmin', 'health_connect']);
  });
});
