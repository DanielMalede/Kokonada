'use strict';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// W4-D43 — §0.4 S14: the Pulse surfacing that turns MorningState from a write-only collection
// into something a person can actually see.
//
// W4-012 shipped the nightly consolidation — encrypted, TTL'd, erasure-registered — and NOTHING
// read a single field of it. This suite pins the reader, and it pins the two properties that make
// the reader safe rather than merely present:
//
//   1. STRICT SUPERSET (§0.2.5, the discipline this wave already applies to `targets`). Every key
//      the endpoint returned yesterday returns tomorrow with the same value and the same meaning.
//      A client that has never heard of `morning` must not be able to tell the difference.
//   2. NEVER A NUMERIC VITAL (§0.2.2). MorningState's own encryption ruling is the specification
//      here: the model encrypts every field that carries a physiological MAGNITUDE and leaves
//      plain every field that describes CONFIDENCE IN or the CATEGORY of an estimate. So the rule
//      this suite enforces mechanically is — **no encrypted MorningState field may leave the
//      server except as a coarse bucket**. That is checkable against the schema itself rather
//      than against a hand-copied list of field names, which is why it is written that way below.
// ─────────────────────────────────────────────────────────────────────────────────────────────

jest.mock('../app/models/MedicalProfile');
jest.mock('../app/models/MorningState');

const MedicalProfile = require('../app/models/MedicalProfile');
const MorningState = require('../app/models/MorningState');
const RealMorningState = jest.requireActual('../app/models/MorningState');
const { encrypt } = require('../app/utils/encryption');
const { BAND_LABELS } = require('../app/agents/runtime/physiology/affectEngine');
const { STATES, byId } = require('../app/agents/runtime/knowledge/stateTaxonomy');
const ctrl = require('../app/controllers/pulseController');

const { toPulseStateDTO, toAffectDTO, toMorningDTO } = ctrl;

// The response shape as it stood BEFORE this task — the thing "superset" is measured against.
const LEGACY_TOP = ['lastAnalyzed', 'sampleCount', 'sleep', 'stateVector', 'vitals'];
const NEW_TOP = [...LEGACY_TOP, 'affect', 'morning'].sort();

function buildRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function profileDoc(overrides = {}) {
  return {
    hrv: 68, bodyBattery: 74, dailyReadiness: 81, restingHeartRate: 54,
    lastNightSleep: { deep: 90, light: 280, rem: 85, date: new Date('2026-08-21T06:00:00Z') },
    sleepUpdatedAt: new Date('2026-08-21T07:00:00Z'),
    stateVector: {
      status: encrypt('Recovering'),
      confidence: 0.7,
      stateId: encrypt('post-exertion-recovery'),
      stateConfidence: 0.62,
      computedAt: new Date('2026-08-21T11:00:00Z'),
    },
    sampleCount: 4200, lastAnalyzed: new Date('2026-08-21T10:00:00Z'),
    ...overrides,
  };
}

// A MorningState as a non-lean doc looks to a reader: the encryptedNumber getters have already run.
function morningDoc(overrides = {}) {
  return {
    userId: 'u1',
    date: new Date('2026-08-21T00:00:00Z'),
    readiness: 0.72,
    readinessConfidence: 0.6,
    sleepDebt: { debt: 45, ratio: 0.21, need: 500, ceiling: 1000, nights: 12, confidence: 0.7 },
    night: { deep: 90, light: 300, rem: 90 },
    cosinor: { M: 62, A: 5.2, phi: 16.3, confidence: 0.8, source: 'fit' },
    cusum: {
      rhr: { cPlus: 4.4, cMinus: 0, flagged: true, direction: 'up', referenceDays: 30 },
      hrv: { cPlus: 0, cMinus: 2.1, flagged: false, direction: null, referenceDays: 30 },
    },
    v: 1,
    ...overrides,
  };
}

function mockProfile(doc) {
  MedicalProfile.findOne.mockImplementation(() => Promise.resolve(doc));
}

function mockMorning(doc) {
  const calls = {};
  MorningState.findOne.mockImplementation((filter) => {
    calls.filter = filter;
    return { sort: (s) => { calls.sort = s; return Promise.resolve(doc); } };
  });
  return calls;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WAVE4_PULSE_SUPERSET_DISABLED;
});
afterAll(() => { delete process.env.WAVE4_PULSE_SUPERSET_DISABLED; });

// ── 1. superset discipline ──────────────────────────────────────────────────────────────────

describe('W4-D43 — the response is a STRICT superset of what it was', () => {
  it('keeps every legacy key byte-for-byte and adds exactly two', () => {
    const legacy = toPulseStateDTO(profileDoc());        // no extras — the pre-task call shape
    const full = toPulseStateDTO(profileDoc(), { morning: morningDoc() });

    expect(Object.keys(full).sort()).toEqual(NEW_TOP);
    for (const k of LEGACY_TOP) expect(full[k]).toEqual(legacy[k]);
  });

  it('a user with NO MorningState row still gets today\'s exact legacy shape', async () => {
    mockProfile(null);
    mockMorning(null);
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' } }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    // Every pre-existing key, deep-equal to the null-safe shape the screen has always rendered.
    expect(res.body.stateVector).toEqual({ status: null, confidence: null, computedAt: null });
    expect(res.body.vitals).toEqual({ hrv: null, bodyBattery: null, dailyReadiness: null, restingHeartRate: null });
    expect(res.body.sleep).toEqual({ lastNight: { deep: null, light: null, rem: null, date: null }, updatedAt: null });
    expect(res.body.lastAnalyzed).toBeNull();
    expect(res.body.sampleCount).toBe(0);
    // …and the new blocks are PRESENT and fully null-safe, so the shape a client parses is the
    // same whether or not the nightly job has ever run for this person.
    expect(res.body.morning.readinessBucket).toBe('n/a');
    expect(res.body.morning.date).toBeNull();
    expect(res.body.affect).toEqual({ domain: null, band: null, confidence: null, computedAt: null });
  });

  it('S11 kill switch: WAVE4_PULSE_SUPERSET_DISABLED restores the OLD key set exactly, and skips the extra read', async () => {
    process.env.WAVE4_PULSE_SUPERSET_DISABLED = '1';
    mockProfile(profileDoc());
    const calls = mockMorning(morningDoc());
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' } }, res, jest.fn());

    expect(Object.keys(res.body).sort()).toEqual(LEGACY_TOP);
    expect(MorningState.findOne).not.toHaveBeenCalled();
    expect(calls.filter).toBeUndefined();
  });
});

// ── 2. the coarse affect block ──────────────────────────────────────────────────────────────

describe('W4-D43 — coarse affect: domain + band + confidence, never the state id', () => {
  it('projects the encrypted taxonomy id to its domain and band', () => {
    const dto = toAffectDTO(profileDoc().stateVector);
    const entry = byId('post-exertion-recovery');
    expect(dto).toEqual({
      domain: entry.domain, band: entry.band, confidence: 0.62,
      computedAt: new Date('2026-08-21T11:00:00Z'),
    });
  });

  it('NEVER ships the state id itself — that vocabulary is H6-gated (mission R10)', () => {
    const dto = toPulseStateDTO(profileDoc(), { morning: morningDoc() });
    const blob = JSON.stringify(dto);
    for (const s of STATES) expect(blob).not.toContain(s.id);
    expect(blob).not.toContain('stateId');
  });

  it('emits only closed vocabularies — every domain/band it can produce is in the taxonomy', () => {
    const domains = new Set(STATES.map((s) => s.domain));
    const bands = new Set(STATES.map((s) => s.band));
    for (const s of STATES) {
      const dto = toAffectDTO({ stateId: encrypt(s.id), stateConfidence: 0.5, computedAt: null });
      expect(domains.has(dto.domain)).toBe(true);
      expect(bands.has(dto.band)).toBe(true);
    }
  });

  it('a legacy-classifier label still yields domain/band, but claims NO affect confidence', () => {
    // `upsertStateVector` writes `stateConfidence: null` when the id came from the nine-rule
    // fallback rather than the affect engine. The block must not borrow the legacy enum
    // confidence to look better informed than it is.
    const dto = toAffectDTO({ stateId: encrypt('deep-rest'), stateConfidence: null, confidence: 1.0, computedAt: null });
    expect(dto.domain).toBe('rest');
    expect(dto.confidence).toBeNull();
  });

  it('an unknown, corrupt, absent or non-string state id degrades to nulls, never throws', () => {
    for (const sv of [
      undefined, null, {},
      { stateId: 'not-ciphertext' },
      { stateId: encrypt('a-state-that-was-deleted-from-the-taxonomy') },
      { stateId: 12345 },
      { stateId: encrypt('post-exertion-recovery'), stateConfidence: 'high' },
      { stateId: encrypt('post-exertion-recovery'), stateConfidence: NaN },
    ]) {
      const dto = toAffectDTO(sv);
      expect(Object.keys(dto).sort()).toEqual(['band', 'computedAt', 'confidence', 'domain']);
      expect(dto.confidence === null || Number.isFinite(dto.confidence)).toBe(true);
    }
    expect(toAffectDTO({ stateId: 'not-ciphertext' }).domain).toBeNull();
  });
});

// ── 3. the morning block: buckets, never magnitudes ─────────────────────────────────────────

describe('W4-D43 — MorningState surfaces as buckets and counts, never as a vital', () => {
  it('NO encrypted MorningState field ships raw — checked against the SCHEMA, not a copied list', () => {
    // Walk the real schema for every path whose setter is the encryptedField one, give each a
    // unique sentinel value, and assert none of those values survives into the DTO. A field added
    // to the model later is covered automatically; a hand-written list would not be.
    const encryptedPaths = [];
    const walk = (schema, prefix) => schema.eachPath((p, type) => {
      // `encryptedNumber()` is the ONLY thing in this model that declares a custom setter.
      if (typeof type.options?.set === 'function') encryptedPaths.push(prefix + p);
      if (type.schema) walk(type.schema, `${prefix}${p}.`);
    });
    walk(RealMorningState.schema, '');
    expect(encryptedPaths.length).toBeGreaterThan(5); // the walk found something real
    expect(encryptedPaths).toEqual(expect.arrayContaining(['readiness', 'sleepDebt.debt', 'cosinor.M', 'night.deep', 'cusum.rhr.cPlus']));

    // Sentinels are far outside every bucket domain so a leak cannot be mistaken for a bucket.
    const doc = morningDoc();
    let n = 0;
    const sentinels = [];
    const put = (obj, key) => { const v = 900000 + (n++); sentinels.push(v); obj[key] = v; };
    put(doc, 'readiness');
    for (const k of ['debt', 'ratio', 'need', 'ceiling']) put(doc.sleepDebt, k);
    for (const k of ['M', 'A', 'phi']) put(doc.cosinor, k);
    for (const k of ['deep', 'light', 'rem']) put(doc.night, k);
    for (const branch of ['rhr', 'hrv']) for (const k of ['cPlus', 'cMinus']) put(doc.cusum[branch], k);

    const blob = JSON.stringify(toMorningDTO(doc));
    for (const v of sentinels) expect(blob).not.toContain(String(v));
  });

  it('readiness is a coarse band from the house vocabulary, gated on its own confidence', () => {
    const at = (readiness, readinessConfidence) =>
      toMorningDTO(morningDoc({ readiness, readinessConfidence })).readinessBucket;

    expect(at(0.05, 0.6)).toBe('min');
    expect(at(0.30, 0.6)).toBe('low');
    expect(at(0.50, 0.6)).toBe('mid');
    expect(at(0.72, 0.6)).toBe('high');
    expect(at(0.95, 0.6)).toBe('peak');
    // Monotone: a higher readiness never reports a lower band.
    const order = BAND_LABELS;
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const i = order.indexOf(at(Math.min(x, 1), 0.6));
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
    // No confidence is no claim — the whole point of storing the confidence separately.
    expect(at(0.72, 0)).toBe('n/a');
    expect(at(0.72, null)).toBe('n/a');
  });

  it('a missing readiness NEVER reads as the bottom band (the Number(null)===0 class)', () => {
    // `affectEngine.band()` walks the cuts without a finite guard, so band(null, 0.6) is 'min' —
    // a person the engine knows nothing about would be shown as maximally unready.
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, 'ok', {}, [], -0.5, 1.5]) {
      expect(toMorningDTO(morningDoc({ readiness: bad, readinessConfidence: 0.9 })).readinessBucket).toBe('n/a');
    }
  });

  it('sleep debt surfaces as a bucket of the RATIO plus plain counts, never minutes', () => {
    const dto = toMorningDTO(morningDoc());
    expect(dto.sleepDebt).toEqual({ bucket: 'low', nights: 12, confidence: 0.7 });
    expect(JSON.stringify(dto)).not.toContain('45');   // debt minutes
    expect(JSON.stringify(dto)).not.toContain('500');  // need minutes
  });

  it('carries the drift flags — the only thing the nightly CUSUM exists to say', () => {
    const dto = toMorningDTO(morningDoc());
    expect(dto.drift).toEqual({
      rhr: { flagged: true, direction: 'up', referenceDays: 30 },
      hrv: { flagged: false, direction: null, referenceDays: 30 },
    });
  });

  it('carries the cosinor CONFIDENCE and source but never M, A or phi', () => {
    const dto = toMorningDTO(morningDoc());
    expect(dto.cosinor).toEqual({ confidence: 0.8, source: 'fit' });
    const blob = JSON.stringify(dto);
    expect(blob).not.toContain('62');    // M, bpm
    expect(blob).not.toContain('5.2');   // A, bpm
    expect(blob).not.toContain('16.3');  // phi, clock hour
  });

  it('carries the schema version so a later shape change is migratable (S15)', () => {
    expect(toMorningDTO(morningDoc()).v).toBe(RealMorningState.MORNING_STATE_VERSION);
  });

  it('survives a hostile / half-written / null row without throwing', () => {
    const KEYS = ['cosinor', 'date', 'drift', 'readinessBucket', 'readinessConfidence', 'sleepDebt', 'v'];
    for (const row of [
      null, undefined, {}, { sleepDebt: null, cosinor: null, cusum: null },
      { cusum: { rhr: 'nope', hrv: 7 } },
      { sleepDebt: { nights: 'twelve', confidence: 5 } },
      { cosinor: { source: { toString: () => 'fit' } } },
      { v: 'one', date: 'yesterday' },
    ]) {
      const dto = toMorningDTO(row);
      expect(Object.keys(dto).sort()).toEqual(KEYS);
      expect(BAND_LABELS.concat('n/a')).toContain(dto.readinessBucket);
      expect(dto.confidence === undefined).toBe(true);
      expect(typeof dto.drift.rhr.flagged).toBe('boolean');
    }
  });

  it('confidences are clamped to [0,1] rather than echoed — a stored 5 is not 500% sure', () => {
    const dto = toMorningDTO(morningDoc({
      readinessConfidence: 5,
      sleepDebt: { ratio: 0.2, nights: -3, confidence: -1 },
      cosinor: { confidence: 99, source: 'fit' },
    }));
    expect(dto.readinessConfidence).toBe(1);
    expect(dto.sleepDebt.confidence).toBe(0);
    expect(dto.sleepDebt.nights).toBe(0);
    expect(dto.cosinor.confidence).toBe(1);
  });
});

// ── 4. the controller wiring ────────────────────────────────────────────────────────────────

describe('W4-D43 — the endpoint reads the LATEST morning row, scoped to the caller', () => {
  it('queries the caller\'s own most recent day', async () => {
    mockProfile(profileDoc());
    const calls = mockMorning(morningDoc());
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' } }, res, jest.fn());

    expect(calls.filter).toEqual({ userId: 'u1' });
    expect(calls.sort).toEqual({ date: -1 });
    expect(res.body.morning.readinessBucket).toBe('high');
    expect(res.body.affect.domain).toBe('rest');
  });

  it('a failing MorningState read degrades to the null block — it never 500s an endpoint that worked yesterday', async () => {
    mockProfile(profileDoc());
    MorningState.findOne.mockImplementation(() => { throw new Error('mongo down'); });
    const next = jest.fn();
    const res = buildRes();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await ctrl.getPulseState({ user: { _id: 'u1' } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.vitals.hrv).toBe(68);           // the legacy half still works
    expect(res.body.morning.readinessBucket).toBe('n/a');
    // The degradation log must not quote the error message — it can carry the document that
    // choked it, and on this path that document is a vital (§0.2.2).
    for (const call of spy.mock.calls) expect(String(call[0])).not.toContain('mongo down');
    spy.mockRestore();
  });

  it('a MedicalProfile failure still reaches next(err) — that behaviour is unchanged', async () => {
    MedicalProfile.findOne.mockImplementation(() => Promise.reject(new Error('boom')));
    mockMorning(null);
    const next = jest.fn();
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' } }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.body).toBeNull();
  });

  it('no numeric vital reaches the new blocks even from a doc stuffed with them', async () => {
    mockProfile(profileDoc({ spO2: 98, respirationRate: 14, maxHeartRate: 190 }));
    mockMorning(morningDoc());
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' } }, res, jest.fn());

    const added = JSON.stringify({ affect: res.body.affect, morning: res.body.morning });
    // (`drift.hrv` is a legitimate key — it names WHICH baseline drifted, and carries a boolean.)
    expect(added).not.toMatch(/spO2|respirationRate|maxHeartRate|heartRate|bodyBattery/i);
    for (const vital of [68, 74, 81, 54, 98, 14, 190]) expect(added).not.toContain(String(vital));
    // Every number in the two new blocks is a confidence, a count or a version — nothing else.
    // Strings (keys, enum tokens, the two ISO timestamps) are blanked first: a date is a day
    // bucket, not a magnitude, and its digits would otherwise be scanned as one.
    const scrubbed = added.replace(/"(?:\\.|[^"\\])*"/g, '""');
    for (const n of scrubbed.match(/-?\d+(\.\d+)?/g) || []) {
      const v = Number(n);
      expect(Number.isFinite(v)).toBe(true);
      expect(v >= 0 && v <= 30).toBe(true); // confidences ∈[0,1], counts ≤30, v=1
    }
  });
});
