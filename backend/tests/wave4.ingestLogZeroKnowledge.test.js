'use strict';

// W4-D10 — the healthBatch SUCCESS log serialised numeric vitals.
//
// The defect, read off the source (`integrationsController.healthBatchIngest`): every successful
// batch wrote
//
//   [healthBatch] ok accepted=.. inserted=.. rejected=.. profileMetrics={"restingHeartRate":55,"hrv":42,...}
//
// unconditionally to stdout. `profileMetrics` is `aggregateProfileMetrics`' output — the median
// resting heart rate, HRV, respiration rate, SpO2 and the night's sleep-stage minutes. Those are
// GDPR Art.9 special-category numbers, and §0.2.2 admits NO numeric vital in any log. This is a
// strictly wider hole than W4-D03 (same class, but `if (DEBUG)`-gated, so not a production leak).
//
// What the line is actually FOR (#90, the always-on receipt log): "did the batch reach the server,
// and did it persist?" That question is answered by HOW MANY profile scalars landed and WHICH
// metrics they were. The values were never load-bearing for it, so redaction costs nothing
// operationally.
//
// Deliberately NOT changed: `res.json(result)` still returns the real numbers. That is the user's
// own data going back to the authenticated owner over TLS (right of access) — the leak is stdout,
// not the DTO, and `tests/integrations.test.js` pins the response shape as-is.
//
// The vocabulary is CLOSED on purpose — the same lesson `wave4.ingestAccounting.test.js` records
// for `[insertAccounted]`: a log helper that echoes whatever keys it is handed is one malformed
// producer away from being the leak again. `summarizeMetricKeys` NAMES only keys drawn from the
// known metric vocabulary and reports anything else as a bare count.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';

const fs   = require('fs');
const path = require('path');

// Minimal mock set — just enough to load the controller without mongoose (the Node 21 / mongoose 9
// incompatibility `tests/integrations.test.js` documents). No behaviour under test is mocked away.
jest.mock('../app/services/wearable/healthStore', () => ({ ingestBatch: jest.fn() }));
jest.mock('../app/models/User',         () => ({ findByIdAndUpdate: jest.fn().mockResolvedValue(true) }));
jest.mock('../app/models/BiometricLog', () => ({}));
jest.mock('../app/models/MusicProfile', () => ({}));
jest.mock('../app/models/ServeEvent',   () => ({}));

const healthStore = require('../app/services/wearable/healthStore');
const ctrl        = require('../app/controllers/integrationsController');
const { summarizeMetricKeys } = require('../app/utils/biometricAudit');
const { PROFILE_SCALAR_METRICS } = require('../app/services/medicalProfileService');

const CONTROLLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'controllers', 'integrationsController.js'), 'utf8',
);

function buildUser(overrides = {}) {
  return { _id: 'user-123', wearableProvider: 'apple_health', ...overrides };
}
function buildRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

// A realistic aggregate: every distinctive number here is a special-category value and must never
// reach stdout. They are chosen to be searchable as substrings (no digit is a substring of the
// counts the line legitimately carries — see the assertions).
const VITALS = {
  restingHeartRate: 55,
  hrv:              42,
  respirationRate:  14,
  spO2:             97,
  sleepDeep:        137,
  sleepLight:       241,
  sleepRem:         89,
};

// ── The pure helper ────────────────────────────────────────────────────────────
describe('summarizeMetricKeys — values-free summary of a metrics object', () => {
  it('reports the COUNT and the sorted KEY NAMES, and no value anywhere', () => {
    const s = summarizeMetricKeys(VITALS, PROFILE_SCALAR_METRICS);

    expect(s.count).toBe(7);
    expect(s.keys).toBe('hrv,respirationRate,restingHeartRate,sleepDeep,sleepLight,sleepRem,spO2');
    expect(s.unknown).toBe(0);

    // Structural: nothing the helper emits may contain any of the values it was handed.
    const emitted = `${s.count} ${s.keys} ${s.unknown}`;
    for (const v of Object.values(VITALS)) expect(emitted).not.toMatch(new RegExp(`\\b${v}\\b`));
  });

  it('is sorted deterministically regardless of the producer key order', () => {
    const a = summarizeMetricKeys({ spO2: 1, hrv: 2, restingHeartRate: 3 }, PROFILE_SCALAR_METRICS);
    const b = summarizeMetricKeys({ restingHeartRate: 3, spO2: 1, hrv: 2 }, PROFILE_SCALAR_METRICS);
    expect(a).toEqual(b);
    expect(a.keys).toBe('hrv,restingHeartRate,spO2');
  });

  it('CLOSED VOCABULARY: a key outside the allowed list is counted but never NAMED', () => {
    const s = summarizeMetricKeys(
      { restingHeartRate: 55, 'glucose=6.1 mmol/L': 1, 'note: user said 55bpm': 1 },
      PROFILE_SCALAR_METRICS,
    );

    expect(s.count).toBe(3);
    expect(s.keys).toBe('restingHeartRate');   // the two free-form keys are NOT echoed
    expect(s.unknown).toBe(2);
    expect(s.keys).not.toMatch(/glucose|note|6\.1|55/);
  });

  it('degrades to an empty summary on every non-object input rather than throwing', () => {
    for (const bad of [null, undefined, 0, 55, NaN, '', 'restingHeartRate=55', true, [55, 42], () => {}]) {
      const s = summarizeMetricKeys(bad, PROFILE_SCALAR_METRICS);
      expect(s).toEqual({ count: 0, keys: 'none', unknown: 0 });
    }
  });

  it('treats a missing/!empty vocabulary as "name nothing" — fail CLOSED, never open', () => {
    expect(summarizeMetricKeys(VITALS, undefined)).toEqual({ count: 7, keys: 'none', unknown: 7 });
    expect(summarizeMetricKeys(VITALS, [])).toEqual({ count: 7, keys: 'none', unknown: 7 });
  });

  it('accepts a Set as the vocabulary as well as an array', () => {
    expect(summarizeMetricKeys(VITALS, new Set(PROFILE_SCALAR_METRICS)).keys)
      .toBe(summarizeMetricKeys(VITALS, PROFILE_SCALAR_METRICS).keys);
  });
});

// ── The log line the defect lived on ───────────────────────────────────────────
describe('[healthBatch] ok — the always-on ingest receipt', () => {
  let warn;
  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const okLine = () => warn.mock.calls.map(c => c.join(' ')).find(l => l.includes('[healthBatch] ok'));

  it('ZERO-KNOWLEDGE: carries the metric NAMES and counts, never a vital', async () => {
    healthStore.ingestBatch.mockResolvedValue({
      accepted: 9, inserted: 7, rejected: { count: 2, reasons: [] }, profileMetrics: { ...VITALS },
    });

    await ctrl.healthBatchIngest(
      { user: buildUser(), body: { platform: 'healthkit', samples: [] } }, buildRes(), jest.fn(),
    );

    const line = okLine();
    expect(line).toBeDefined();

    // The operational facts survive.
    expect(line).toMatch(/accepted=9/);
    expect(line).toMatch(/inserted=7/);
    expect(line).toMatch(/rejected=2/);
    expect(line).toMatch(/profileMetrics=7\b/);
    expect(line).toMatch(/profileMetricKeys=hrv,respirationRate,restingHeartRate,sleepDeep,sleepLight,sleepRem,spO2/);

    // The vitals do not. Each is checked as a standalone number so `7` (a count) can't alibi `97`.
    for (const v of Object.values(VITALS)) expect(line).not.toMatch(new RegExp(`\\b${v}\\b`));
    // And the shape that caused it is gone.
    expect(line).not.toMatch(/[{}]/);
    expect(line).not.toMatch(/restingHeartRate"?\s*[:=]\s*\d/);
  });

  it('says profileMetrics=0 profileMetricKeys=none when the batch updated no baseline', async () => {
    healthStore.ingestBatch.mockResolvedValue({ accepted: 2, inserted: 2, profileMetrics: {} });

    await ctrl.healthBatchIngest(
      { user: buildUser(), body: { platform: 'health_connect', samples: [] } }, buildRes(), jest.fn(),
    );

    expect(okLine()).toMatch(/profileMetrics=0 profileMetricKeys=none/);
    expect(okLine()).not.toMatch(/unknownProfileKeys/);   // silent unless something was unnameable
  });

  it('survives a service result with no profileMetrics at all', async () => {
    healthStore.ingestBatch.mockResolvedValue({ accepted: 1 });

    await ctrl.healthBatchIngest(
      { user: buildUser(), body: { platform: 'healthkit', samples: [] } }, buildRes(), jest.fn(),
    );

    expect(okLine()).toMatch(/profileMetrics=0 profileMetricKeys=none/);
  });

  it('names an out-of-vocabulary key only as a count, even if the producer regresses', async () => {
    healthStore.ingestBatch.mockResolvedValue({
      accepted: 1, inserted: 1, profileMetrics: { restingHeartRate: 55, 'bloodGlucose 6.1': 1 },
    });

    await ctrl.healthBatchIngest(
      { user: buildUser(), body: { platform: 'healthkit', samples: [] } }, buildRes(), jest.fn(),
    );

    expect(okLine()).toMatch(/profileMetrics=2 profileMetricKeys=restingHeartRate unknownProfileKeys=1/);
    expect(okLine()).not.toMatch(/bloodGlucose|6\.1|\b55\b/);
  });

  it('still returns the real values to the authenticated owner — the DTO is not the leak', async () => {
    const result = { accepted: 1, inserted: 1, profileMetrics: { ...VITALS } };
    healthStore.ingestBatch.mockResolvedValue(result);
    const res = buildRes();

    await ctrl.healthBatchIngest(
      { user: buildUser(), body: { platform: 'healthkit', samples: [] } }, res, jest.fn(),
    );

    expect(res.json).toHaveBeenCalledWith(result);
  });

  // Tripwire: the behavioural pins above are the real guard, but the exact expression that leaked
  // is cheap to forbid by name so a future edit cannot quietly reintroduce it.
  it('TRIPWIRE: the controller never stringifies a metrics/vitals object into a log line', () => {
    expect(CONTROLLER_SRC).not.toMatch(/JSON\.stringify\(\s*(result|res)\??\.?(profileMetrics|vitals)/);
    expect(CONTROLLER_SRC).toMatch(/summarizeMetricKeys\(/);
  });
});
