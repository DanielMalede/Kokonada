'use strict';

// All IDs, dates, values and source/device information in this demo are synthetic.
const HEART_RATE = 'HKQuantityTypeIdentifierHeartRate';
const RESTING_RATE = 'HKQuantityTypeIdentifierRestingHeartRate';
const HRV = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';

function syntheticSample(identifier, suffix, metric) {
  return {
    uuid: `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    startDate: new Date('2026-10-07T10:00:00.000Z'),
    endDate: new Date('2026-10-07T10:30:00.000Z'),
    sourceRevision: {
      source: { name: 'Synthetic source', bundleIdentifier: 'example.synthetic' },
      version: 'synthetic',
      operatingSystemVersion: { majorVersion: 0, minorVersion: 0, patchVersion: 0 },
    },
    device: { name: 'Synthetic device' },
    metadata: { syntheticPrivateNote: 'not included in the server payload' },
    sampleType: {
      identifier, allowsRecalibrationForEstimates: false,
      isMinimumDurationRestricted: false, isMaximumDurationRestricted: false,
    },
    hasUndeterminedDuration: false,
    ...(identifier === SLEEP ? { categoryType: identifier } : { quantityType: identifier }),
    ...metric,
  };
}

function syntheticQuery(identifier, suffix, samples, deletedSamples = []) {
  return {
    identifier,
    batchId: `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    now: new Date('2026-10-08T12:00:00.000Z'),
    result: { samples, deletedSamples, newAnchor: 'synthetic opaque anchor' },
  };
}

function buildSyntheticQueries(scenario) {
  if (scenario === 'empty') return [syntheticQuery(HEART_RATE, 100, [])];
  if (scenario === 'invalid-unit') {
    return [syntheticQuery(HEART_RATE, 100, [
      syntheticSample(HEART_RATE, 1, { quantity: 72, unit: 'bpm' }),
    ])];
  }
  return [
    syntheticQuery(HEART_RATE, 100, [syntheticSample(HEART_RATE, 1, { quantity: 72, unit: 'count/min' })], [
      { uuid: '00000000-0000-4000-8000-000000000099', metadata: { synthetic: 'excluded' } },
    ]),
    syntheticQuery(RESTING_RATE, 101, [syntheticSample(RESTING_RATE, 2, { quantity: 58, unit: 'count/min' })]),
    syntheticQuery(HRV, 102, [syntheticSample(HRV, 3, { quantity: 41.25, unit: 'ms' })]),
    syntheticQuery(SLEEP, 103, [
      syntheticSample(SLEEP, 4, { value: 3 }), syntheticSample(SLEEP, 5, { value: 4 }),
      syntheticSample(SLEEP, 6, { value: 5 }), syntheticSample(SLEEP, 7, { value: 0 }),
      syntheticSample(SLEEP, 8, { value: 1 }), syntheticSample(SLEEP, 9, { value: 2 }),
    ]),
  ];
}

module.exports = { buildSyntheticQueries };
