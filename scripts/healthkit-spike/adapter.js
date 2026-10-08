'use strict';

// Isolated offline experiment: no production mobile importer or native bridge.
const { parseHealthBatchRequest } = require('../../backend/app/services/wearable/healthBatchContract');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLEEP_IDENTIFIER = 'HKCategoryTypeIdentifierSleepAnalysis';
const QUANTITY_RULES = new Map([
  ['HKQuantityTypeIdentifierHeartRate', { type: 'heart_rate', nativeUnit: 'count/min', unit: 'bpm' }],
  ['HKQuantityTypeIdentifierRestingHeartRate', { type: 'resting_heart_rate', nativeUnit: 'count/min', unit: 'bpm' }],
  ['HKQuantityTypeIdentifierHeartRateVariabilitySDNN', { type: 'hrv', nativeUnit: 'ms', unit: 'ms', method: 'sdnn' }],
]);
const SLEEP_STAGES = new Map([[3, 'sleep_light'], [4, 'sleep_deep'], [5, 'sleep_rem']]);
const EXCLUDED_SLEEP = new Set([0, 1, 2]);

function reject(code) {
  throw Object.assign(new Error(code), { code });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireUuid(record) {
  if (!isRecord(record)) reject('invalid_native_sample');
  if (typeof record.uuid !== 'string' || !UUID_RE.test(record.uuid)) reject('invalid_native_uuid');
}

function requireDates(sample) {
  if (!(sample.startDate instanceof Date) || !(sample.endDate instanceof Date)
    || !Number.isFinite(sample.startDate.getTime()) || !Number.isFinite(sample.endDate.getTime())
    || sample.startDate.getTime() > sample.endDate.getTime()) {
    reject('invalid_native_date');
  }
  return { startDate: sample.startDate.toISOString(), endDate: sample.endDate.toISOString() };
}

/**
 * A single synthetic/documented anchored response -> existing server schemaV2.
 * pendingAnchor is an opaque candidate only: no storage or checkpoint advancement.
 * The caller supplies a batch UUID and a valid Date clock for reproducibility.
 */
function normalizeAnchoredResult({ identifier, result, batchId, now }) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) reject('invalid_probe_clock');
  const quantityRule = QUANTITY_RULES.get(identifier);
  if (!quantityRule && identifier !== SLEEP_IDENTIFIER) reject('unsupported_native_identifier');
  if (!isRecord(result) || !Array.isArray(result.samples) || !Array.isArray(result.deletedSamples)) {
    reject('invalid_native_result');
  }
  if (typeof result.newAnchor !== 'string' || result.newAnchor.length === 0) reject('invalid_native_anchor');
  if (result.samples.length + result.deletedSamples.length > 2000) reject('health_batch_too_large');

  const samples = [];
  const counts = { upserts: 0, deletes: 0, excluded: 0 };
  for (const nativeSample of result.samples) {
    requireUuid(nativeSample);
    const dates = requireDates(nativeSample);
    const base = { sampleId: nativeSample.uuid, operation: 'upsert', ...dates };
    if (quantityRule) {
      if (nativeSample.quantityType !== identifier) reject('unexpected_native_identifier');
      if (nativeSample.unit !== quantityRule.nativeUnit) reject('unexpected_native_unit');
      if (typeof nativeSample.quantity !== 'number' || !Number.isFinite(nativeSample.quantity)) {
        reject('invalid_native_sample');
      }
      samples.push({
        ...base, type: quantityRule.type, value: nativeSample.quantity, unit: quantityRule.unit,
        ...(quantityRule.method ? { method: quantityRule.method } : {}),
      });
    } else {
      if (nativeSample.categoryType !== identifier) reject('unexpected_native_identifier');
      if (EXCLUDED_SLEEP.has(nativeSample.value)) {
        counts.excluded += 1;
        continue;
      }
      const type = SLEEP_STAGES.get(nativeSample.value);
      if (!type) reject('invalid_native_sample');
      samples.push({
        ...base, type, value: (nativeSample.endDate.getTime() - nativeSample.startDate.getTime()) / 60000,
        unit: 'min',
      });
    }
    counts.upserts += 1;
  }
  // Deletions come last, including when a UUID also occurs in this response's samples.
  for (const deletedSample of result.deletedSamples) {
    requireUuid(deletedSample);
    samples.push({ sampleId: deletedSample.uuid, operation: 'delete' });
    counts.deletes += 1;
  }

  const payload = { schemaVersion: 2, platform: 'healthkit', batchId, samples };
  // Use the actual server gate for HR range, HRV SDNN, future skew and sleep limits.
  parseHealthBatchRequest(payload, { now });
  return {
    payload, pendingAnchor: result.newAnchor, counts,
    readOutcome: samples.length === 0 ? 'no-visible-data' : 'visible-operations',
  };
}

module.exports = { normalizeAnchoredResult };
