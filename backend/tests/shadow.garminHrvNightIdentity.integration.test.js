'use strict';

// RA-1, resilience audit of #275 at d12510d. BE-191 keys a Garmin HRV by the UTC date of its night's end,
// first write wins. Two DIFFERENT nights that end on one UTC date then share that key and the second is
// never written: a wearer at UTC+8 who wakes at 08:10 one morning and 07:50 the next ends both nights on
// one UTC date (00:10Z and 23:50Z). Before #275 both rows were written. BE-191's own property (a revised
// end is still one night) must survive the fix: case 3 stays green.
//
// Real semantics: the REAL consent read, normaliser and stores on a REAL Mongo (mongodb-memory-server).
// Redis is absent, so the recompute enqueue at the tail of persistMetrics is a no-op.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const VitalSample = require('../app/models/VitalSample');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_ra1_hrv_night_identity' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// A UTC midnight three days back: every night below ends on that date, behind the clock and inside retention.
const D = Math.floor(Date.now() / 1000 / DAY) * DAY - 3 * DAY;
const FIRST_END = D + 10 * MINUTE;        // 00:10Z = 08:10 at UTC+8
const SECOND_END = D + DAY - 10 * MINUTE; // 23:50Z = 07:50 at UTC+8, the next morning

async function consentedUser() {
  const userId = new mongoose.Types.ObjectId();
  await ConsentRecord.create({
    userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date(),
  });
  return userId;
}

// A night worn at UTC+8 that ends at endSec (or at endSec + the extra length of a revised window).
const night = (endSec, lastNightAvg, durationInSeconds = 8 * HOUR) => ({
  type: 'hrv',
  summary: { startTimeInSeconds: endSec - 8 * HOUR, startTimeOffsetInSeconds: 8 * HOUR, durationInSeconds, lastNightAvg },
});
const garminHrv = async (userId) => (await VitalSample.find({ userId, metric: 'hrv', source: 'garmin' }).sort({ recordedAt: 1 }))
  .map((r) => ({ value: Number(r.value), at: r.recordedAt.getTime() }));

describe('RA-1: two Garmin nights are two HRV rows, whatever UTC date they end on', () => {
  it('nights ending 00:10Z and 23:50Z of one UTC date, in two pushes: both rows', async () => {
    expect(new Date(FIRST_END * 1000).toISOString().slice(0, 10)).toBe(new Date(SECOND_END * 1000).toISOString().slice(0, 10));
    const userId = await consentedUser();

    await ingestSummaries(userId, [night(FIRST_END, 48)]);
    const res = await ingestSummaries(userId, [night(SECOND_END, 52)]);

    expect(res.refused).toBeNull();
    expect(await garminHrv(userId)).toEqual([{ value: 48, at: FIRST_END * 1000 }, { value: 52, at: SECOND_END * 1000 }]);
  });

  it('the same two nights in one push (a backfill): both rows', async () => {
    const userId = await consentedUser();

    await ingestSummaries(userId, [night(FIRST_END, 48), night(SECOND_END, 52)]);

    expect((await garminHrv(userId)).map((r) => r.value)).toEqual([48, 52]);
  });

  it('control, BE-191: the first night re-pulled with its end 40 minutes later stays one row', async () => {
    const userId = await consentedUser();

    await ingestSummaries(userId, [night(FIRST_END, 48)]);
    await ingestSummaries(userId, [night(FIRST_END, 55, 8 * HOUR + 40 * MINUTE)]);

    expect((await garminHrv(userId)).map((r) => r.value)).toEqual([48]);
  });
});
