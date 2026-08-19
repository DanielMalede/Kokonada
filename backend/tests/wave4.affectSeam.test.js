'use strict';

// W4-006 (seam half) — WHERE THE AFFECT ENGINE REACHES THE SERVING PATH.
//
// Everything W4-005 and W4-006's pure core built has, until this commit, computed nothing anybody
// hears: `affectEngine` was a module with no caller and `stateTaxonomy`/`wellbeingRegulator` were
// a table and a decorator nothing invoked. `targetsBuilder.buildTargets` is the ONE place biosonic
// model I/O happens, so it is the one place the affect layer can join without a second source of
// truth appearing.
//
// The shape of the seam, and why it is this shape:
//
//   peek carried posterior → updateAffect(live evidence) → translate() → regulator.apply → save
//
// The alternative the mission's wording also permits — peek a WHOLE affect blob written by the
// nightly worker and use it verbatim — was rejected on measurement, not taste: the worker has no
// live heart rate, so its axes abstain, its confidence lands under the regulator's
// MIN_REGULATION_CONFIDENCE floor, and the entire seam would be a decorative no-op that reports
// success. Read-update-write is the design that makes the state a statement about NOW, and it is
// exactly the `(state, input, opts) → {state, result}` convention `updateAffect` was written for.
//
// This suite pins the seam from both ends: that regulation genuinely happens for a strained
// listener, and that NOTHING changes for everybody else — no affect, low confidence, either kill
// switch, or any failure at all leaves the pre-wave `targets` object exactly as it was.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn() }));
jest.mock('../app/services/biosonic/affectCache', () => {
  const actual = jest.requireActual('../app/services/biosonic/affectCache');
  return {
    ...actual,
    peekAffectState: jest.fn(async () => null),
    saveAffectState: jest.fn(async () => true),
  };
});

const MedicalProfile = require('../app/models/MedicalProfile');
const { peekBaselines } = require('../app/services/biosonic/baselines');
const affectCache = require('../app/services/biosonic/affectCache');
const { computeBaselineBlob } = require('../app/agents/runtime/physiology/baselineEngine');
const { STATES } = require('../app/agents/runtime/knowledge/stateTaxonomy');
const regulator = require('../app/agents/runtime/translation/wellbeingRegulator');
const { buildTargets } = require('../app/services/generation/targetsBuilder');

const KILL_SWITCHES = ['WAVE4_AFFECT_DISABLED', 'WAVE4_TRAJECTORY_DISABLED'];
const savedEnv = {};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  for (const k of KILL_SWITCHES) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  affectCache.peekAffectState.mockResolvedValue(null);
  affectCache.saveAffectState.mockResolvedValue(true);
  MedicalProfile.findOne.mockResolvedValue(null);
  peekBaselines.mockResolvedValue(null);
});

afterEach(() => {
  for (const k of KILL_SWITCHES) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

// ── a REAL baseline blob, not a hand-made one ───────────────────────────────────────────────
//
// The axes read `hourly`, `zones`, `hrvMedian/MAD`, `cosinor` and `confidence`, and a blob
// assembled by hand can satisfy a test while being a shape the engine would never see. So the
// fixture is produced by the real `computeBaselineBlob` over a synthetic history, the way
// `baselines.computeBaselines` produces it in production.

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 7, 19, 14, 0, 0); // 14:00 UTC — mid-afternoon, deliberately not a boundary

/** 21 days of a calm-bodied person: RHR ≈ 58, HRV ≈ 55, a shallow nocturnal dip. */
function personalBaselines({ days = 21, rhr = 58, hrv = 55 } = {}) {
  const hrSamples = [];
  const vitalSamples = [];
  for (let d = days; d >= 1; d--) {
    const dayStart = NOW - d * DAY;
    for (let h = 0; h < 24; h += 1) {
      const nocturnal = h >= 0 && h < 6 ? -6 : 0;
      const diurnal = 8 * Math.sin(((h - 4) / 24) * 2 * Math.PI);
      hrSamples.push({
        value: Math.round(rhr + nocturnal + Math.max(0, diurnal)),
        activity: h >= 0 && h < 6 ? 'resting' : 'unknown',
        recordedAt: new Date(dayStart + h * 3600 * 1000),
        tzOffsetMinutes: 0,
      });
    }
    vitalSamples.push({ metric: 'hrv', value: hrv, recordedAt: new Date(dayStart + 5 * 3600 * 1000), tzOffsetMinutes: 0 });
    vitalSamples.push({ metric: 'restingHeartRate', value: rhr, recordedAt: new Date(dayStart + 5 * 3600 * 1000), tzOffsetMinutes: 0 });
  }
  return computeBaselineBlob({
    hrSamples, vitalSamples, profile: { maxHeartRate: 185 }, now: NOW, tzOffsetMinutes: 0,
  });
}

const profileDoc = (over = {}) => ({
  lastNightSleep: { deep: 45, light: 200, rem: 70 },
  hrv: 52,
  bodyBattery: 70,
  dailyReadiness: 68,
  ...over,
});

/** The 13 keys §0.2.5 freezes. Every consumer in the tree pins some subset of these. */
const LEGACY_TARGET_KEYS = [
  'bpmCenter', 'bpmWidth', 'energyFloor', 'energyCeiling', 'valenceTarget',
  'acousticnessBias', 'instrumentalBias', 'tempoBand', 'confidence',
  'activityDriven', 'activityIntensity', 'state',
];

// ── the seam does something ─────────────────────────────────────────────────────────────────

describe('the affect layer reaches the serving path', () => {
  test('a resting listener with real baselines gets a state id and a trajectory on their targets', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());

    const targets = await buildTargets({
      userId: 'u1', live: { heartRate: 60, activity: 'resting' }, now: NOW,
    });

    // This is the assertion the whole task exists to make true. Before this commit the affect
    // engine had no caller at all, so `stateId` could not appear on a target under any input.
    expect(typeof targets.stateId).toBe('string');
    expect(STATES.some((s) => s.id === targets.stateId)).toBe(true);
    expect(targets.trajectory).toMatchObject({
      v: expect.any(Number),
      archetype: expect.any(String),
      direction: expect.any(Number),
      start: { energy: expect.any(Number), bpm: expect.any(Number) },
      end: { energy: expect.any(Number), bpm: expect.any(Number) },
    });
  });

  test('the trajectory endpoints live INSIDE the hard band the filters already enforce', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 64, activity: 'resting' }, now: NOW });

    // An arc asking for a tempo `biosonicBand.withinBand` has already discarded is not an arc,
    // it is an unsatisfiable constraint W4-008 would have to silently ignore.
    for (const point of [t.trajectory.start, t.trajectory.end]) {
      expect(point.bpm).toBeGreaterThanOrEqual(t.bpmCenter - t.bpmWidth);
      expect(point.bpm).toBeLessThanOrEqual(t.bpmCenter + t.bpmWidth);
      expect(point.energy).toBeGreaterThanOrEqual(t.energyFloor);
      expect(point.energy).toBeLessThanOrEqual(t.energyCeiling);
    }
  });

  test('regulation only ever TIGHTENS: the decorated target is never louder than translate()\'s', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc({ bodyBattery: 12, dailyReadiness: 15, hrv: 26 }));

    const regulated = await buildTargets({ userId: 'u1', live: { heartRate: 88, activity: 'resting' }, now: NOW });

    process.env.WAVE4_AFFECT_DISABLED = '1';
    const plain = await buildTargets({ userId: 'u1', live: { heartRate: 88, activity: 'resting' }, now: NOW });

    // VISION §6's "regulator, not a mirror" as an inequality over the serving path rather than a
    // property of a module nothing calls.
    expect(regulated.energyCeiling).toBeLessThanOrEqual(plain.energyCeiling);
    expect(regulated.acousticnessBias).toBeGreaterThanOrEqual(plain.acousticnessBias);
    expect(regulated.instrumentalBias).toBeGreaterThanOrEqual(plain.instrumentalBias);
    expect(regulated.bpmWidth).toBeLessThanOrEqual(plain.bpmWidth);
    // D4's structural replacement: valence is NEVER moved. The arc regulates; the mood is left
    // alone, which is the whole difference between guiding somebody and contradicting them.
    expect(regulated.valenceTarget).toBe(plain.valenceTarget);
  });

  test('a depleted, strained listener is measurably regulated rather than merely annotated', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc({
      bodyBattery: 8, dailyReadiness: 10, hrv: 22, lastNightSleep: { deep: 10, light: 90, rem: 20 },
    }));

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 92, activity: 'resting' }, now: NOW });

    // Not "a trajectory object exists" — an actual demand was computed from actual strain.
    expect(t.regulator.demand).toBeGreaterThan(0);
    expect(t.trajectory.intensityScale).toBeLessThan(1);
  });
});

// ── the seam does NOTHING to everybody else ─────────────────────────────────────────────────

describe('§0.2.5 — the targets object stays a strict superset', () => {
  test('every legacy key survives regulation', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW });

    for (const key of LEGACY_TARGET_KEYS) expect(t).toHaveProperty(key);
    expect(t.state).toMatchObject({
      recovery: expect.any(Number), stress: expect.any(Number), exertion: expect.any(Number),
    });
    expect(t.version).toBeDefined();
  });

  test('the keys the regulator does not own are byte-identical to the undecorated target', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    const live = { heartRate: 70, activity: 'resting' };

    const decorated = await buildTargets({ userId: 'u1', live, now: NOW });
    process.env.WAVE4_AFFECT_DISABLED = '1';
    const plain = await buildTargets({ userId: 'u1', live, now: NOW });

    // The regulator declares exactly five fields it may move. Anything else changing would be a
    // silent widening of its remit, which no amount of reading the module would catch later.
    const MAY_CHANGE = new Set(['energyFloor', 'energyCeiling', 'acousticnessBias', 'instrumentalBias', 'bpmWidth']);
    for (const key of Object.keys(plain)) {
      if (MAY_CHANGE.has(key)) continue;
      expect({ [key]: decorated[key] }).toEqual({ [key]: plain[key] });
    }
  });

  test('a user the engine cannot read gets the pre-wave target, undecorated', async () => {
    // No baselines, no profile, no reading — a cold-start user on their first generation.
    const t = await buildTargets({ userId: 'u1', live: {}, now: NOW });

    expect(t.stateId).toBeUndefined();
    expect(t.trajectory).toBeUndefined();
    expect(t.regulator).toBeUndefined();
    for (const key of LEGACY_TARGET_KEYS) expect(t).toHaveProperty(key);
  });

  test('a confident-sounding guess buys nothing — below the confidence floor there is no decoration', async () => {
    // Baselines exist but nothing else does, so every axis abstains and confidence collapses.
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(null);

    const t = await buildTargets({ userId: 'u1', live: {}, now: NOW });
    expect(t.trajectory).toBeUndefined();
  });
});

// ── S11: the two kill switches ──────────────────────────────────────────────────────────────

describe('S11 kill switches restore the previous behaviour without a revert', () => {
  test('WAVE4_AFFECT_DISABLED skips the affect layer entirely — no peek, no compute, no save', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    process.env.WAVE4_AFFECT_DISABLED = '1';

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW });

    expect(t.stateId).toBeUndefined();
    expect(t.trajectory).toBeUndefined();
    expect(affectCache.peekAffectState).not.toHaveBeenCalled();
    expect(affectCache.saveAffectState).not.toHaveBeenCalled();
  });

  test('WAVE4_TRAJECTORY_DISABLED stops the DECORATION but keeps the posterior advancing', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    process.env.WAVE4_TRAJECTORY_DISABLED = '1';

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW });

    // The two flags are deliberately NOT the same switch. This one turns off what the listener
    // hears; the temporal layer keeps running, so W4-009's transition detector and the soak still
    // have a live posterior to read, and re-enabling does not start everyone from a cold prior.
    expect(t.trajectory).toBeUndefined();
    expect(t.stateId).toBeUndefined();
    expect(affectCache.saveAffectState).toHaveBeenCalled();
  });

  test('both switches together are still just the pre-wave target', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    process.env.WAVE4_AFFECT_DISABLED = '1';
    process.env.WAVE4_TRAJECTORY_DISABLED = '1';

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW });
    expect(t.trajectory).toBeUndefined();
  });

  test('the flags are read per call, not latched at require time', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    const live = { heartRate: 70, activity: 'resting' };

    process.env.WAVE4_AFFECT_DISABLED = '1';
    expect((await buildTargets({ userId: 'u1', live, now: NOW })).stateId).toBeUndefined();
    delete process.env.WAVE4_AFFECT_DISABLED;
    // A kill switch that needs a redeploy to take effect is not an escape hatch (S11).
    expect((await buildTargets({ userId: 'u1', live, now: NOW })).stateId).toBeDefined();
  });
});

// ── best-effort: the seam can never cost a generation ───────────────────────────────────────

describe('every new dependency is best-effort (the file\'s standing contract)', () => {
  test('a Redis-less peek degrades to a cold start, not a failure', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    affectCache.peekAffectState.mockResolvedValue(null);

    await expect(buildTargets({ userId: 'u1', live: { heartRate: 70 }, now: NOW })).resolves.toBeDefined();
  });

  test('a THROWING peek still returns targets', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    affectCache.peekAffectState.mockRejectedValue(new Error('redis down'));

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW });
    for (const key of LEGACY_TARGET_KEYS) expect(t).toHaveProperty(key);
  });

  test('a REJECTING save never surfaces to the caller', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    affectCache.saveAffectState.mockRejectedValue(new Error('READONLY'));

    await expect(buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW }))
      .resolves.toBeDefined();
  });

  test('a failed affect layer returns targets untouched — not a rebuilt copy of them', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    affectCache.peekAffectState.mockRejectedValue(new Error('redis down'));

    const failed = await buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW });

    process.env.WAVE4_AFFECT_DISABLED = '1';
    const plain = await buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW });

    // The seam deliberately has no `if (!affect) return targets` guard — the regulator's own
    // no-op contract covers it, and a second guard proved unfalsifiable under stub-out. The
    // guarantee is therefore pinned HERE: a failed affect layer is indistinguishable from the
    // kill switch, field for field.
    expect(failed).toEqual(plain);
    expect(failed.trajectory).toBeUndefined();
  });

  test('a corrupt carried posterior does not poison the generation', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    affectCache.peekAffectState.mockResolvedValue({ alpha: 'not-a-vector', label: 'nonsense-state' });

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 70, activity: 'resting' }, now: NOW });
    for (const key of LEGACY_TARGET_KEYS) expect(t).toHaveProperty(key);
  });
});

// ── the temporal layer is genuinely temporal ────────────────────────────────────────────────

describe('the carried posterior actually carries', () => {
  test('the state written back is the state the engine produced, and it advances', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    const live = { heartRate: 70, activity: 'resting' };

    await buildTargets({ userId: 'u1', live, now: NOW });
    const first = affectCache.saveAffectState.mock.calls[0][1];
    expect(first.updates).toBe(1);
    expect(Array.isArray(first.alpha)).toBe(true);
    expect(first.alpha).toHaveLength(STATES.length);

    affectCache.peekAffectState.mockResolvedValue(first);
    await buildTargets({ userId: 'u1', live, now: NOW + 60_000 });
    const second = affectCache.saveAffectState.mock.calls[1][1];

    // Without this the temporal layer is decorative: every generation would restart from a
    // uniform prior and §M.5's sticky transitions, dwell priors and hysteresis would never bind.
    expect(second.updates).toBe(2);
    expect(second.lastAtMs).toBe(NOW + 60_000);
  });

  test('the posterior is saved under the generating user, with the peek scoped the same way', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());

    await buildTargets({ userId: 'user-abc', live: { heartRate: 70 }, now: NOW });

    expect(affectCache.peekAffectState).toHaveBeenCalledWith('user-abc', { now: NOW });
    expect(affectCache.saveAffectState).toHaveBeenCalledWith('user-abc', expect.any(Object));
  });
});

// ── D13's serving-path half: the hour is the LISTENER's, not the server's ───────────────────

describe('hour-of-day comes from the user\'s habitual timezone when it is known (D13)', () => {
  test('a user whose baselines carry a tz offset is evaluated at THEIR local hour', async () => {
    // 14:00 UTC is mid-afternoon; at +600 minutes it is midnight, deep in translate()'s
    // wind-down window. The two must not produce the same target.
    peekBaselines.mockResolvedValue({ ...personalBaselines(), tzOffsetMinutes: 600 });
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    process.env.WAVE4_AFFECT_DISABLED = '1'; // isolate the hour from the regulator

    const east = await buildTargets({ userId: 'u1', live: { heartRate: 60, activity: 'resting' }, now: NOW });

    peekBaselines.mockResolvedValue({ ...personalBaselines(), tzOffsetMinutes: 0 });
    const utc = await buildTargets({ userId: 'u1', live: { heartRate: 60, activity: 'resting' }, now: NOW });

    expect(east.energyCeiling).toBeLessThan(utc.energyCeiling);
  });

  test('the unknown-offset fallback is the SERVER\'s offset, not zero', () => {
    const { resolveHourContext } = require('../app/services/generation/targetsBuilder');
    const { hourOfDay, tzOffsetMinutes } = resolveHourContext(NOW, {});

    // Box-independent: whatever this machine's zone is, the resolved hour must equal the hour
    // `new Date(now).getHours()` has always produced. Zero would be UTC, which coincides only on
    // a UTC box — the exact way a silent hour shift would slip through CI in one region.
    expect(hourOfDay).toBe(new Date(NOW).getHours());
    expect(tzOffsetMinutes).toBe(-new Date(NOW).getTimezoneOffset());
  });

  test('a declared offset wins over the server\'s', () => {
    const { resolveHourContext } = require('../app/services/generation/targetsBuilder');
    expect(resolveHourContext(NOW, { tzOffsetMinutes: 600 }).hourOfDay).toBe(0); // 14:00 UTC + 10 h
    expect(resolveHourContext(NOW, { tzOffsetMinutes: 0 }).hourOfDay).toBe(14);
  });

  test('a user with NO tz data keeps today\'s server-hour behaviour exactly', async () => {
    // Every shipped client sends null today (W4-004 carried this forward), so this is the path
    // real users are on. Changing it silently — e.g. by defaulting the offset to 0, which is UTC
    // and not the server's hour — would move every existing user's wind-down window.
    const blob = personalBaselines();
    delete blob.tzOffsetMinutes;
    peekBaselines.mockResolvedValue(blob);
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    process.env.WAVE4_AFFECT_DISABLED = '1';

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 60, activity: 'resting' }, now: NOW });

    const { translate } = require('../app/services/biosonic/translate');
    const expected = translate({
      live: { heartRate: 60, activity: 'resting' },
      baselines: blob,
      sleep: { lastNight: { deep: 45, light: 200, rem: 70 } },
      state: { hrv: 52, bodyBattery: 70, dailyReadiness: 68 },
      hourOfDay: new Date(NOW).getHours(), // the server hour, as it has always been
      moodKey: null,
    });
    expect(t).toEqual(expected);
  });
});

// ── §0.2.2: nothing numeric about a body leaves this seam ───────────────────────────────────

describe('zero-knowledge', () => {
  test('no vital, in any field, at any depth of the emitted target', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 137, activity: 'running' }, now: NOW });

    const json = JSON.stringify(t);
    // The exact reading, the HRV and the battery are the three numbers that must never appear.
    // bpmCenter is a MUSIC tempo and is allowed — hence pinning the specific vitals rather than
    // "no three-digit number", which the tempo would trip on.
    expect(json).not.toMatch(/\b137\b/);
    expect(json).not.toMatch(/"heartRate"/);
    expect(json).not.toMatch(/"hrv"/);
    expect(json).not.toMatch(/"bodyBattery"/);
  });

  test('the regulator telemetry line carries tokens and ratios, never a vital', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc({ bodyBattery: 9, dailyReadiness: 11, hrv: 21 }));

    const t = await buildTargets({ userId: 'u1', live: { heartRate: 143, activity: 'resting' }, now: NOW });

    expect(typeof t.telemetry).toBe('string');
    expect(t.telemetry).not.toMatch(/\b143\b/);
    expect(t.telemetry).not.toMatch(/\b21\b/);
    for (const word of ['bpm', 'rmssd', 'heartRate', 'hrv']) {
      expect(t.telemetry.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});

// ── declared mood reaches the engine ────────────────────────────────────────────────────────

describe('emotion taps are threaded through to the engine', () => {
  test('taps move the valence axis, which is declared-only by design (§0.2.4)', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());
    const live = { heartRate: 70, activity: 'resting' };

    await buildTargets({ userId: 'u1', live, now: NOW });
    const withoutTaps = affectCache.saveAffectState.mock.calls[0][1];

    await buildTargets({
      userId: 'u1', live, now: NOW,
      taps: [{ x: -0.8, y: -0.2 }, { x: -0.75, y: -0.25 }, { x: -0.85, y: -0.15 }],
    });
    const withTaps = affectCache.saveAffectState.mock.calls[1][1];

    // Without this thread the valence axis abstains forever, and every state whose only
    // separation from a rival is valence becomes unreachable at serve time — the pure core found
    // exactly that failure mode between `creative-flow` and `deep-focus`.
    expect(withTaps.alpha).not.toEqual(withoutTaps.alpha);
  });

  test('both real call sites actually pass them (a parameter nobody supplies is a dead parameter)', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

    // Structural rather than behavioural, deliberately and with its limits acknowledged: these
    // two call sites live inside a socket handler and a fallback ladder whose own suites mock
    // `buildTargets` wholesale, so a behavioural assertion there would be asserting the mock.
    // What must not regress is that the argument is SUPPLIED — the seam above is already pinned
    // to use it, and a `taps` nobody passes would make all of that green and useless.
    expect(read('app/sockets/biometricHandler.js')).toMatch(/buildTargets\(\{[^)]*taps:\s*state\.lastEmotionTaps/);
    expect(read('app/services/generation/deterministicFallback.js')).toMatch(/buildTargets\(\{[^)]*taps[,\s}]/);
  });

  test('a malformed taps payload is survivable, not fatal', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc());

    await expect(buildTargets({
      userId: 'u1', live: { heartRate: 70 }, now: NOW, taps: 'not-an-array',
    })).resolves.toBeDefined();
  });
});

// ── the regulator is reached with what it needs ─────────────────────────────────────────────

describe('the seam hands the regulator a real AffectState, not a stub', () => {
  test('the decoration matches applying the regulator directly to the same inputs', async () => {
    peekBaselines.mockResolvedValue(personalBaselines());
    MedicalProfile.findOne.mockResolvedValue(profileDoc({ bodyBattery: 15, dailyReadiness: 18, hrv: 28 }));
    const live = { heartRate: 84, activity: 'resting' };

    const seam = await buildTargets({ userId: 'u1', live, now: NOW });

    process.env.WAVE4_AFFECT_DISABLED = '1';
    const plain = await buildTargets({ userId: 'u1', live, now: NOW });
    delete process.env.WAVE4_AFFECT_DISABLED;

    // Reconstruct the affect the seam must have produced, then apply the SAME pure decorator.
    //
    // The offset comes from the builder's OWN `resolveHourContext` rather than a literal 0. A
    // hardcoded 0 made this test pass on a UTC+3 box by coincidence — the two hours happened to
    // land in bins that produced the same posterior — which is the "green for the wrong reason"
    // class this run keeps finding. Using the real resolver makes the equivalence exact by
    // construction and keeps the test honest on any machine.
    const { updateAffect } = require('../app/agents/runtime/physiology/affectEngine');
    const { resolveHourContext } = require('../app/services/generation/targetsBuilder');
    const blob = personalBaselines();
    const { affect } = updateAffect(null, {
      live,
      baselines: blob,
      state: { hrv: 28, bodyBattery: 15, dailyReadiness: 18 },
      sleep: { lastNight: { deep: 45, light: 200, rem: 70 } },
      taps: null,
      tzOffsetMinutes: resolveHourContext(NOW, blob).tzOffsetMinutes,
    }, { now: NOW, states: STATES });

    expect(seam).toEqual(regulator.apply(plain, affect, {}));
  });
});
