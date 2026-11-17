'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { parseHealthBatchRequest } = require('../app/services/wearable/healthBatchContract');

const spikeRoot = path.resolve(__dirname, '../../scripts/healthkit-spike');
const now = new Date('2026-10-08T12:00:00.000Z');
const batchId = '00000000-0000-4000-8000-000000000100';
const sampleId = '00000000-0000-4000-8000-000000000001';
const deletedId = '00000000-0000-4000-8000-000000000099';
const heartRate = 'HKQuantityTypeIdentifierHeartRate';
const restingRate = 'HKQuantityTypeIdentifierRestingHeartRate';
const hrv = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
const sleep = 'HKCategoryTypeIdentifierSleepAnalysis';

// Every object here is synthetic. No bridge, device, network or database is mocked.
function syntheticSample(identifier = heartRate, fields = {}) {
  return {
    uuid: sampleId,
    startDate: new Date('2026-10-07T10:00:00.000Z'),
    endDate: new Date('2026-10-07T10:30:00.000Z'),
    sampleType: {
      identifier, allowsRecalibrationForEstimates: false,
      isMinimumDurationRestricted: false, isMaximumDurationRestricted: false,
    },
    hasUndeterminedDuration: false,
    sourceRevision: {
      source: { name: 'Synthetic source', bundleIdentifier: 'example.synthetic' },
      version: 'synthetic',
      operatingSystemVersion: { majorVersion: 0, minorVersion: 0, patchVersion: 0 },
    },
    device: { name: 'Synthetic device' },
    metadata: { syntheticPrivateNote: 'must not cross the adapter' },
    ...(identifier === sleep
      ? { categoryType: sleep, value: 3 }
      : { quantityType: identifier, quantity: 72, unit: 'count/min' }),
    ...fields,
  };
}

function syntheticResult(samples = [syntheticSample()], fields = {}) {
  return { samples, deletedSamples: [], newAnchor: 'synthetic opaque anchor', ...fields };
}

function normalize(result = syntheticResult(), identifier = heartRate, options = {}) {
  const { normalizeAnchoredResult } = require(path.join(spikeRoot, 'adapter.js'));
  return normalizeAnchoredResult({ identifier, result, batchId, now, ...options });
}

function runCli(...args) {
  return spawnSync(process.execPath, [path.join(spikeRoot, 'cli.js'), ...args], {
    encoding: 'utf8', timeout: 10000,
  });
}

describe('synthetic offline HealthKit contract probe', () => {
  // Catches a CLI that cannot run or reports success without contract validation.
  test('demo CLI accepts synthetic samples and reports only aggregates', () => {
    const run = runCli('--scenario', 'demo');
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const report = JSON.parse(run.stdout);
    expect(report).toMatchObject({
      fixture: 'synthetic', verdict: 'contract-compatible', nativePathVerified: false,
      counts: { queries: 4, upserts: 6, deletes: 1, excluded: 3 },
      anchorPersisted: false,
    });
    expect(report.limitations).toEqual(expect.arrayContaining([
      'native-library-not-installed', 'device-read-unverified', 'permission-state-unknown',
    ]));
    expect(run.stdout).not.toMatch(/00000000-|2026-|synthetic opaque anchor|Synthetic source|"payload"|"value"|"pendingAnchor"/);
  });

  // Catches coercion, changed UUID identity, wrong time/unit or metadata leakage.
  test.each([
    [heartRate, 72, 'count/min', 'heart_rate', 'bpm', {}],
    [restingRate, 58, 'count/min', 'resting_heart_rate', 'bpm', {}],
    [hrv, 41.25, 'ms', 'hrv', 'ms', { method: 'sdnn' }],
  ])('maps %s exactly into schemaV2 and preserves native identity', (identifier, quantity, unit, type, outputUnit, extra) => {
    const input = syntheticResult([syntheticSample(identifier, { quantity, unit })]);
    const output = normalize(input, identifier);
    expect(output.payload).toEqual({
      schemaVersion: 2, platform: 'healthkit', batchId,
      samples: [{
        sampleId, operation: 'upsert', type, value: quantity, unit: outputUnit,
        startDate: '2026-10-07T10:00:00.000Z', endDate: '2026-10-07T10:30:00.000Z', ...extra,
      }],
    });
    expect(parseHealthBatchRequest(output.payload, { now })).toEqual({
      version: 2, platform: 'healthkit', batchId, samples: output.payload.samples,
    });
    expect(output.pendingAnchor).toBe('synthetic opaque anchor');
    expect(output.counts).toEqual({ upserts: 1, deletes: 0, excluded: 0 });
    expect(normalize(input, identifier).payload).toEqual(output.payload);
    expect(input.samples[0].sourceRevision.source.name).toBe('Synthetic source');
  });

  // Catches treating unspecified sleep as core or calculating duration incorrectly.
  test.each([[3, 'sleep_light'], [4, 'sleep_deep'], [5, 'sleep_rem']])(
    'maps sleep category %i into %s with duration derived from dates', (value, type) => {
      const output = normalize(syntheticResult([syntheticSample(sleep, { value })]), sleep);
      expect(output.payload.samples).toEqual([{
        sampleId, operation: 'upsert', type, value: 30, unit: 'min',
        startDate: '2026-10-07T10:00:00.000Z', endDate: '2026-10-07T10:30:00.000Z',
      }]);
    },
  );

  test.each([0, 1, 2])('excludes known non-stage sleep category %i without inventing data', (value) => {
    const output = normalize(syntheticResult([syntheticSample(sleep, { value })]), sleep);
    expect(output.payload.samples).toEqual([]);
    expect(output.counts).toEqual({ upserts: 0, deletes: 0, excluded: 1 });
    expect(output.readOutcome).toBe('no-visible-data');
  });

  // Catches dropping deleted-only UUIDs or reversing an upsert/delete conflict.
  test('preserves deleted identities without originals and emits deletions after upserts', () => {
    const output = normalize(syntheticResult(undefined, {
      deletedSamples: [{ uuid: sampleId, metadata: { private: 'discard' } }, { uuid: deletedId }],
    }));
    expect(output.payload.samples.map(({ sampleId: id, operation }) => ({ sampleId: id, operation })))
      .toEqual([
        { sampleId, operation: 'upsert' }, { sampleId, operation: 'delete' },
        { sampleId: deletedId, operation: 'delete' },
      ]);
    expect(output.payload.samples[1]).toEqual({ sampleId, operation: 'delete' });
    expect(output.counts).toEqual({ upserts: 1, deletes: 2, excluded: 0 });
  });

  test('accepts a deleted-only response without fabricating metrics', () => {
    const output = normalize(syntheticResult([], { deletedSamples: [{ uuid: deletedId }] }));
    expect(output.payload.samples).toEqual([{ sampleId: deletedId, operation: 'delete' }]);
    expect(output.readOutcome).toBe('visible-operations');
  });

  // Catches lowercasing or regenerating native identities (server IDs preserve spelling).
  test('preserves uppercase-letter UUID spelling for both upserts and deletions', () => {
    const input = syntheticResult([syntheticSample(heartRate, {
      uuid: 'ABCDEF01-ABCD-4ABC-8ABC-ABCDEF012345',
    })], { deletedSamples: [{ uuid: 'ABCDEF01-ABCD-4ABC-8ABC-ABCDEF012345' }] });
    expect(normalize(input).payload.samples.map(({ sampleId: id }) => id)).toEqual([
      'ABCDEF01-ABCD-4ABC-8ABC-ABCDEF012345', 'ABCDEF01-ABCD-4ABC-8ABC-ABCDEF012345',
    ]);
  });

  // Catches in-place filtering, sorting, field deletion or mutation of native Date objects.
  test('leaves native samples, arrays and Date values unmodified', () => {
    const nativeSample = Object.freeze(syntheticSample());
    const deleted = Object.freeze({ uuid: deletedId, metadata: { syntheticPrivate: 'preserve locally' } });
    const input = Object.freeze(syntheticResult(Object.freeze([nativeSample]), {
      deletedSamples: Object.freeze([deleted]),
    }));
    const snapshot = JSON.stringify(input);
    normalize(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input.samples[0]).toBe(nativeSample);
    expect(input.deletedSamples[0]).toBe(deleted);
    expect(nativeSample.startDate.toISOString()).toBe('2026-10-07T10:00:00.000Z');
    expect(nativeSample.endDate.toISOString()).toBe('2026-10-07T10:30:00.000Z');
  });

  test('empty results stay no-visible-data with no permission verdict or checkpoint', () => {
    expect(normalize(syntheticResult([]))).toEqual({
      payload: { schemaVersion: 2, platform: 'healthkit', batchId, samples: [] },
      pendingAnchor: 'synthetic opaque anchor',
      counts: { upserts: 0, deletes: 0, excluded: 0 }, readOutcome: 'no-visible-data',
    });
  });

  test('uses a strict output whitelist even with arbitrary native extras', () => {
    const output = normalize(syntheticResult([syntheticSample(heartRate, {
      operation: 'delete', method: 'rmssd', tzOffsetMinutes: 123,
      patientId: 'synthetic-private-patient', arbitrary: { nested: 'private' },
    })], { authorizationStatus: 'denied', device: 'private' }));
    expect(Object.keys(output.payload).sort()).toEqual(['batchId', 'platform', 'samples', 'schemaVersion']);
    expect(Object.keys(output.payload.samples[0]).sort()).toEqual([
      'endDate', 'operation', 'sampleId', 'startDate', 'type', 'unit', 'value',
    ]);
    expect(JSON.stringify(output)).not.toMatch(/patient|private|sourceRevision|device|metadata|authorizationStatus|tzOffsetMinutes|rmssd/);
  });

  // Catches loose native-shape checks before any upload would be constructed.
  test.each([
    ['null result', null], ['array result', []],
    ['missing samples', { deletedSamples: [], newAnchor: 'synthetic' }],
    ['non-array samples', { samples: {}, deletedSamples: [], newAnchor: 'synthetic' }],
    ['missing deletions', { samples: [], newAnchor: 'synthetic' }],
    ['non-array deletions', { samples: [], deletedSamples: {}, newAnchor: 'synthetic' }],
    ['missing anchor', { samples: [], deletedSamples: [] }],
    ['null anchor', syntheticResult([], { newAnchor: null })],
    ['number anchor', syntheticResult([], { newAnchor: 42 })],
    ['empty anchor', syntheticResult([], { newAnchor: '' })],
  ])('rejects %s', (_name, input) => { expect(() => normalize(input)).toThrow(/invalid_native_result|invalid_native_anchor/); });

  test.each([
    ['null sample', null], ['array sample', []],
    ['missing UUID', syntheticSample(heartRate, { uuid: undefined })],
    ['malformed UUID', syntheticSample(heartRate, { uuid: 'synthetic-invalid-uuid' })],
    ['numeric UUID', syntheticSample(heartRate, { uuid: 1 })],
    ['wrong quantity identifier', syntheticSample(restingRate)],
    ['nonfinite quantity', syntheticSample(heartRate, { quantity: NaN })],
    ['infinite quantity', syntheticSample(heartRate, { quantity: Infinity })],
    ['numeric string', syntheticSample(heartRate, { quantity: '72' })],
    ['missing start', syntheticSample(heartRate, { startDate: undefined })],
    ['string date', syntheticSample(heartRate, { startDate: '2026-10-07T10:00:00.000Z' })],
    ['invalid date', syntheticSample(heartRate, { startDate: new Date(NaN) })],
    ['missing end', syntheticSample(heartRate, { endDate: undefined })],
    ['reversed interval', syntheticSample(heartRate, { endDate: new Date('2026-10-07T09:59:59Z') })],
    ['unexpected HR unit', syntheticSample(heartRate, { unit: 'bpm' })],
  ])('rejects native sample with %s', (_name, sample) => {
    expect(() => normalize(syntheticResult([sample]))).toThrow(/invalid_native_sample|invalid_native_uuid|invalid_native_date|unexpected_native_identifier|unexpected_native_unit/);
  });

  test.each([null, [], {}, { uuid: 'bad' }, { uuid: 1 }])('rejects malformed deleted sample %p', (deleted) => {
    expect(() => normalize(syntheticResult([], { deletedSamples: [deleted] }))).toThrow(/invalid_native_sample|invalid_native_uuid/);
  });

  test.each(['HKQuantityTypeIdentifierStepCount', undefined, '__proto__'])('rejects unsupported query identifier %p', (identifier) => {
    const { normalizeAnchoredResult } = require(path.join(spikeRoot, 'adapter.js'));
    expect(() => normalizeAnchoredResult({ identifier, result: syntheticResult(), batchId, now })).toThrow('unsupported_native_identifier');
  });

  test.each([
    ['unexpected HRV seconds', hrv, { unit: 's', quantity: 0.041 }],
    ['wrong sleep identifier', sleep, { categoryType: 'HKCategoryTypeIdentifierOther' }],
    ['unknown sleep category', sleep, { value: 6 }],
    ['fractional sleep category', sleep, { value: 3.5 }],
    ['string sleep category', sleep, { value: '3' }],
    ['invalid skipped sleep UUID', sleep, { value: 1, uuid: 'bad' }],
  ])('rejects %s', (_name, identifier, fields) => {
    expect(() => normalize(syntheticResult([syntheticSample(identifier, fields)]), identifier))
      .toThrow(/unexpected_native_unit|unexpected_native_identifier|invalid_native_sample|invalid_native_uuid/);
  });

  // These assertions exercise the existing real server constraints, not a copied validator.
  test.each([
    ['HR above server range', heartRate, { quantity: 221 }],
    ['HR below server range', heartRate, { quantity: 29 }],
    ['HRV zero', hrv, { quantity: 0, unit: 'ms' }],
    ['HRV over server maximum', hrv, { quantity: 1001, unit: 'ms' }],
    ['zero sleep interval', sleep, { endDate: new Date('2026-10-07T10:00:00Z') }],
    ['sleep beyond 24 hours', sleep, { endDate: new Date('2026-10-08T10:01:00Z') }],
    ['future end date', heartRate, { endDate: new Date('2026-10-08T12:05:00.001Z') }],
  ])('honors server rejection for %s', (_name, identifier, fields) => {
    expect(() => normalize(syntheticResult([syntheticSample(identifier, fields)]), identifier))
      .toThrow('invalid_health_sample');
  });

  test('retains the server future-skew boundary', () => {
    const output = normalize(syntheticResult([syntheticSample(heartRate, {
      endDate: new Date('2026-10-08T12:05:00.000Z'),
    })]));
    expect(output.payload.samples[0].endDate).toBe('2026-10-08T12:05:00.000Z');
  });

  test('accepts exactly 2000 operations', () => {
    const output = normalize(syntheticResult([], {
      deletedSamples: Array.from({ length: 2000 }, () => ({ uuid: deletedId })),
    }));
    expect(output.counts.deletes).toBe(2000);
    expect(output.payload.samples).toHaveLength(2000);
  });

  test('rejects more than 2000 incoming operations including excluded sleep', () => {
    expect(() => normalize(syntheticResult([syntheticSample(sleep, { value: 1 })], {
      deletedSamples: Array.from({ length: 2000 }, () => ({ uuid: deletedId })),
    }), sleep)).toThrow('health_batch_too_large');
  });

  test.each([undefined, '', 'bad-batch', 1])('rejects malformed or missing batch ID %p', (invalidBatchId) => {
    expect(() => normalize(syntheticResult([]), heartRate, { batchId: invalidBatchId })).toThrow('invalid_health_batch');
  });

  // Catches server-regex coercion allowing an arbitrary object into payload.batchId.
  test.each([
    ['coercible object', { toString: () => batchId, metadata: 'synthetic arbitrary metadata' }],
    ['boxed string', new String(batchId)],
    ['array', [batchId]],
  ])('rejects nonprimitive batch ID represented by %s', (_name, invalidBatchId) => {
    expect(() => normalize(syntheticResult([]), heartRate, { batchId: invalidBatchId }))
      .toThrow('invalid_health_batch');
  });

  test.each([new Date(NaN), '2026-10-08', undefined])('rejects invalid explicit clock %p', (invalidNow) => {
    expect(() => normalize(syntheticResult(), heartRate, { now: invalidNow })).toThrow('invalid_probe_clock');
  });

  test('CLI distinguishes empty visible data without claiming permission denial', () => {
    const run = runCli('--scenario', 'empty');
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      fixture: 'synthetic', verdict: 'no-visible-data', nativePathVerified: false,
      counts: { queries: 1, upserts: 0, deletes: 0, excluded: 0 },
    });
    expect(run.stdout).not.toMatch(/denied|authorized|00000000-|synthetic opaque anchor/);
  });

  test('CLI reports aggregate rejection and exits one for incompatible synthetic unit', () => {
    const run = runCli('--scenario', 'invalid-unit');
    expect(run.status).toBe(1);
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toMatchObject({
      fixture: 'synthetic', verdict: 'rejected', code: 'unexpected_native_unit', nativePathVerified: false,
    });
    expect(run.stdout).not.toMatch(/00000000-|2026-|"value"|"unit"|pendingAnchor/);
  });

  test.each([['--scenario', 'unknown'], ['--input', 'some-private-file'], ['--scenario']])(
    'CLI refuses unsupported invocation %p with exit two', (...args) => {
      const run = runCli(...args);
      expect(run.status).toBe(2);
      expect(run.stderr).toBe('');
      expect(JSON.parse(run.stdout)).toMatchObject({ verdict: 'usage-error', code: 'invalid_arguments' });
    },
  );
});
