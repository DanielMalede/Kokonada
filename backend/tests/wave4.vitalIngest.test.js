'use strict';

// W4-004 (wiring half) — the INGEST side: what actually puts rows into VitalSample, and the
// dormant Garmin lanes that stay OFF until consent v2.
//
// The pure core (session 18) built the collection and the engines that read it; until this lands
// nothing writes a single VitalSample row, so `baselineEngine`'s real-HRV path (D1) has no fuel.
//
// Two constraints are load-bearing here and are pinned as such:
//   §0.2.3 — this wave must NEVER widen actual data collection. The metric vocabulary is a
//            consent-v2-ready superset; today only the metrics already collected under consent v1
//            (hrv, restingHeartRate) have a writer. Everything else is behind a capability flag
//            that defaults OFF, so the store-facing "SpO₂ and respiratory rate are NOT collected"
//            declaration stays literally true.
//   S6     — live/batch persistence reuses the `source@recordedAt` dedupe convention so a
//            reconnect or an overlapping backfill chunk cannot double-write.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const mockVitalInsertMany = jest.fn(async (docs) => ({
  acknowledged: true,
  insertedCount: docs.length,
  insertedIds: {},
  mongoose: { validationErrors: [], results: docs },
}));
const mockVitalFind = jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve([]) }) }));

jest.mock('../app/models/VitalSample', () => ({
  find: (...a) => mockVitalFind(...a),
  insertMany: (...a) => mockVitalInsertMany(...a),
}));
jest.mock('../app/models/MedicalProfile', () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
  findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
}));
jest.mock('../app/models/BiometricLog', () => ({
  find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  insertMany: jest.fn(async (docs) => ({
    acknowledged: true,
    insertedCount: docs.length,
    insertedIds: {},
    mongoose: { validationErrors: [], results: docs },
  })),
}));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn().mockResolvedValue(undefined) }));

const metricStore = require('../app/services/wearable/metricStore');
const { persistMetrics, VITAL_METRICS_PERSISTED } = metricStore;
const { normalizeGarminSummaries, normalizeHealthStoreSamples } = require('../app/services/wearable/adapter');
// The REAL schema vocabulary (the model itself is mocked above, so ask for the actual module).
const { VITAL_METRICS } = jest.requireActual('../app/models/VitalSample');

const at = (iso) => new Date(iso);
const insertedVitals = () => mockVitalInsertMany.mock.calls.flatMap(([docs]) => docs);

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WAVE4_CONSENT_V2_METRICS;
  mockVitalFind.mockImplementation(() => ({ select: () => ({ lean: () => Promise.resolve([]) }) }));
});

describe('persistMetrics → VitalSample (the fuel for D1)', () => {
  it('writes hrv and restingHeartRate rows with metric, value, source and recordedAt', async () => {
    await persistMetrics('u1', [
      { metric: 'hrv', value: 84, unit: 'ms', recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      { metric: 'restingHeartRate', value: 49, unit: 'bpm', recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);

    const rows = insertedVitals();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'u1', metric: 'hrv', value: 84, source: 'garmin' }),
      expect.objectContaining({ userId: 'u1', metric: 'restingHeartRate', value: 49, source: 'garmin' }),
    ]));
    expect(rows[0].recordedAt).toBeInstanceOf(Date);
  });

  it('never writes heart-rate or sleep-stage records (those are BiometricLog / MedicalProfile)', async () => {
    await persistMetrics('u1', [
      { metric: 'heartRate', value: 71, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      { metric: 'sleepDeep', value: 90, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);
    expect(insertedVitals()).toHaveLength(0);
  });

  it('carries tzOffsetMinutes through to the row when the sample has one', async () => {
    await persistMetrics('u1', [
      { metric: 'hrv', value: 84, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin', tzOffsetMinutes: -300 },
      { metric: 'restingHeartRate', value: 49, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);
    const rows = insertedVitals();
    expect(rows.find((r) => r.metric === 'hrv').tzOffsetMinutes).toBe(-300);
    // Absent is null, never a fabricated 0 — 0 is a REAL timezone (UTC), so coercing a missing
    // offset to it would silently place every unknown-tz user in London.
    expect(rows.find((r) => r.metric === 'restingHeartRate').tzOffsetMinutes).toBeNull();
  });

  it('rejects an out-of-band tzOffsetMinutes rather than storing it (S6)', async () => {
    await persistMetrics('u1', [
      { metric: 'hrv', value: 84, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin', tzOffsetMinutes: 5000 },
    ]);
    expect(insertedVitals()[0].tzOffsetMinutes).toBeNull();
  });

  it('dedupes on source@recordedAt PER METRIC — a replayed backfill chunk writes nothing twice (S6)', async () => {
    mockVitalFind.mockImplementation(() => ({
      select: () => ({
        lean: () => Promise.resolve([
          { metric: 'hrv', source: 'garmin', recordedAt: at('2026-08-01T07:00:00Z') },
        ]),
      }),
    }));

    await persistMetrics('u1', [
      { metric: 'hrv', value: 84, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      // same instant, DIFFERENT metric — must NOT be swallowed by the hrv key
      { metric: 'restingHeartRate', value: 49, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);

    const rows = insertedVitals();
    expect(rows.map((r) => r.metric)).toEqual(['restingHeartRate']);
  });

  it('collapses duplicate timestamps WITHIN one batch', async () => {
    await persistMetrics('u1', [
      { metric: 'hrv', value: 84, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      { metric: 'hrv', value: 85, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);
    expect(insertedVitals()).toHaveLength(1);
  });

  it('reports vital rows through the same truthful accounting as BiometricLog (W4-D08)', async () => {
    const result = await persistMetrics('u1', [
      { metric: 'hrv', value: 84, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);
    expect(result.vitals).toEqual(expect.objectContaining({ inserted: 1 }));
    expect(result.vitals.rejected).toEqual(expect.objectContaining({ count: 0 }));
  });

  it('a VitalSample write failure never fails the ingest (biometrics still land)', async () => {
    mockVitalInsertMany.mockRejectedValueOnce(new Error('mongo down'));
    const result = await persistMetrics('u1', [
      { metric: 'hrv', value: 84, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      { metric: 'restingHeartRate', value: 49, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);
    expect(result.vitals.inserted).toBe(0);
    expect(result.profileMetrics).toBeTruthy();
  });
});

describe('§0.2.3 — the metric vocabulary is a superset; collection is NOT widened', () => {
  it('persists only metrics already collected under consent v1', () => {
    expect([...VITAL_METRICS_PERSISTED].sort()).toEqual(['hrv', 'restingHeartRate']);
  });

  it('the persisted set is a strict SUBSET of the schema vocabulary', () => {
    for (const m of VITAL_METRICS_PERSISTED) expect(VITAL_METRICS).toContain(m);
    expect(VITAL_METRICS_PERSISTED.length).toBeLessThan(VITAL_METRICS.length);
  });

  it('spO2 and respirationRate have NO writer, even when a normalizer hands them over', async () => {
    await persistMetrics('u1', [
      { metric: 'spO2', value: 97, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      { metric: 'respirationRate', value: 14, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      { metric: 'bodyBattery', value: 70, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      { metric: 'stressLevel', value: 30, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);
    expect(insertedVitals()).toHaveLength(0);
  });

  it('a consent-v2 capability flag is what unlocks a dormant metric — nothing else', async () => {
    process.env.WAVE4_CONSENT_V2_METRICS = 'stressLevel';
    await persistMetrics('u1', [
      { metric: 'stressLevel', value: 30, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
      { metric: 'spO2', value: 97, recordedAt: at('2026-08-01T07:00:00Z'), source: 'garmin' },
    ]);
    expect(insertedVitals().map((r) => r.metric)).toEqual(['stressLevel']);
  });
});

describe('D16 — the dormant Garmin stress lane (normalized, still OFF)', () => {
  const summary = {
    startTimeInSeconds: 1754028000,
    timeOffsetBodyBatteryValues: { 0: 70, 60: 68 },
    timeOffsetStressLevelValues: { 0: 30, 60: 45, 120: -1, 180: -2 },
  };

  it('discards timeOffsetStressLevelValues today (unchanged behaviour, flag OFF)', () => {
    const out = normalizeGarminSummaries('stressDetails', summary);
    expect(out.map((r) => r.metric)).toEqual(['bodyBattery', 'bodyBattery']);
  });

  it('emits stressLevel when the capability flag is on (D16 — the data was being thrown away)', () => {
    process.env.WAVE4_CONSENT_V2_METRICS = 'stressLevel';
    const out = normalizeGarminSummaries('stressDetails', summary);
    const stress = out.filter((r) => r.metric === 'stressLevel');
    expect(stress.map((r) => r.value)).toEqual([30, 45]); // -1/-2 are "unmeasurable" sentinels
    expect(stress[0].source).toBe('garmin');
    expect(stress[0].recordedAt).toBeInstanceOf(Date);
    expect(out.some((r) => r.metric === 'bodyBattery')).toBe(true); // still emitted
  });

  it('never stores Garmin\'s -1/-2 unmeasurable sentinels as data', () => {
    process.env.WAVE4_CONSENT_V2_METRICS = 'stressLevel';
    const out = normalizeGarminSummaries('stressDetails', summary);
    expect(out.every((r) => r.value >= 0)).toBe(true);
  });

  it('emits steps from dailies only behind the flag', () => {
    const dailies = { startTimeInSeconds: 1754028000, steps: 8412, restingHeartRateInBeatsPerMinute: 49 };
    expect(normalizeGarminSummaries('dailies', dailies).map((r) => r.metric)).toEqual(['restingHeartRate']);

    process.env.WAVE4_CONSENT_V2_METRICS = 'steps';
    const out = normalizeGarminSummaries('dailies', dailies);
    expect(out.map((r) => r.metric).sort()).toEqual(['restingHeartRate', 'steps']);
    expect(out.find((r) => r.metric === 'steps').value).toBe(8412);
  });
});

describe('tzOffsetMinutes on the batch lane (additive, optional)', () => {
  it('passes a device-supplied offset through the health-store normalizer', () => {
    const out = normalizeHealthStoreSamples('health_connect', [
      { type: 'hrv', value: 84, startDate: '2026-08-01T07:00:00Z', tzOffsetMinutes: 120 },
    ]);
    expect(out[0].tzOffsetMinutes).toBe(120);
  });

  it('is null (not 0) when the device does not send one — server-hour fallback stays explicit', () => {
    const out = normalizeHealthStoreSamples('health_connect', [
      { type: 'hrv', value: 84, startDate: '2026-08-01T07:00:00Z' },
    ]);
    expect(out[0].tzOffsetMinutes).toBeNull();
  });

  it('drops an out-of-band offset rather than trusting it (S6: [-840, 720])', () => {
    const out = normalizeHealthStoreSamples('health_connect', [
      { type: 'hrv', value: 84, startDate: '2026-08-01T07:00:00Z', tzOffsetMinutes: -900 },
    ]);
    expect(out[0].tzOffsetMinutes).toBeNull();
  });

  it('derives the offset from Garmin\'s startTimeOffsetInSeconds when present', () => {
    const out = normalizeGarminSummaries('hrv', {
      startTimeInSeconds: 1754028000, startTimeOffsetInSeconds: 7200, lastNightAvg: 84,
    });
    expect(out[0].tzOffsetMinutes).toBe(120);
  });
});
