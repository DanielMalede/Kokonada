'use strict';

const { parseHealthBatchRequest } = require('../app/services/wearable/healthBatchContract');

const batchId = '550e8400-e29b-41d4-a716-446655440000';
const sampleId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const at = '2026-10-06T06:30:00.000Z';
const now = new Date('2026-10-06T06:30:00.000Z');

function v2Sample(overrides = {}) {
  return {
    sampleId,
    operation: 'upsert',
    type: 'heart_rate',
    value: 72,
    unit: 'bpm',
    startDate: at,
    endDate: at,
    tzOffsetMinutes: 180,
    ...overrides,
  };
}

function v2Body(overrides = {}) {
  return {
    schemaVersion: 2,
    batchId,
    platform: 'healthkit',
    samples: [v2Sample()],
    ...overrides,
  };
}

function expectContractError(body, code, statusCode, options) {
  try {
    parseHealthBatchRequest(body, options);
    throw new Error('expected parseHealthBatchRequest to throw');
  } catch (error) {
    expect(error).toMatchObject({ code, statusCode });
    expect(error.message).not.toContain('72');
    expect(error.message).not.toContain(sampleId);
  }
}

describe('parseHealthBatchRequest', () => {
  it('passes the legacy Health Connect request through without changing its samples', () => {
    const samples = [{ type: 'heart_rate', value: 64, startDate: at }];

    const result = parseHealthBatchRequest({ platform: 'health_connect', samples });

    expect(result).toEqual({ version: 1, platform: 'health_connect', batchId: null, samples });
    expect(result.samples).toBe(samples);
  });

  it('accepts a v2 HealthKit batch with heart rate and SDNN HRV', () => {
    const samples = [
      v2Sample(),
      v2Sample({
        sampleId: '6ba7b811-9dad-41d1-80b4-00c04fd430c8',
        type: 'hrv',
        value: 48,
        unit: 'ms',
        method: 'sdnn',
      }),
    ];

    const result = parseHealthBatchRequest(v2Body({ samples }));

    expect(result).toEqual({ version: 2, platform: 'healthkit', batchId, samples });
    expect(result.samples).toBe(samples);
  });

  it('rejects an unknown schema version instead of treating it as legacy', () => {
    expectContractError(v2Body({ schemaVersion: 3 }), 'unsupported_health_schema_version', 400);
  });

  it('rejects a malformed batch UUID', () => {
    expectContractError(v2Body({ batchId: 'not-a-uuid' }), 'invalid_health_batch', 400);
  });

  it('rejects a malformed sample UUID', () => {
    expectContractError(
      v2Body({ samples: [v2Sample({ sampleId: 'not-a-uuid' })] }),
      'invalid_health_sample',
      400,
      { now },
    );
  });

  it('rejects an invalid sample timestamp', () => {
    expectContractError(
      v2Body({ samples: [v2Sample({ startDate: 'not-a-date' })] }),
      'invalid_health_sample',
      400,
    );
  });

  it.each([
    ['a numeric string', { value: '72' }],
    ['whitespace', { value: ' ' }],
    ['a non-canonical heart-rate unit', { unit: 'kg' }],
    ['heart rate below the physiological floor', { value: 29 }],
    ['heart rate above the physiological ceiling', { value: 221 }],
  ])('rejects %s', (_label, overrides) => {
    expectContractError(
      v2Body({ samples: [v2Sample(overrides)] }),
      'invalid_health_sample',
      400,
    );
  });

  it.each([
    ['resting_heart_rate', 60, 'ms'],
    ['hrv', 48, 'bpm'],
    ['sleep_deep', 60, 'bpm'],
  ])('rejects a non-canonical unit for %s', (type, value, unit) => {
    const method = type === 'hrv' ? 'sdnn' : undefined;
    expectContractError(
      v2Body({ samples: [v2Sample({ type, value, unit, method })] }),
      'invalid_health_sample',
      400,
    );
  });

  it.each([
    ['hrv', 0, 'ms', 'sdnn'],
    ['hrv', 1001, 'ms', 'sdnn'],
    ['sleep_deep', 0, 'min', undefined],
    ['sleep_rem', 1441, 'min', undefined],
  ])('rejects an out-of-range %s value', (type, value, unit, method) => {
    expectContractError(
      v2Body({ samples: [v2Sample({ type, value, unit, method })] }),
      'invalid_health_sample',
      400,
    );
  });

  it('rejects an interval whose start is after its end', () => {
    expectContractError(
      v2Body({ samples: [v2Sample({
        startDate: '2026-10-06T06:31:00.000Z',
        endDate: '2026-10-06T06:30:00.000Z',
      })] }),
      'invalid_health_sample',
      400,
      { now },
    );
  });

  it('rejects a sample more than five minutes in the future but accepts the boundary', () => {
    expectContractError(
      v2Body({ samples: [v2Sample({
        startDate: '2026-10-06T06:35:00.001Z',
        endDate: '2026-10-06T06:35:00.001Z',
      })] }),
      'invalid_health_sample',
      400,
      { now },
    );

    expect(parseHealthBatchRequest(v2Body({ samples: [v2Sample({
      startDate: '2026-10-06T06:35:00.000Z',
      endDate: '2026-10-06T06:35:00.000Z',
    })] }), { now })).toMatchObject({ version: 2 });
  });

  it('rejects a date-only value instead of accepting it as an ISO timestamp', () => {
    expectContractError(
      v2Body({ samples: [v2Sample({ startDate: '2026-10-06' })] }),
      'invalid_health_sample',
      400,
    );
  });

  it('rejects a fractional timezone offset', () => {
    expectContractError(
      v2Body({ samples: [v2Sample({ tzOffsetMinutes: 5.5 })] }),
      'invalid_health_sample',
      400,
    );
  });

  it('rejects more than 2000 samples', () => {
    const samples = Array.from({ length: 2001 }, (_, index) => v2Sample({
      sampleId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));

    expectContractError(v2Body({ samples }), 'health_batch_too_large', 400);
  });

  it('accepts exactly 2000 samples', () => {
    const samples = Array.from({ length: 2000 }, (_, index) => v2Sample({
      sampleId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));

    expect(parseHealthBatchRequest(v2Body({ samples }))).toMatchObject({
      version: 2,
      batchId,
      samples,
    });
  });

  it('rejects HealthKit HRV labeled as RMSSD', () => {
    expectContractError(
      v2Body({ samples: [v2Sample({ type: 'hrv', unit: 'ms', method: 'rmssd' })] }),
      'invalid_hrv_method',
      400,
    );
  });

  it('rejects Health Connect HRV labeled as SDNN', () => {
    expectContractError(
      v2Body({
        platform: 'health_connect',
        samples: [v2Sample({ type: 'hrv', unit: 'ms', method: 'sdnn' })],
      }),
      'invalid_hrv_method',
      400,
    );
  });

  it('rejects an unrecognized metric type', () => {
    expectContractError(
      v2Body({ samples: [v2Sample({ type: 'blood_glucose' })] }),
      'invalid_health_sample',
      400,
    );
  });

  it('accepts a mixed batch whose delete carries only identity and operation', () => {
    const samples = [
      v2Sample(),
      {
        sampleId: '6ba7b812-9dad-41d1-80b4-00c04fd430c8',
        operation: 'delete',
      },
    ];

    expect(parseHealthBatchRequest(v2Body({ samples }))).toEqual({
      version: 2,
      platform: 'healthkit',
      batchId,
      samples,
    });
  });
});
