'use strict';

// T1 — what a Garmin night writes, read back from a REAL Mongo (mongodb-memory-server) through the
// REAL ingest seam: normaliser → consent gate → persistMetrics → VitalSample / MedicalProfile.
// Nothing on the write path is mocked; Redis is absent, so the recompute enqueue at the tail of
// persistMetrics is a no-op.
//
//   · HRV is stamped at the END of its measurement window and labelled RMSSD. Garmin's HRV is the
//     night's RMSSD, and VitalSample keeps the method so the baseline engine never mixes it with
//     Apple's SDNN (baselineEngine.computeBaselineBlob reads `hrvMethod` per row).
//   · A night lands on MedicalProfile.lastNightSleep under the UTC date of its END, the convention
//     computeLastNightSleep buckets by. Stamped at its start, a night that began before UTC midnight
//     was filed a day early.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');

jest.setTimeout(120000);

// The seam refuses a user without a current Art. 9 grant (BE-205), so every user here holds one.
async function consentedUser() {
  const userId = new mongoose.Types.ObjectId();
  await ConsentRecord.create({
    userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date(),
  });
  return userId;
}

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_vitalsample' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
// Yesterday's UTC midnight. The night below starts two hours before it and ends six hours after, so
// its start and its end fall on DIFFERENT UTC dates: the case end-stamping exists for. Relative to the
// clock, so the fixture never ages out of the retention window.
const MIDNIGHT = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
const NIGHT_START = MIDNIGHT - 2 * HOUR;
const NIGHT_LENGTH = 8 * HOUR;
const NIGHT_END = NIGHT_START + NIGHT_LENGTH;
const utcDate = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

describe('a Garmin HRV summary in VitalSample', () => {
  it('is stored at the end of its window with hrvMethod rmssd, and its value round-trips', async () => {
    const userId = await consentedUser();
    await ingestSummaries(userId, [{
      type: 'hrv',
      summary: { startTimeInSeconds: NIGHT_START, startTimeOffsetInSeconds: 3 * HOUR, durationInSeconds: NIGHT_LENGTH, lastNightAvg: 48 },
    }]);

    const rows = await VitalSample.find({ userId, metric: 'hrv' });
    expect(rows).toHaveLength(1);
    expect(rows[0].hrvMethod).toBe('rmssd');
    expect(rows[0].recordedAt).toEqual(new Date(NIGHT_END * 1000));
    expect(Number(rows[0].value)).toBe(48);
    expect(rows[0].tzOffsetMinutes).toBe(180);

    // The label is on disk, not only on the model: the baseline engine reads it from there.
    const onDisk = await mongoose.connection.db.collection('vitalsamples').findOne({ userId, metric: 'hrv' });
    expect(onDisk.hrvMethod).toBe('rmssd');
  });

  it('labels only HRV: the resting-HR row from the same push carries no method', async () => {
    const userId = await consentedUser();
    await ingestSummaries(userId, [
      { type: 'hrv', summary: { startTimeInSeconds: NIGHT_START, durationInSeconds: NIGHT_LENGTH, lastNightAvg: 48 } },
      { type: 'dailies', summary: { startTimeInSeconds: MIDNIGHT, restingHeartRateInBeatsPerMinute: 52 } },
    ]);

    const rows = await VitalSample.find({ userId }).sort({ metric: 1 });
    expect(rows.map((r) => [r.metric, r.hrvMethod])).toEqual([['hrv', 'rmssd'], ['restingHeartRate', null]]);
  });
});

describe('a Garmin night in MedicalProfile.lastNightSleep', () => {
  it('lands under the UTC date of the night\'s end, not of its start', async () => {
    expect(utcDate(NIGHT_START)).not.toBe(utcDate(NIGHT_END)); // the fixture really straddles midnight
    const userId = await consentedUser();
    await ingestSummaries(userId, [{
      type: 'sleeps',
      summary: {
        startTimeInSeconds: NIGHT_START,
        durationInSeconds: NIGHT_LENGTH,
        deepSleepDurationInSeconds: 3600,
        lightSleepDurationInSeconds: 14400,
        remSleepInSeconds: 5400,
      },
    }]);

    const profile = await MedicalProfile.findOne({ userId });
    expect(profile.lastNightSleep.date).toEqual(new Date(utcDate(NIGHT_END)));
    expect(Number(profile.lastNightSleep.deep)).toBe(60);
    expect(Number(profile.lastNightSleep.light)).toBe(240);
    expect(Number(profile.lastNightSleep.rem)).toBe(90);
  });
});
