'use strict';

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

function parseHealthBatchRequest(body) {
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
    if (!TYPES.has(sample.type)
      || sample.value == null
      || !Number.isFinite(Number(sample.value))
      || typeof sample.unit !== 'string'
      || sample.unit.length === 0
      || !isIsoDate(sample.startDate)
      || !isIsoDate(sample.endDate)) {
      throw contractError('invalid_health_sample');
    }

    if (sample.tzOffsetMinutes != null) {
      const offset = Number(sample.tzOffsetMinutes);
      if (!Number.isInteger(offset) || offset < -840 || offset > 720) {
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
