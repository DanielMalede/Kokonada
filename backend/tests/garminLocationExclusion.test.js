'use strict';

// T1 (R3: no GPS) — nothing positional in a Garmin summary reaches the normalised output or the
// database.
//
// The normaliser reads a closed list of fields, so this has held by construction; these pins make it
// a tested property instead of a reading of the code, so the next field someone maps cannot carry a
// coordinate through unnoticed. The summaries below are fed RAW — no envelope in front — because the
// webhook lane has none: the seam itself must be clean.
//
// Real semantics end to end: the REAL normaliser and the REAL ingest seam (consent read, stores,
// MedicalProfile upsert) on a REAL Mongo (mongodb-memory-server). The stored documents are read back
// through the DRIVER and searched, because a model getter only shows what the model chooses to
// expose. Redis is absent, so the recompute enqueue at the tail of persistMetrics is a no-op.
//
// The sentinel coordinates sit inside the heart-rate range on purpose: a longitude misread as bpm is
// caught by the decrypted-value check, not only by a leaked key or string.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
const { normalizeGarminSummaries } = require('../app/services/wearable/adapter');
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

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
// Two days back, on a UTC midnight: inside every retention window and never in the future.
const START = Math.floor(Date.now() / 1000 / DAY) * DAY - 2 * DAY;

const LAT = 47.123456789;
const LON = 151.123456789;
const POLYLINE = 'sentinel-polyline-1f6b';
const PLACE = 'sentinel-place-9c2e';
const NEEDLES = [String(LAT), String(LON), POLYLINE, PLACE];
// Anchored where an allowed key shares the word (timeOffsetHeartRateSamples is not a position).
const LOCATION_KEY = /latitude|longitude|polyline|InDegree|^samples$|location|^geo/i;
const CANONICAL_KEYS = ['metric', 'value', 'unit', 'recordedAt', 'source', 'tzOffsetMinutes', 'hrvMethod'];

// Every positional shape Garmin uses, on one object: activity-style starting coordinates, an encoded
// polyline, a place name, positioned samples and a Connect-style geo DTO.
const location = () => ({
  startingLatitudeInDegree: LAT,
  startingLongitudeInDegree: LON,
  polyline: POLYLINE,
  locationName: PLACE,
  samples: [{ startTimeInSeconds: START + 60, latitudeInDegree: LAT, longitudeInDegree: LON, latitude: LAT, longitude: LON, heartRate: 61 }],
  geoPolylineDTO: { polyline: [{ lat: LAT, lon: LON }] },
});

// One summary of each type the lane carries, each laden with location, including inside the sleep
// timeline's own segments.
const laden = () => [
  {
    type: 'dailies',
    summary: { ...location(), startTimeInSeconds: START, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61, 60: 62, 120: 63 } },
  },
  {
    type: 'sleeps',
    summary: {
      ...location(),
      startTimeInSeconds: START - 3 * HOUR,
      durationInSeconds: 8 * HOUR,
      deepSleepDurationInSeconds: 3600,
      lightSleepDurationInSeconds: 14400,
      remSleepInSeconds: 5400,
      sleepLevelsMap: { deep: [{ startTimeInSeconds: START - 3 * HOUR, endTimeInSeconds: START + 5 * HOUR, latitude: LAT, longitude: LON }] },
    },
  },
  {
    type: 'hrv',
    summary: { ...location(), startTimeInSeconds: START - 3 * HOUR, durationInSeconds: 8 * HOUR, lastNightAvg: 48 },
  },
];

// Every key at every depth, walked rather than grepped so a value cannot stand in for a key.
function keysDeep(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe('the normaliser emits nothing positional', () => {
  it.each(['dailies', 'sleeps', 'hrv', 'stressDetails', 'pulseox', 'respiration'])(
    'a %s summary carrying only location yields no record',
    (type) => {
      expect(normalizeGarminSummaries(type, { startTimeInSeconds: START, ...location() })).toEqual([]);
    },
  );

  it('a laden summary yields records with canonical keys only, and no coordinate in their values or text', () => {
    for (const { type, summary } of laden()) {
      const out = normalizeGarminSummaries(type, summary);
      expect(out.length).toBeGreaterThan(0); // non-vacuous: the fixture really produces records
      for (const record of out) {
        expect(Object.keys(record).filter((k) => !CANONICAL_KEYS.includes(k))).toEqual([]);
        expect([LAT, LON]).not.toContain(record.value);
      }
      const text = JSON.stringify(out);
      for (const needle of NEEDLES) expect(text).not.toContain(needle);
    }
  });
});

describe('nothing positional reaches the database', () => {
  let mem;
  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_location' });
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  const stored = async (userId) => {
    const read = (name) => mongoose.connection.db.collection(name).find({ userId }).toArray();
    return {
      biometriclogs: await read('biometriclogs'),
      vitalsamples: await read('vitalsamples'),
      medicalprofiles: await read('medicalprofiles'),
    };
  };

  it('the stored documents hold no coordinate, polyline, place or location key', async () => {
    const userId = await consentedUser();
    await ingestSummaries(userId, laden());

    const docs = await stored(userId);
    // Non-vacuous: the lane really wrote heart rate, both vitals and a profile.
    expect(docs.biometriclogs.length).toBeGreaterThan(0);
    expect(docs.vitalsamples.map((d) => d.metric).sort()).toEqual(['hrv', 'restingHeartRate']);
    expect(docs.medicalprofiles).toHaveLength(1);

    // JSON round trip so ObjectIds and Dates serialise the way they would leave the database.
    const serialised = JSON.parse(JSON.stringify(docs));
    const text = JSON.stringify(serialised);
    for (const needle of NEEDLES) expect(text).not.toContain(needle);
    expect(keysDeep(serialised).filter((k) => LOCATION_KEY.test(k))).toEqual([]);
  });

  it('no decrypted reading equals a coordinate: a value leak is caught, not only a key leak', async () => {
    const userId = await consentedUser();
    await ingestSummaries(userId, laden());

    const heartRates = (await BiometricLog.find({ userId })).map((d) => Number(d.heartRate));
    const vitals = (await VitalSample.find({ userId })).map((d) => Number(d.value));
    expect(heartRates.length).toBeGreaterThan(0);
    expect(vitals.length).toBeGreaterThan(0);
    for (const v of [...heartRates, ...vitals]) expect([LAT, LON]).not.toContain(v);

    // The profile's one positional field (an orphan, never written by this lane) stays empty.
    const profile = await MedicalProfile.findOne({ userId });
    expect(profile.gpsVelocityKmh).toBeNull();
  });
});
