'use strict';

// W4-004 (wiring half) — where D1 actually reaches the serving path.
//
// The pure core (session 18) built `baselineEngine`; nothing called it. `computeBaselines` still
// returned `{rhrMedian, rhrMAD}` and `translate()` still z-scored EVERY user's HRV against the
// population constant {45, 8}. This suite pins the delegation, the superset cache blob, the
// stale-while-revalidate peek (D15's other half), the Karvonen zone write-back, and the S11
// kill-switch that restores the old behaviour without a revert.
//
// Superset contract (§0.2.5): every legacy key keeps its exact meaning. Values improve — that is
// the entire point of the task — but no consumer may find a key missing.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/models/BiometricLog', () => ({ find: jest.fn() }));
jest.mock('../app/models/VitalSample', () => ({ find: jest.fn() }));
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../app/utils/biometricAudit', () => {
  const { decrypt } = jest.requireActual('../app/utils/encryption');
  return {
    logBiometricAccess: jest.fn(),
    auditedDecrypt: jest.fn((userId, purpose, blob, opts = {}) =>
      decrypt(blob, opts.parseJson ?? false, userId == null ? null : String(userId))),
  };
});

const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const { getRedis } = require('../app/config/redis');
const { enqueue } = require('../app/queues/queue');
const { logBiometricAccess } = require('../app/utils/biometricAudit');
const { decrypt } = require('../app/utils/encryption');
const baselines = require('../app/services/biosonic/baselines');
const { POPULATION } = require('../app/agents/runtime/physiology/baselineEngine');
const { HRV_FALLBACK } = require('../app/services/biosonic/translate');

const DAY = 86400000;
const NOW = Date.parse('2026-08-19T12:00:00Z');

/** Pageable mock: first call serves the batch, subsequent calls end the pagination. */
function mockPages(model, ...batches) {
  model.find.mockReset();
  for (const batch of batches) {
    model.find.mockImplementationOnce(() => ({ sort: () => ({ limit: () => Promise.resolve(batch) }) }));
  }
  model.find.mockImplementation(() => ({ sort: () => ({ limit: () => Promise.resolve([]) }) }));
}

/** N days of a persona: a nocturnal trough at `rest` bpm, daytime activity, and a daily workout. */
function personaHr({ days = 30, rest = 48, workout = 165, from = NOW - 30 * DAY } = {}) {
  const rows = [];
  let i = 0;
  for (let d = 0; d < days; d++) {
    const midnight = from + d * DAY;
    // Nocturnal window 00:00-06:00 — the trough. Deliberately the MINORITY of the day's rows,
    // which is what a real all-day watch stream looks like: if the trough were the majority a
    // naive median over everything would find it by accident and this persona would not
    // discriminate between the old estimator and the new one.
    for (let h = 0; h < 6; h++) {
      rows.push({
        _id: `n${i++}`, heartRate: rest + (h % 3), activity: 'unknown',
        recordedAt: new Date(midnight + h * 3600000),
      });
    }
    // daytime: ordinary living, well above the trough — the majority of the day
    for (let h = 8; h < 20; h++) {
      rows.push({
        _id: `d${i++}`, heartRate: rest + 22 + (h % 5), activity: 'unknown',
        recordedAt: new Date(midnight + h * 3600000),
      });
    }
    // D2/D3: the workout is written with activity 'unknown', exactly as the batch lane writes it
    for (let k = 0; k < 8; k++) {
      rows.push({
        _id: `w${i++}`, heartRate: workout + (k % 4), activity: 'unknown',
        recordedAt: new Date(midnight + 18 * 3600000 + k * 300000),
      });
    }
  }
  return rows;
}

function personaHrv({ days = 30, value = 85, from = NOW - 30 * DAY } = {}) {
  return Array.from({ length: days }, (_, d) => ({
    _id: `v${d}`, metric: 'hrv', value: value + (d % 5) - 2,
    recordedAt: new Date(from + d * DAY + 6 * 3600000), source: 'garmin', tzOffsetMinutes: null,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  delete process.env.WAVE4_BASELINE_ENGINE_DISABLED;
  getRedis.mockReturnValue(null);
  MedicalProfile.findOne.mockImplementation(() => ({ select: () => ({ lean: () => Promise.resolve(null) }) }));
  mockPages(BiometricLog, []);
  mockPages(VitalSample, []);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => { Date.now.mockRestore?.(); });

describe('computeBaselines delegates to the baseline engine (superset blob)', () => {
  it('keeps EVERY legacy key with its old meaning (§0.2.5 superset contract)', async () => {
    mockPages(BiometricLog, personaHr(), []);
    const stats = await baselines.computeBaselines('u1');

    for (const key of ['rhrMedian', 'rhrMAD', 'sampleCount', 'computedAt']) {
      expect(stats).toHaveProperty(key);
    }
    expect(typeof stats.rhrMedian).toBe('number');
    expect(typeof stats.rhrMAD).toBe('number');
    expect(typeof stats.sampleCount).toBe('number');
    expect(() => new Date(stats.computedAt).toISOString()).not.toThrow();
  });

  it('adds the superset keys translate() and the later engines need', async () => {
    mockPages(BiometricLog, personaHr(), []);
    const stats = await baselines.computeBaselines('u1');

    for (const key of ['v', 'hrvMedian', 'hrvMAD', 'hourly', 'cosinor', 'zones',
      'maxHeartRate', 'acute', 'chronic', 'trend', 'confidence', 'coverage']) {
      expect(stats).toHaveProperty(key);
    }
    expect(stats.hourly).toHaveLength(24);
  });

  // ── the kill shot ──────────────────────────────────────────────────────────────
  it('D1: a user with real HRV history is scored against THEIR median, not the {45, 8} constant', async () => {
    mockPages(BiometricLog, personaHr(), []);
    mockPages(VitalSample, personaHrv({ value: 85 }), []);

    const stats = await baselines.computeBaselines('u1');

    expect(stats.hrvMedian).toBeGreaterThan(75);       // an athlete's real HRV, not 45
    expect(stats.hrvMedian).toBeCloseTo(85, -1);
    expect(stats.hrvMedian).not.toBeCloseTo(POPULATION.hrv.value, 0);
    expect(stats.hrvMAD).toBeGreaterThan(0);
  });

  // DELIBERATE RE-PIN (W4-D15(e)). This test used to assert `stats.hrvMedian ≈ POPULATION.hrv.value`
  // — the legacy key handing translate() the population prior when the user has no HRV history at
  // all. That is the same laundering of "unknown" into "measured" that the RHR pair was already
  // nulled to prevent, one metric over, and it made the D14 confidence ladder count a total
  // stranger as a known user. The prior itself did not go anywhere: it is still on the superset
  // keys, with `hrvConfidence: 0` attached, for engines that want a prior rather than an abstention.
  it('D1 (no data): with NO HRV history the LEGACY key abstains, and the prior stays on the superset keys', async () => {
    mockPages(BiometricLog, personaHr(), []);
    const stats = await baselines.computeBaselines('u1');

    expect(stats.hrvMedian).toBeNull();
    expect(stats.hrvMAD).toBeNull();
    expect(stats.coverage.hrvDays).toBe(0);
    expect(stats.coverage.hrvConfidence).toBeLessThan(0.2); // never claims to know the user

    // The prior is still reachable — abstaining on the legacy key is not discarding information.
    expect(stats.acute.hrv).toBeCloseTo(POPULATION.hrv.value, 0);
    expect(stats.chronic.hrv).toBeCloseTo(POPULATION.hrv.value, 0);
  });

  it('D1 (no data): the abstention is numerically free — translate falls back to the same constants', () => {
    // Why nulling the pair is safe: translate carries its own HRV population fallback, and its
    // constants equal the engine's prior exactly. Pinned here as well as in wave4.nullBaseline so
    // a future change to POPULATION.hrv cannot silently move every user's HRV scoring.
    expect(HRV_FALLBACK.median).toBe(POPULATION.hrv.value);
    expect(HRV_FALLBACK.mad).toBe(POPULATION.hrv.spread);
  });

  it('the two pairs are gated independently — HRV history with no resting HR still reports HRV', async () => {
    // A user can have months of one and none of the other; one shared `hasPersonalEvidence` flag
    // would have thrown away real data.
    mockPages(BiometricLog, [], []);
    mockPages(VitalSample, personaHrv({ value: 85 }), []);
    const stats = await baselines.computeBaselines('u1');

    expect(stats.rhrMedian).toBeNull();          // no non-exercise HR observed
    expect(stats.hrvMedian).toBeGreaterThan(75); // but the HRV is real and survives
  });

  it('D2/D3: an every-evening workout written as activity "unknown" does not drag the resting rate up', async () => {
    mockPages(BiometricLog, personaHr({ rest: 48, workout: 165 }), []);
    const stats = await baselines.computeBaselines('u1');

    // The old implementation pooled resting + unknown and returned the median of everything.
    expect(stats.rhrMedian).toBeLessThan(60);
    expect(Math.abs(stats.rhrMedian - 48)).toBeLessThan(5);
  });

  it('D15: sparse data no longer falls off the MIN_SAMPLES cliff — it shrinks toward the prior instead', async () => {
    // ONE day of six resting readings at 52 bpm. Under the old estimator this was < MIN_SAMPLES
    // and yielded null — nine perfectly good readings thrown away for not being ten.
    const night = new Date(NOW - DAY);
    mockPages(BiometricLog, Array.from({ length: 6 }, (_, i) => ({
      _id: `s${i}`, heartRate: 52, activity: 'resting',
      recordedAt: new Date(night.getTime() + i * 3600000),
    })), []);

    const stats = await baselines.computeBaselines('u1');

    // A real estimate now — and genuinely SHRUNK: strictly between the observation (52) and the
    // population prior (62), rather than either extreme. That is the empirical-Bayes behaviour,
    // not just "non-null".
    expect(stats.rhrMedian).not.toBeNull();
    expect(stats.rhrMedian).toBeGreaterThan(52);
    expect(stats.rhrMedian).toBeLessThan(POPULATION.restingHeartRate.value);
    expect(stats.confidence).toBeLessThan(0.5); // …and honest about how little it knows
  });

  it('but ZERO evidence still yields null — a prior is not a measurement (ATTACK-2 invariant)', async () => {
    // Every row is a labelled workout: nothing here says anything about this person at rest.
    mockPages(BiometricLog, Array.from({ length: 30 }, (_, i) => ({
      _id: `r${i}`, heartRate: 150, activity: 'running', recordedAt: new Date(NOW - DAY + i * 60000),
    })), []);

    const stats = await baselines.computeBaselines('u1');

    // translate() passes fallback=null for restingElevation, so null is what makes the stress
    // term ABSTAIN instead of scoring this user against a stranger's resting rate.
    expect(stats.rhrMedian).toBeNull();
    expect(stats.rhrMAD).toBeNull();
    expect(stats.sampleCount).toBe(0);
    // The superset half still carries the prior for engines that want one, clearly marked.
    expect(stats.coverage.rhrDays).toBe(0);
  });

  it('reads VitalSample through the decrypting getters (no .lean() on the vitals page)', async () => {
    mockPages(BiometricLog, personaHr(), []);
    mockPages(VitalSample, personaHrv(), []);
    await baselines.computeBaselines('u1');

    const page = VitalSample.find.mock.results[0].value;
    expect(page.lean).toBeUndefined();
  });

  it('still emits ONE audited bulk access with a count and never a value (ADR-0005)', async () => {
    mockPages(BiometricLog, personaHr(), []);
    mockPages(VitalSample, personaHrv(), []);
    await baselines.computeBaselines('u1');

    expect(logBiometricAccess).toHaveBeenCalledWith(
      'u1', expect.any(String), expect.objectContaining({ count: expect.any(Number) }),
    );
    for (const [, , meta] of logBiometricAccess.mock.calls) {
      expect(Object.keys(meta).every((k) => /count/i.test(k))).toBe(true);
    }
  });

  it('carries NO raw samples into the blob (zero-knowledge — this object reaches Redis)', async () => {
    mockPages(BiometricLog, personaHr(), []);
    mockPages(VitalSample, personaHrv(), []);
    const stats = await baselines.computeBaselines('u1');

    const json = JSON.stringify(stats);
    expect(json).not.toMatch(/recordedAt/);
    expect(json).not.toMatch(/_id/);
    expect(json.length).toBeLessThan(6000);
  });

  it('uses the user\'s own timezone when the samples carry one', async () => {
    const tz = -300;
    mockPages(BiometricLog, personaHr().map((r) => ({ ...r, tzOffsetMinutes: tz })), []);
    const stats = await baselines.computeBaselines('u1');
    expect(stats.hourly.filter((b) => b.n > 0).length).toBeGreaterThan(0);
    expect(stats.tzOffsetMinutes).toBe(tz);
  });
});

describe('S11 kill-switch — WAVE4_BASELINE_ENGINE_DISABLED', () => {
  it('restores the pre-delegation blob exactly: legacy keys only, MIN_SAMPLES cliff back', async () => {
    process.env.WAVE4_BASELINE_ENGINE_DISABLED = '1';
    mockPages(BiometricLog, Array.from({ length: 12 }, (_, i) => ({
      _id: `x${i}`, heartRate: i % 2 === 0 ? 59 : 61, activity: 'resting', recordedAt: new Date(NOW - DAY),
    })), []);

    const stats = await baselines.computeBaselines('u1');

    expect(stats.rhrMedian).toBe(60);
    expect(stats.sampleCount).toBe(12);
    expect(Object.keys(stats).sort()).toEqual(['computedAt', 'rhrMAD', 'rhrMedian', 'sampleCount']);
    expect(stats.hrvMedian).toBeUndefined();
  });

  it('restores the sparse-data cliff too (the flag is a behaviour switch, not a shape switch)', async () => {
    process.env.WAVE4_BASELINE_ENGINE_DISABLED = '1';
    mockPages(BiometricLog, [
      { _id: 'a', heartRate: 60, activity: 'resting', recordedAt: new Date(NOW - DAY) },
    ], []);

    const stats = await baselines.computeBaselines('u1');
    expect(stats.rhrMedian).toBeNull();
  });

  it('never touches VitalSample when disabled', async () => {
    process.env.WAVE4_BASELINE_ENGINE_DISABLED = '1';
    mockPages(BiometricLog, personaHr(), []);
    await baselines.computeBaselines('u1');
    expect(VitalSample.find).not.toHaveBeenCalled();
  });
});

describe('stale-while-revalidate peek (D15: no unpersonalized window every 6 h)', () => {
  const blobOf = (stats, userId = 'u1') => {
    const { encrypt } = jest.requireActual('../app/utils/encryption');
    return encrypt(JSON.stringify(stats), String(userId));
  };

  it('serves a STALE blob instead of a miss, and schedules the refresh', async () => {
    const stale = { rhrMedian: 52, rhrMAD: 3, sampleCount: 900, computedAt: new Date(NOW - 8 * 3600000).toISOString() };
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(blobOf(stale)), set: jest.fn() });

    const out = await baselines.peekBaselines('u1');

    // Before: the key had simply expired at 6 h and every generation in the gap ran with NO
    // personal baseline at all — the exact window D15 is about.
    expect(out.rhrMedian).toBe(52);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('does NOT schedule a refresh while the blob is still fresh', async () => {
    const fresh = { rhrMedian: 52, rhrMAD: 3, sampleCount: 900, computedAt: new Date(NOW - 60000).toISOString() };
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(blobOf(fresh)), set: jest.fn() });

    const out = await baselines.peekBaselines('u1');

    expect(out.rhrMedian).toBe(52);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('a blob with no computedAt is treated as stale (served, and refreshed)', async () => {
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(blobOf({ rhrMedian: 52 })), set: jest.fn() });

    const out = await baselines.peekBaselines('u1');
    expect(out.rhrMedian).toBe(52);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('still returns null and schedules a compute when there is nothing cached at all', async () => {
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(null), set: jest.fn() });

    expect(await baselines.peekBaselines('u1')).toBeNull();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('caches with a retention window LONGER than the freshness window (that is what makes SWR possible)', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    getRedis.mockReturnValue({ get: jest.fn(), set });

    await baselines.cacheBaselines('u1', { rhrMedian: 52, computedAt: new Date(NOW).toISOString() });

    const [, blob, mode, ttl] = set.mock.calls[0];
    expect(mode).toBe('EX');
    expect(ttl).toBeGreaterThan(baselines.FRESH_TTL_S);
    // Only an encrypted blob ever reaches Redis — asserted on the plaintext FIELD NAME, never
    // on the value. The blob is base64 AES-GCM ciphertext over a random IV, and base64's
    // alphabet includes digits, so a two-digit needle like "52" occurs by chance across its
    // ~111 adjacent pairs in ~2.7% of runs (1 in 37) — the identical flake already diagnosed
    // and fixed in baselines.test.js. A 9-char field name cannot collide (p ~ 6e-15).
    expect(blob).not.toContain('rhrMedian');
    expect(decrypt(blob, true, 'u1').rhrMedian).toBe(52);
  });
});

describe('Karvonen zones written back to the dormant MedicalProfile fields (§M.7)', () => {
  it('writes maxHeartRate + all five zones through doc.save() so the encrypting setter runs', async () => {
    const doc = { maxHeartRate: null, hrZones: {}, save: jest.fn().mockResolvedValue(undefined) };
    MedicalProfile.findOne.mockImplementation(() => Promise.resolve(doc));

    const written = await baselines.persistDerivedProfile('u1', {
      maxHeartRate: 190,
      zones: {
        zones: [
          { label: 'recovery', minBpm: 119, maxBpm: 133, percentOfMax: '50-60% HRR' },
          { label: 'fat-burn', minBpm: 133, maxBpm: 147, percentOfMax: '60-70% HRR' },
          { label: 'aerobic', minBpm: 147, maxBpm: 162, percentOfMax: '70-80% HRR' },
          { label: 'anaerobic', minBpm: 162, maxBpm: 176, percentOfMax: '80-90% HRR' },
          { label: 'max', minBpm: 176, maxBpm: 190, percentOfMax: '90-100% HRR' },
        ],
      },
    });

    expect(written).toBe(true);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(doc.maxHeartRate).toBe(190);
    expect(doc.hrZones.zone1.label).toBe('recovery');
    expect(doc.hrZones.zone5.maxBpm).toBe(190);
  });

  it('uses doc.save(), NEVER findOneAndUpdate($set) — R9: update setters are the encryption trap', async () => {
    const doc = { save: jest.fn().mockResolvedValue(undefined), hrZones: {} };
    MedicalProfile.findOne.mockImplementation(() => Promise.resolve(doc));
    MedicalProfile.findOneAndUpdate = jest.fn();

    await baselines.persistDerivedProfile('u1', { maxHeartRate: 190, zones: { zones: [] } });

    expect(MedicalProfile.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when there is no profile, and never throws into the caller', async () => {
    MedicalProfile.findOne.mockImplementation(() => Promise.resolve(null));
    await expect(baselines.persistDerivedProfile('u1', { maxHeartRate: 190, zones: { zones: [] } }))
      .resolves.toBe(false);
  });

  it('will not overwrite a user-provided maxHeartRate with an estimated one', async () => {
    const doc = { maxHeartRate: 201, hrZones: {}, save: jest.fn().mockResolvedValue(undefined) };
    MedicalProfile.findOne.mockImplementation(() => Promise.resolve(doc));

    await baselines.persistDerivedProfile('u1', {
      maxHeartRate: 190, maxHeartRateSource: 'default', zones: { zones: [] },
    });

    expect(doc.maxHeartRate).toBe(201);
  });
});

// The cache is not migrated. On the deploy that lands this, every user in production still has a
// PRE-W4-004 blob in Redis — four keys, no `v`, no hrvMedian — and a superset blob is written only
// when their next refresh runs. Both shapes must serve.
describe('cache compatibility across the shape change', () => {
  const { translate } = require('../app/services/biosonic/translate');

  const OLD_SHAPE = { rhrMedian: 58, rhrMAD: 4, sampleCount: 640, computedAt: new Date(NOW - 60000).toISOString() };

  it('an old-shape blob is served unchanged (no `v`, no superset keys, no crash)', async () => {
    const { encrypt } = jest.requireActual('../app/utils/encryption');
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(encrypt(JSON.stringify(OLD_SHAPE), 'u1')), set: jest.fn() });

    const out = await baselines.peekBaselines('u1');
    expect(out).toEqual(OLD_SHAPE);
    expect(out.v).toBeUndefined();
  });

  it('translate() consumes an old-shape blob exactly as it did before the change', () => {
    const targets = translate({
      live: { heartRate: 72, activity: 'resting' },
      baselines: OLD_SHAPE,
      hourOfDay: 14,
    });
    expect(Number.isFinite(targets.bpmCenter)).toBe(true);
    expect(Number.isFinite(targets.confidence)).toBe(true);
  });

  it('translate() consumes a SUPERSET blob and finally reads a personal HRV baseline (D1)', async () => {
    mockPages(BiometricLog, personaHr(), []);
    mockPages(VitalSample, personaHrv({ value: 85 }), []);
    const blob = await baselines.computeBaselines('u1');

    const withPersonal = translate({
      live: { heartRate: 72, activity: 'resting' }, baselines: blob, state: { hrv: 85 }, hourOfDay: 14,
    });
    const withPopulation = translate({
      live: { heartRate: 72, activity: 'resting' }, baselines: OLD_SHAPE, state: { hrv: 85 }, hourOfDay: 14,
    });

    // 85 ms is EXCELLENT recovery for this athlete and merely "way above average" against the
    // population constant {45, 8} — z≈+3.4 there. Scoring against their own median is the whole
    // point of D1, so the two must not agree.
    expect(withPersonal).not.toEqual(withPopulation);
    for (const key of Object.keys(withPopulation)) expect(withPersonal).toHaveProperty(key);
  });
});
