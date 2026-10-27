'use strict';

const { isPhysiologicalHR } = require('./hrRange');
// The one allowance every ingest boundary gives a fast device clock (BE-206): defined in adapter.js.
const { MAX_FUTURE_SKEW_MS } = require('./adapter');

const MAX_BATCH = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PLATFORMS = new Set(['healthkit', 'health_connect']);
const TYPES = new Set([
  'heart_rate',
  'resting_heart_rate',
  'hrv',
  'sleep_deep',
  'sleep_light',
  'sleep_rem',
]);
const SLEEP_TYPES = new Set(['sleep_deep', 'sleep_light', 'sleep_rem']);
const MAX_SLEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SLEEP_DURATION_TOLERANCE_MINUTES = 1 / 60;
const METRIC_RULES = Object.freeze({
  heart_rate: { unit: 'bpm', valid: isPhysiologicalHR },
  resting_heart_rate: { unit: 'bpm', valid: isPhysiologicalHR },
  hrv: { unit: 'ms', valid: (value) => value > 0 && value <= 1000 },
  sleep_deep: { unit: 'min', valid: (value) => value > 0 && value <= 1440 },
  sleep_light: { unit: 'min', valid: (value) => value > 0 && value <= 1440 },
  sleep_rem: { unit: 'min', valid: (value) => value > 0 && value <= 1440 },
});

function contractError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function isIsoDate(value) {
  return typeof value === 'string'
    && ISO_TIMESTAMP_RE.test(value)
    && Number.isFinite(Date.parse(value));
}

function validatePlatform(platform) {
  if (!PLATFORMS.has(platform)) throw contractError('invalid_health_platform');
}

function parseHealthBatchRequest(body, { now = new Date() } = {}) {
  const input = body && typeof body === 'object' ? body : {};
  validatePlatform(input.platform);

  if (input.schemaVersion == null) {
    return {
      version: 1,
      platform: input.platform,
      batchId: null,
      samples: input.samples,
    };
  }

  if (input.schemaVersion !== 2) {
    throw contractError('unsupported_health_schema_version');
  }
  if (!UUID_RE.test(input.batchId || '') || !Array.isArray(input.samples)) {
    throw contractError('invalid_health_batch');
  }
  if (input.samples.length > MAX_BATCH) {
    throw contractError('health_batch_too_large');
  }

  for (const sample of input.samples) {
    if (!sample || typeof sample !== 'object'
      || !UUID_RE.test(sample.sampleId || '')
      || (sample.operation !== 'upsert' && sample.operation !== 'delete')) {
      throw contractError('invalid_health_sample');
    }
  }

  for (const sample of input.samples) {
    if (sample.operation === 'delete') continue;
    const rule = METRIC_RULES[sample.type];
    const startMs = Date.parse(sample.startDate);
    const endMs = Date.parse(sample.endDate);
    if (!TYPES.has(sample.type)
      || typeof sample.value !== 'number'
      || !Number.isFinite(sample.value)
      || !rule
      || sample.unit !== rule.unit
      || !rule.valid(sample.value)
      || !isIsoDate(sample.startDate)
      || !isIsoDate(sample.endDate)
      || startMs > endMs
      || endMs > now.getTime() + MAX_FUTURE_SKEW_MS) {
      throw contractError('invalid_health_sample');
    }

    if (sample.tzOffsetMinutes != null) {
      const offset = Number(sample.tzOffsetMinutes);
      if (!Number.isInteger(offset) || offset < -840 || offset > 720) {
        throw contractError('invalid_health_sample');
      }
    }

    if (SLEEP_TYPES.has(sample.type)) {
      const intervalMs = endMs - startMs;
      const intervalMinutes = intervalMs / 60000;
      if (intervalMs <= 0
        || intervalMs > MAX_SLEEP_INTERVAL_MS
        || Math.abs(sample.value - intervalMinutes) > SLEEP_DURATION_TOLERANCE_MINUTES) {
        throw contractError('invalid_health_sample');
      }
    }

    if (sample.type === 'hrv') {
      const expectedMethod = input.platform === 'healthkit' ? 'sdnn' : 'rmssd';
      if (sample.method !== expectedMethod) throw contractError('invalid_hrv_method');
    } else if (sample.method != null) {
      throw contractError('invalid_health_sample');
    }
  }

  return {
    version: 2,
    platform: input.platform,
    batchId: input.batchId,
    samples: input.samples,
  };
}

module.exports = { parseHealthBatchRequest };
