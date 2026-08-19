'use strict';

// REAL-Mongo integration test (mongodb-memory-server) for the VitalSample collection (W4-004).
//
// Risk register R9 makes this mandatory: "every new encrypted field ships a round-trip test".
// A field-level encryption bug does not announce itself — the write succeeds, the read returns
// NaN or ciphertext, and the number quietly stops being a number three layers downstream (this
// is exactly how the metricStore double-encryption bug reached production and made Pulse show
// "—"). So the assertions below deliberately go through the DRIVER as well as the model: a
// getter test alone cannot tell "encrypted at rest" from "not encrypted at all".
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const VitalSample = require('../app/models/VitalSample');
const { METRICS } = require('../app/agents/runtime/_shared/dto/telemetry');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_vitalsample' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => { await VitalSample.deleteMany({}); });

const uid = () => new mongoose.Types.ObjectId();
const raw = () => mongoose.connection.db.collection('vitalsamples');

describe('VitalSample — encryption at rest (audit F3, R9)', () => {
  it('stores ciphertext in Mongo and decrypts through the getter (round trip)', async () => {
    const userId = uid();
    await VitalSample.create({
      userId, metric: 'hrv', value: 62.5, recordedAt: new Date('2026-08-01T03:00:00Z'), source: 'garmin',
    });

    // Driver-level: what actually sits on disk must NOT be the number.
    const stored = await raw().findOne({ userId });
    expect(typeof stored.value).toBe('string');
    expect(stored.value).not.toContain('62.5');
    expect(Number(stored.value)).toBeNaN();

    // Model-level: the getter gives the number back, exactly.
    const doc = await VitalSample.findOne({ userId });
    expect(Number(doc.value)).toBe(62.5);
  });

  it('.lean() deliberately returns ciphertext — the getter is the only decrypt path', async () => {
    const userId = uid();
    await VitalSample.create({
      userId, metric: 'spO2', value: 97, recordedAt: new Date(), source: 'garmin',
    });
    const lean = await VitalSample.findOne({ userId }).lean();
    expect(Number(lean.value)).toBeNaN(); // pinned so nobody "optimises" a reader onto .lean()
  });

  it('binds the ciphertext to its owner (AAD): a row lifted to another user reads null + alarms', async () => {
    const owner = uid();
    const attacker = uid();
    await VitalSample.create({
      userId: owner, metric: 'hrv', value: 71, recordedAt: new Date(), source: 'garmin',
    });
    const lifted = (await raw().findOne({ userId: owner })).value;
    await raw().insertOne({
      userId: attacker, metric: 'hrv', value: lifted, recordedAt: new Date(), source: 'garmin', v: 1,
    });

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stolen = await VitalSample.findOne({ userId: attacker });
    expect(stolen.value).toBeNull();                       // never leaks the raw blob or a NaN
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[crypto-alarm]'));
    spy.mockRestore();
  });

  it('AAD binding depends on userId being set FIRST — the caveat the model documents', async () => {
    const userId = uid();
    // value assigned BEFORE userId: encrypted unbound. Still readable (the tolerant read path),
    // which is precisely why this cannot be caught by a round-trip assertion alone and has to
    // be pinned as its own behaviour.
    const doc = new VitalSample({});
    doc.value = 55;
    doc.userId = userId;
    doc.metric = 'restingHeartRate';
    doc.recordedAt = new Date();
    doc.source = 'garmin';
    await doc.save();

    const reread = await VitalSample.findOne({ userId });
    expect(Number(reread.value)).toBe(55); // readable — but NOT owner-bound

    // Proof it is unbound: the same blob reads fine under a different owner, which the
    // userId-first construction above forbids.
    const other = uid();
    const blob = (await raw().findOne({ userId })).value;
    await raw().insertOne({
      userId: other, metric: 'restingHeartRate', value: blob, recordedAt: new Date(), source: 'garmin', v: 1,
    });
    const replayed = await VitalSample.findOne({ userId: other });
    expect(Number(replayed.value)).toBe(55);
  });
});

describe('VitalSample — metric-aware range validation (S8)', () => {
  const cases = [
    ['hrv', 1, 400],
    ['restingHeartRate', 25, 150],
    ['respirationRate', 3, 60],
    ['spO2', 50, 100],
    ['bodyBattery', 0, 100],
    ['stressLevel', 0, 100],
  ];

  it.each(cases)('%s accepts its exact boundaries', async (metric, min, max) => {
    const userId = uid();
    await expect(VitalSample.create({ userId, metric, value: min, recordedAt: new Date(), source: 'garmin' }))
      .resolves.toBeDefined();
    await expect(VitalSample.create({ userId, metric, value: max, recordedAt: new Date(), source: 'garmin' }))
      .resolves.toBeDefined();
  });

  it.each(cases)('%s rejects just outside its boundaries', async (metric, min, max) => {
    const userId = uid();
    await expect(VitalSample.create({ userId, metric, value: min - 0.5, recordedAt: new Date(), source: 'garmin' }))
      .rejects.toThrow(/outside/);
    await expect(VitalSample.create({ userId, metric, value: max + 0.5, recordedAt: new Date(), source: 'garmin' }))
      .rejects.toThrow(/outside/);
    expect(await VitalSample.countDocuments({ userId })).toBe(0);
  });

  it('rejects the Garmin "unmeasurable" sentinels rather than storing them as data (D16)', async () => {
    const userId = uid();
    for (const sentinel of [-1, -2]) {
      await expect(VitalSample.create({
        userId, metric: 'stressLevel', value: sentinel, recordedAt: new Date(), source: 'garmin',
      })).rejects.toThrow(/outside/);
    }
  });

  it.each([[NaN], [Infinity], [-Infinity]])('rejects the non-finite value %p', async (bad) => {
    const userId = uid();
    await expect(VitalSample.create({
      userId, metric: 'hrv', value: bad, recordedAt: new Date(), source: 'garmin',
    })).rejects.toThrow();
    expect(await VitalSample.countDocuments({ userId })).toBe(0);
  });

  it('rejects an unknown metric and an unknown source', async () => {
    const userId = uid();
    await expect(VitalSample.create({
      userId, metric: 'bloodGlucose', value: 5, recordedAt: new Date(), source: 'garmin',
    })).rejects.toThrow();
    await expect(VitalSample.create({
      userId, metric: 'hrv', value: 50, recordedAt: new Date(), source: 'fitbit',
    })).rejects.toThrow();
  });

  it('rejects a tzOffsetMinutes outside the real world (S6)', async () => {
    const userId = uid();
    for (const tz of [-841, 721]) {
      await expect(VitalSample.create({
        userId, metric: 'hrv', value: 50, recordedAt: new Date(), source: 'garmin', tzOffsetMinutes: tz,
      })).rejects.toThrow();
    }
    for (const tz of [-840, 0, 720]) {
      await expect(VitalSample.create({
        userId, metric: 'hrv', value: 50, recordedAt: new Date(), source: 'garmin', tzOffsetMinutes: tz,
      })).resolves.toBeDefined();
    }
  });

  it('validates on insertMany too — the path the ingest lanes use', async () => {
    const userId = uid();
    const docs = [
      { userId, metric: 'hrv', value: 60, recordedAt: new Date(), source: 'garmin' },
      { userId, metric: 'spO2', value: 240, recordedAt: new Date(), source: 'garmin' }, // impossible
    ];
    const res = await VitalSample.insertMany(docs, { ordered: false, rawResult: true }).catch((e) => e);
    expect(await VitalSample.countDocuments({ userId })).toBe(1);
    expect(res).toBeDefined();
  });
});

describe('VitalSample — schema contract', () => {
  it('carries a version field on every row (S15)', async () => {
    const userId = uid();
    await VitalSample.create({ userId, metric: 'hrv', value: 60, recordedAt: new Date(), source: 'garmin' });
    const stored = await raw().findOne({ userId });
    expect(stored.v).toBe(VitalSample.VITAL_SAMPLE_VERSION);
  });

  it('defaults tzOffsetMinutes to null rather than inventing the server timezone (D13)', async () => {
    const userId = uid();
    await VitalSample.create({ userId, metric: 'hrv', value: 60, recordedAt: new Date(), source: 'garmin' });
    const doc = await VitalSample.findOne({ userId });
    expect(doc.tzOffsetMinutes).toBeNull();
  });

  it('requires recordedAt — a vital with no time is not a time series', async () => {
    await expect(VitalSample.create({
      userId: uid(), metric: 'hrv', value: 60, source: 'garmin',
    })).rejects.toThrow();
  });

  it('the metric vocabulary is exactly the telemetry DTO metrics minus heartRate (drift guard)', () => {
    expect([...VitalSample.VITAL_METRICS].sort())
      .toEqual([...METRICS].filter((m) => m !== 'heartRate').sort());
  });

  it('declares the query index the baseline engine reads on', () => {
    const keys = VitalSample.schema.indexes().map(([k]) => JSON.stringify(k));
    expect(keys).toContain(JSON.stringify({ userId: 1, metric: 1, recordedAt: -1 }));
  });

  it('declares a TTL index so special-category vitals never linger (T3.1)', () => {
    const ttl = VitalSample.schema.indexes().find(([, o]) => o && o.expireAfterSeconds != null);
    expect(ttl).toBeDefined();
    expect(ttl[0]).toEqual({ recordedAt: 1 });
    expect(ttl[1].expireAfterSeconds).toBe(90 * 24 * 3600);
  });
});
