'use strict';

const BiometricLog = require('../../models/BiometricLog');
const VitalSample = require('../../models/VitalSample');

const VITAL_METRIC = Object.freeze({
  resting_heart_rate: 'restingHeartRate',
  hrv: 'hrv',
});

async function insertOnce(Model, document) {
  try {
    await Model.create(document);
    return 1;
  } catch (error) {
    // The unique healthSampleKey index is the concurrency guard. Two workers may race, but
    // the loser observes a successful replay rather than turning it into an ingest failure.
    if (error?.code === 11000) return 0;
    throw error;
  }
}

async function removeTimeSeriesProjection(sampleKey, userId) {
  const selector = { healthSampleKey: sampleKey, userId };
  const [heartRate, vital] = await Promise.all([
    BiometricLog.deleteMany(selector),
    VitalSample.deleteMany(selector),
  ]);
  return heartRate.deletedCount + vital.deletedCount;
}

async function projectTimeSeriesSample(sample) {
  if (sample.state === 'deleted') {
    const removed = await removeTimeSeriesProjection(sample.sampleKey, sample.userId);
    return { inserted: 0, removed };
  }

  if (sample.metric === 'heart_rate') {
    const inserted = await insertOnce(BiometricLog, {
      userId: sample.userId,
      heartRate: Number(sample.value),
      activity: 'unknown',
      source: sample.source,
      recordedAt: sample.startAt,
      tzOffsetMinutes: sample.tzOffsetMinutes ?? null,
      healthSampleKey: sample.sampleKey,
    });
    return { inserted, removed: 0 };
  }

  const metric = VITAL_METRIC[sample.metric];
  if (!metric) return { inserted: 0, removed: 0 };

  const inserted = await insertOnce(VitalSample, {
    userId: sample.userId,
    metric,
    value: Number(sample.value),
    recordedAt: sample.startAt,
    source: sample.source,
    tzOffsetMinutes: sample.tzOffsetMinutes ?? null,
    healthSampleKey: sample.sampleKey,
    hrvMethod: sample.metric === 'hrv' ? sample.method : null,
  });
  return { inserted, removed: 0 };
}

module.exports = {
  projectTimeSeriesSample,
  removeTimeSeriesProjection,
};
