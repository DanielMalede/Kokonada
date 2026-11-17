'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog = require('../app/models/BiometricLog');
const HealthSample = require('../app/models/HealthSample');
const VitalSample = require('../app/models/VitalSample');
const {
  projectTimeSeriesSample,
  removeTimeSeriesProjection,
} = require('../app/services/wearable/healthSampleProjection');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_health_projection' });
  await Promise.all([
    BiometricLog.syncIndexes(),
    HealthSample.syncIndexes(),
    VitalSample.syncIndexes(),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([
    BiometricLog.deleteMany({}),
    HealthSample.deleteMany({}),
    VitalSample.deleteMany({}),
  ]);
});

const userId = () => new mongoose.Types.ObjectId();

async function activeSample(overrides = {}) {
  return HealthSample.create({
    userId: overrides.userId || userId(),
    sampleKey: overrides.sampleKey || '1'.repeat(64),
    source: 'apple_health',
    metric: 'heart_rate',
    value: 72,
    unit: 'count/min',
    startAt: new Date('2026-10-06T08:00:00Z'),
    endAt: new Date('2026-10-06T08:00:01Z'),
    tzOffsetMinutes: -180,
    state: 'active',
    projectionState: 'pending',
    expiresAt: new Date('2027-01-04T08:00:01Z'),
    ...overrides,
  });
}

describe('health sample time-series projection', () => {
  it('projects heart rate once even when the same pending sample is retried', async () => {
    const sample = await activeSample();

    await expect(projectTimeSeriesSample(sample)).resolves.toEqual({ inserted: 1, removed: 0 });
    await expect(projectTimeSeriesSample(sample)).resolves.toEqual({ inserted: 0, removed: 0 });

    const rows = await BiometricLog.find({ userId: sample.userId });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].heartRate)).toBe(72);
    expect(rows[0]).toMatchObject({
      source: 'apple_health',
      activity: 'unknown',
      healthSampleKey: sample.sampleKey,
      tzOffsetMinutes: -180,
    });
    expect(rows[0].recordedAt).toEqual(sample.startAt);
  });

  it.each([
    ['resting_heart_rate', 'restingHeartRate', null, 58, '2'],
    ['hrv', 'hrv', 'sdnn', 49, '3'],
  ])('projects %s into the existing VitalSample read model', async (
    sourceMetric, metric, hrvMethod, value, keyDigit,
  ) => {
    const sample = await activeSample({
      sampleKey: keyDigit.repeat(64),
      metric: sourceMetric,
      method: hrvMethod,
      value,
      unit: sourceMetric === 'hrv' ? 'ms' : 'count/min',
    });

    await expect(projectTimeSeriesSample(sample)).resolves.toEqual({ inserted: 1, removed: 0 });
    const row = await VitalSample.findOne({ userId: sample.userId });
    expect(row.metric).toBe(metric);
    expect(Number(row.value)).toBe(value);
    expect(row.hrvMethod).toBe(hrvMethod);
    expect(row.healthSampleKey).toBe(sample.sampleKey);
  });

  it('removes the linked projection when HealthKit sends a tombstone', async () => {
    const sample = await activeSample({ sampleKey: '4'.repeat(64) });
    await projectTimeSeriesSample(sample);

    sample.state = 'deleted';
    sample.deletedAt = new Date('2026-10-07T08:00:00Z');
    sample.projectionState = 'pending';
    await sample.save();

    await expect(projectTimeSeriesSample(sample)).resolves.toEqual({ inserted: 0, removed: 1 });
    expect(await BiometricLog.countDocuments({ healthSampleKey: sample.sampleKey })).toBe(0);
  });

  it('removes linked rows from either read model without needing tombstone metric data', async () => {
    const owner = userId();
    const sampleKey = '5'.repeat(64);
    await BiometricLog.create({
      userId: owner,
      heartRate: 70,
      source: 'apple_health',
      recordedAt: new Date(),
      healthSampleKey: sampleKey,
    });
    await VitalSample.create({
      userId: owner,
      metric: 'hrv',
      value: 50,
      source: 'apple_health',
      recordedAt: new Date(),
      healthSampleKey: sampleKey,
      hrvMethod: 'sdnn',
    });

    await expect(removeTimeSeriesProjection(sampleKey, owner)).resolves.toBe(2);
  });
});
