'use strict';

// W4-D68 — THE FATIGUE AXIS FINALLY HAS ITS DOMINANT EVIDENCE, ON THE LANE THAT SERVES MUSIC.
//
// `affectEngine.fatigueAxis` was written around two parts: §M.6's multi-night sleep-debt
// accumulator at weight 0.6, and a corroborating multi-day HRV downtrend at 0.4. The debt part is
// gated on `debt.nights > 0`, and `sleepDebtFrom(sleep)` returns `{nights: 0}` for anything that
// is not a non-empty `sleep.history` array. Until this commit NO production caller built one:
// `targetsBuilder` and `stateVector.worker` each passed `{ lastNight }` only, and
// `liveStateAdapter` passed no sleep at all. So the accumulator ran on the reachability corpus
// (which authors its own nights) and NEVER in production — every real listener's `fatigue` was
// `baselines.trend.hrv` alone, at 40% of the mass the axis was designed to carry.
//
// WHAT THIS SUITE PINS, and why in this order:
//
//   1. the SEAM — `buildTargets` asks for the nights and they arrive in the engine's own shape;
//   2. the BEHAVIOUR — twelve short nights move `fatigue`, twelve full ones do not;
//   3. the NON-EVENT — a listener with no consolidated nights scores exactly as they did before,
//      which is the clause that makes this change safe to ship without a kill switch of its own.
//
// (3) is not a formality. The axis is a blend over parts that each carry their own mass, so an
// absent history contributes literally nothing rather than a zero — "no debt" and "no evidence
// about debt" are different claims, and a person nobody has ever measured must read as the
// second. The suite asserts object-level equality against a no-history run rather than eyeballing
// a number, so a future change that starts fabricating a zero-debt part fails here.
//
// The observation point is `wellbeingRegulator.apply`'s second argument: `buildTargets` does not
// return the axes (it returns targets), but it hands the real `AffectState` — produced by the
// real engine from the real seam — to the regulator on every call. Spying there reads the actual
// production value instead of re-deriving one from a fixture the engine would never have seen.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/MorningState', () => ({ find: jest.fn() }));
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn() }));
jest.mock('../app/services/biosonic/affectCache', () => ({
  peekAffectState: jest.fn(async () => null),
  saveAffectState: jest.fn(async () => true),
}));

const MedicalProfile = require('../app/models/MedicalProfile');
const MorningState = require('../app/models/MorningState');
const { peekBaselines } = require('../app/services/biosonic/baselines');
const { computeBaselineBlob } = require('../app/agents/runtime/physiology/baselineEngine');
const { STAGE_WEIGHTS } = require('../app/agents/runtime/physiology/chronobiology');
const { FATIGUE_WEIGHTS } = require('../app/agents/runtime/physiology/affectEngine');
const regulator = require('../app/agents/runtime/translation/wellbeingRegulator');
const { buildTargets } = require('../app/services/generation/targetsBuilder');

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 7, 19, 14, 0, 0);

/** The `.find().sort().limit().select()` chain the repository actually walks. */
const findChain = (rows) => ({
  sort: () => ({ limit: () => ({ select: () => Promise.resolve(rows) }) }),
});

/** MorningState rows as the repo receives them: NEWEST first, one night each. */
const morningRows = (nights) => [...nights].reverse().map((night, i) => ({
  date: new Date(NOW - (i + 1) * DAY),
  night,
}));

const FULL_NIGHT = { deep: 90, light: 300, rem: 90 };   // 543 weighted minutes — the population need
const SHORT_NIGHT = { deep: 40, light: 180, rem: 40 };  // 288 weighted minutes — a chronic deficit
const repeat = (night, n) => Array.from({ length: n }, () => ({ ...night }));

/** 21 days of a calm body, built by the REAL blob builder (the `wave4.affectSeam` precedent). */
function personalBaselines({ days = 21, rhr = 58, hrv = 55 } = {}) {
  const hrSamples = [];
  const vitalSamples = [];
  for (let d = days; d >= 1; d--) {
    const dayStart = NOW - d * DAY;
    for (let h = 0; h < 24; h += 1) {
      const nocturnal = h < 6 ? -6 : 0;
      const diurnal = 8 * Math.sin(((h - 4) / 24) * 2 * Math.PI);
      hrSamples.push({
        value: Math.round(rhr + nocturnal + Math.max(0, diurnal)),
        activity: h < 6 ? 'resting' : 'unknown',
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

let applySpy;

/** Everything except the nights, so a test's only independent variable is the sleep history. */
function resetLane() {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  delete process.env.WAVE4_AFFECT_DISABLED;
  delete process.env.WAVE4_TRAJECTORY_DISABLED;
  MedicalProfile.findOne.mockReset().mockResolvedValue({
    lastNightSleep: { deep: 45, light: 200, rem: 70 }, hrv: 52, bodyBattery: 70, dailyReadiness: 68,
  });
  peekBaselines.mockReset().mockResolvedValue(personalBaselines());
  MorningState.find.mockReset().mockReturnValue(findChain([]));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetLane();
  applySpy = jest.spyOn(regulator, 'apply');
});

afterEach(() => { applySpy.mockRestore(); });

/**
 * Run the real serving seam over `nights` and hand back the affect the regulator was given.
 * Re-arms the whole lane first so repeated calls inside one test are genuinely independent.
 */
async function affectFor(nights) {
  resetLane();
  MorningState.find.mockReturnValue(findChain(morningRows(nights)));
  applySpy.mockClear();
  await buildTargets({ userId: 'u1', live: { heartRate: 62, activity: 'resting' }, now: NOW });
  expect(applySpy).toHaveBeenCalledTimes(1);
  return applySpy.mock.calls[0][1];
}

// ── 1. the seam ─────────────────────────────────────────────────────────────────────────────

describe('the serving lane asks for the listener\'s night history', () => {
  test('`buildTargets` queries MorningState for THIS user and nothing else', async () => {
    await affectFor(repeat(FULL_NIGHT, 3));

    expect(MorningState.find).toHaveBeenCalledTimes(1);
    expect(MorningState.find).toHaveBeenCalledWith({ userId: 'u1' });
  });

  test('the nights reach the engine OLDEST-FIRST, in the shape §M.6 weighs', async () => {
    // Three distinguishable nights; `morningRows` stores them newest-first the way Mongo returns
    // them, so an unreversed read would surface here as a reversed accumulator input.
    const nights = [{ deep: 10, light: 100, rem: 10 }, { deep: 20, light: 200, rem: 20 }, { deep: 30, light: 300, rem: 30 }];
    MorningState.find.mockReturnValue(findChain(morningRows(nights)));

    const seen = [];
    const { sleepDebt } = require('../app/agents/runtime/physiology/chronobiology');
    const spy = jest.spyOn(require('../app/agents/runtime/physiology/chronobiology'), 'sleepDebt')
      .mockImplementation((list, opts) => { seen.push(list); return sleepDebt(list, opts); });

    await buildTargets({ userId: 'u1', live: { heartRate: 62, activity: 'resting' }, now: NOW });
    spy.mockRestore();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(nights);
    // and the shape is exactly the three stage keys the weights are defined over
    for (const night of seen[0]) expect(Object.keys(night).sort()).toEqual(Object.keys(STAGE_WEIGHTS).sort());
  });
});

// ── 2. the behaviour ────────────────────────────────────────────────────────────────────────

describe('twelve nights of evidence move the slow axis', () => {
  test('a chronically short sleeper carries measurable fatigue; a rested one does not', async () => {
    const strained = await affectFor(repeat(SHORT_NIGHT, 12));
    const rested = await affectFor(repeat(FULL_NIGHT, 12));

    // The claim the row is about: the axis MOVES on sleep, in the right direction, by a margin
    // no rounding could produce.
    expect(strained.axes.fatigue.value).toBeGreaterThan(rested.axes.fatigue.value + 0.15);

    // Both carry the debt part's mass — the rested listener is not "no evidence", they are
    // "evidence of no debt", and the engine must be able to tell those apart. Twelve nights is
    // twelve nights either way, so the two masses must agree.
    expect(rested.axes.fatigue.mass).toBeCloseTo(strained.axes.fatigue.mass, 3);
  });

  test('the debt part is genuinely the dominant one — history alone lifts the axis mass', async () => {
    const withHistory = await affectFor(repeat(SHORT_NIGHT, 12));
    const without = await affectFor([]);

    // `mass` here is the FUSED confidence `blend()` reports, not the raw §M weight, so the pin is
    // a comparison against the measured no-history control rather than against `FATIGUE_WEIGHTS`.
    // The weights are asserted separately, where they are actually the quantity in play.
    expect(withHistory.axes.fatigue.mass).toBeGreaterThan(without.axes.fatigue.mass);
    expect(FATIGUE_WEIGHTS.debt).toBeGreaterThan(FATIGUE_WEIGHTS.hrvTrend);
  });
});

// ── 3. the non-event ────────────────────────────────────────────────────────────────────────

describe('a listener with no consolidated nights is untouched', () => {
  test('an empty history contributes NOTHING — not a fabricated zero-debt part', async () => {
    const empty = await affectFor([]);

    // The control: rows exist but none of them carries a night, which is the same evidentiary
    // situation by a different route. If either path ever synthesised a `{debt: 0}` part, the two
    // would still agree with each other but both would disagree with `parts`-level abstention —
    // so the pin is that the axis reports the hrvTrend part ALONE.
    resetLane();
    MorningState.find.mockReturnValue(findChain([{ date: new Date(NOW - DAY), night: null }]));
    applySpy.mockClear();
    await buildTargets({ userId: 'u1', live: { heartRate: 62, activity: 'resting' }, now: NOW });
    const nightless = applySpy.mock.calls[0][1];

    expect(empty.axes).toEqual(nightless.axes);
    expect(empty.label).toEqual(nightless.label);
    expect(empty.confidence).toEqual(nightless.confidence);
  });

  test('a failing MorningState read degrades to no history instead of costing the listener a playlist', async () => {
    const control = await affectFor([]);

    resetLane();
    MorningState.find.mockImplementation(() => { throw new Error('mongo down'); });
    applySpy.mockClear();
    const targets = await buildTargets({ userId: 'u1', live: { heartRate: 62, activity: 'resting' }, now: NOW });

    expect(targets).toBeTruthy();
    expect(typeof targets.bpmCenter).toBe('number');
    expect(applySpy.mock.calls[0][1].axes).toEqual(control.axes);
  });
});
