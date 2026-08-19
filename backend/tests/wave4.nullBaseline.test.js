'use strict';

// W4-D15 — `Number(null) === 0`, and what it did to the serving path.
//
// `translate()`'s own numeric guard was `finite = (x) => Number.isFinite(Number(x)) ? Number(x) : null`.
// Every JS shape that means "no measurement" — `null`, `''`, `false`, `[]` — coerces to the NUMBER 0
// under `Number()`, and 0 is finite, so the guard returned 0 and the caller could not tell "the body
// reported nothing" from "the body reported zero". For physiology those are opposite claims, and the
// coercion always landed on the alarming one: zero resting heart rate, zero HRV, zero body battery,
// zero readiness, zero sleep.
//
// The headline consequence, measured on the real `translate()` before the fix: a calm user at rest
// with `baselines.rhrMedian === null` scored `stress = 1.0` — because the resting-elevation term
// z-scored their 70 bpm against a resting heart rate of ZERO. It stayed 1.0 at 55 bpm and at 40 bpm;
// anything above ~18 bpm saturates. That is exactly the target profile D3 and D4 exist to prevent
// (narrow window, forced acoustic, forced instrumental, forced-cheerful valence) delivered to
// someone who is fine — the regulator-as-mirror failure, arriving through a type coercion.
//
// It matters NOW rather than in the abstract because W4-004's wiring makes `computeBaselines` return
// `rhrMedian: null` deliberately and routinely (zero non-exercise observations of this user), and the
// comment in `baselines.js` justified that null with the premise that the stress term would then
// "ABSTAIN rather than score the user against a stranger's physiology". It did not abstain. Scoring
// against 0 bpm is worse than scoring against a stranger.
//
// The invariant this suite pins is one sentence: **an explicitly-null input must be indistinguishable
// from an absent one.** That is stronger and more durable than pinning today's no-evidence constants,
// because it stays true if those defaults are ever legitimately re-tuned.
//
// `baselineEngine.js` and `chronobiology.js` — both W4-004, both pure — already carry the corrected
// helper and a comment naming this exact trap. `translate.js`, the one on the serving path, is the
// file that never got it.

process.env.NODE_ENV = 'test';

const {
  translate, HRV_FALLBACK, ABSTENTION_FLAG, MIN_SPREAD, _finite,
} = require('../app/services/biosonic/translate');
const { POPULATION, MIN_SPREAD: ENGINE_MIN_SPREAD } =
  require('../app/agents/runtime/physiology/baselineEngine');

const RESTING = { heartRate: 70, activity: 'resting' };

/** The full emitted target object, for differential comparison. `translate` is clock-free. */
const targetsOf = (input) => JSON.stringify(translate(input));

/**
 * The core assertion of this suite: supplying `key: null` changes NOTHING versus not supplying it.
 * Compared over the whole 13-key superset, not just the term under discussion, because the
 * coercion leaked into confidence and band width as well as into the state triple.
 */
function expectIndistinguishable(withNull, withAbsent) {
  expect(targetsOf(withNull)).toBe(targetsOf(withAbsent));
}

describe('W4-D15 · a null resting-HR baseline makes the stress term abstain, not saturate', () => {
  const nulled = { live: RESTING, baselines: { rhrMedian: null, rhrMAD: null } };
  const absent = { live: RESTING, baselines: {} };

  it('scores a calm resting user the same with a null baseline as with no baseline at all', () => {
    expectIndistinguishable(nulled, absent);
  });

  it('does not saturate stress — the pre-fix value was exactly 1.0', () => {
    expect(translate(nulled).state.stress).toBeLessThan(0.5);
    expect(translate(nulled).state.stress).toBe(translate(absent).state.stress);
  });

  // The saturation was independent of the heart rate, which is the tell that it was an anchor
  // fault rather than a threshold fault: z = (HR - 0) / (1.4826 * spread) exceeds the clamp for
  // any human pulse. A 40 bpm athlete at rest was scored maximally stressed.
  it.each([40, 55, 70, 95])('holds at %i bpm — the pre-fix term saturated at every rate', (hr) => {
    const t = translate({ live: { heartRate: hr, activity: 'resting' }, baselines: { rhrMedian: null, rhrMAD: null } });
    expect(t.state.stress).toBe(translate({ live: { heartRate: hr, activity: 'resting' }, baselines: {} }).state.stress);
    expect(t.state.stress).toBeLessThan(0.5);
  });

  it('does not deliver the D3 target profile (narrow, acoustic, instrumental, forced-cheerful)', () => {
    const t = translate(nulled);
    // Pre-fix, measured: bpmWidth 8, acousticnessBias 0.3, instrumentalBias 0.2, valenceTarget 0.6.
    expect(t.bpmWidth).toBeGreaterThan(8);
    expect(t.acousticnessBias).toBe(0);
    expect(t.instrumentalBias).toBe(0);
  });

  it('an unparseable median abstains the same way a null one does', () => {
    for (const bad of ['', '   ', false, true, [], {}, NaN, undefined]) {
      expectIndistinguishable({ live: RESTING, baselines: { rhrMedian: bad, rhrMAD: 4 } },
        { live: RESTING, baselines: { rhrMAD: 4 } });
    }
  });

  // Abstention must not become blanket suppression: the term is the point of the engine.
  it('still scores an elevated resting HR when the baseline is REAL', () => {
    const calm = translate({ live: { heartRate: 60, activity: 'resting' }, baselines: { rhrMedian: 58, rhrMAD: 4 } });
    const raised = translate({ live: { heartRate: 80, activity: 'resting' }, baselines: { rhrMedian: 58, rhrMAD: 4 } });
    expect(raised.state.stress).toBeGreaterThan(calm.state.stress);
    expect(raised.state.stress).toBeGreaterThan(0.2);
  });

  it('a real median with a null MAD still scores, using the fallback spread', () => {
    const t = translate({ live: { heartRate: 80, activity: 'resting' }, baselines: { rhrMedian: 58, rhrMAD: null } });
    expect(t.state.stress).toBeGreaterThan(0.2);
    expect(Number.isFinite(t.state.stress)).toBe(true);
  });
});

describe('W4-D15 · the same coercion at every other input the engine reads', () => {
  // Each of these was measured pre-fix on the real translate() and each landed on the alarming
  // reading of "no data": recovery 0 (a wrecked body) or stress 1.0 (a distressed one).
  it('state.hrv: null abstains — pre-fix it meant "HRV of zero" (R=0, S=1.0)', () => {
    expectIndistinguishable({ live: RESTING, state: { hrv: null } }, { live: RESTING, state: {} });
  });

  it('state.bodyBattery: null abstains — pre-fix R collapsed to 0', () => {
    expectIndistinguishable({ live: RESTING, state: { bodyBattery: null } }, { live: RESTING, state: {} });
  });

  it('state.dailyReadiness: null abstains — pre-fix R collapsed to 0', () => {
    expectIndistinguishable({ live: RESTING, state: { dailyReadiness: null } }, { live: RESTING, state: {} });
  });

  it('an empty-string vital abstains (Number("") === 0 too)', () => {
    expectIndistinguishable({ live: RESTING, state: { bodyBattery: '' } }, { live: RESTING, state: {} });
  });

  it('sleep.lastNight with all-null stages abstains — pre-fix it meant a sleepless night', () => {
    expectIndistinguishable(
      { live: RESTING, sleep: { lastNight: { deep: null, light: null, rem: null } } },
      { live: RESTING, sleep: {} },
    );
  });

  it('live.heartRate: null abstains — pre-fix the reading was a pulse of 0 bpm', () => {
    expectIndistinguishable(
      { live: { heartRate: null, activity: 'resting' }, baselines: { rhrMedian: 62, rhrMAD: 3 } },
      { live: { activity: 'resting' }, baselines: { rhrMedian: 62, rhrMAD: 3 } },
    );
  });

  it('a null heart rate does not fabricate a resting-elevation score', () => {
    // Pre-fix: HR coerced to 0, z came out hugely NEGATIVE, clamped to 0, and the term reported
    // "zero stress, measured" — a claim from no data — instead of standing down.
    const t = translate({ live: { heartRate: null, activity: 'resting' }, baselines: { rhrMedian: 62, rhrMAD: 3 } });
    expect(t.state.stress).toBe(translate({ live: { activity: 'resting' } }).state.stress);
  });
});

describe('W4-D15 · zero is still a measurement (the fix must not over-reject)', () => {
  it('a genuine zero-minute sleep stage is honoured, not dropped', () => {
    const noDeep = translate({ live: RESTING, sleep: { lastNight: { deep: 0, light: 300, rem: 90 } } });
    const someDeep = translate({ live: RESTING, sleep: { lastNight: { deep: 90, light: 300, rem: 90 } } });
    expect(noDeep.state.recovery).toBeLessThan(someDeep.state.recovery);
  });

  it('bodyBattery 0 is a real (dire) reading, distinct from an absent one', () => {
    const flat = translate({ live: RESTING, state: { bodyBattery: 0 } });
    expect(flat.state.recovery).toBeLessThan(translate({ live: RESTING, state: {} }).state.recovery);
  });

  it('numeric strings still parse — batch payloads deliver them', () => {
    expect(targetsOf({ live: { heartRate: '72', activity: 'resting' }, state: { bodyBattery: '55' } }))
      .toBe(targetsOf({ live: { heartRate: 72, activity: 'resting' }, state: { bodyBattery: 55 } }));
  });

  it('_finite maps the no-measurement shapes to null and everything numeric to a number', () => {
    for (const x of [null, undefined, '', '  ', false, true, [], [5], {}, NaN, Infinity, -Infinity, 'abc']) {
      expect(_finite(x)).toBeNull();
    }
    for (const [x, want] of [[0, 0], [-0, -0], [72, 72], ['72', 72], ['  72  ', 72], [1e-12, 1e-12]]) {
      expect(_finite(x)).toBe(want);
    }
  });
});

describe('W4-D15 · a degenerate SPREAD saturates the same way a null median did', () => {
  // Found by de-vacuuming shadow.qa4's "negative and sub-epsilon MAD are treated as fallback
  // spread" — a test whose title had claimed this since it was written and whose body only checked
  // finiteness. Measured pre-fix: `rhrMAD: 1e-12` gave recovery 0 and stress 1.0, because the old
  // guard asked only whether the spread was `> 0`. Same outcome as the null median, different
  // route: a spread of 1e-12 is numerical debris, not a person whose pulse never varies.
  // `baselineEngine` has floored its own output at MIN_SPREAD since W4-004 — its comment names D3
  // — but `translate` accepts baselines the engine never produced.
  const withMad = (mad) => translate({
    live: { heartRate: 72, activity: 'resting' },
    baselines: { rhrMedian: 60, rhrMAD: mad, hrvMedian: 45, hrvMAD: mad },
    state: { hrv: 40 },
  });

  it('a sub-MIN_SPREAD MAD falls back instead of exploding the z-score', () => {
    expect(withMad(1e-12).state).toEqual(withMad(undefined).state);
    expect(withMad(1e-12).state.stress).toBeLessThan(1);
  });

  it.each([-5, -0, 0, 1e-12, 0.5, MIN_SPREAD - 1e-9])('MAD %p is not a usable spread', (mad) => {
    expect(withMad(mad).state).toEqual(withMad(undefined).state);
  });

  it('a spread AT the floor is honoured — the floor is inclusive, not a dead band', () => {
    expect(withMad(MIN_SPREAD).state).not.toEqual(withMad(undefined).state);
    expect(withMad(4).state).not.toEqual(withMad(undefined).state);
  });

  it('MIN_SPREAD is the engine constant, not a second copy of it', () => {
    expect(MIN_SPREAD).toBe(ENGINE_MIN_SPREAD);
  });
});

describe('W4-D15 · confidence stops counting a null baseline as a known one', () => {
  it('null baselines report the same confidence as absent baselines', () => {
    // Pre-fix: 0.65 with the nulls present versus 0.48 with them absent — the D14 ladder counted
    // the baseline group as SATISFIED because `finite(null)` was a number. A user we know nothing
    // about was served a narrower band than the ladder intends for a stranger.
    const nulled = translate({ live: RESTING, baselines: { rhrMedian: null, hrvMedian: null } });
    const absent = translate({ live: RESTING, baselines: {} });
    expect(nulled.confidence).toBe(absent.confidence);
    expect(nulled.bpmWidth).toBe(absent.bpmWidth);
  });

  it('a real baseline still counts toward confidence', () => {
    const known = translate({ live: RESTING, baselines: { rhrMedian: 58, rhrMAD: 4 } });
    expect(known.confidence).toBeGreaterThan(translate({ live: RESTING, baselines: {} }).confidence);
  });
});

describe('W4-D15 · S11 kill-switch restores the pre-fix behaviour without a revert', () => {
  // This is the only suite in the tree that switches translate's behaviour through the
  // environment, and jest runs every suite in ONE process under `--runInBand`. A flag left set
  // here would silently change the serving path for every suite that follows, which is a
  // cross-suite flake vector of exactly the kind W4-D06 and W4-D09 were opened for. Cleared
  // after each test AND after the describe, so no throw can strand it.
  afterEach(() => { delete process.env[ABSTENTION_FLAG]; });
  afterAll(() => { delete process.env[ABSTENTION_FLAG]; });

  it('the flag is read per call, so the old numbers come back exactly', () => {
    const input = { live: RESTING, baselines: { rhrMedian: null, rhrMAD: null } };
    expect(translate(input).state.stress).toBeLessThan(0.5);

    process.env[ABSTENTION_FLAG] = '1';
    const legacy = translate(input);
    // The measured pre-fix profile, byte for byte.
    expect(legacy.state.stress).toBe(1);
    expect(legacy.bpmWidth).toBe(8);
    expect(legacy.acousticnessBias).toBe(0.3);
    expect(legacy.instrumentalBias).toBe(0.2);
    expect(legacy.valenceTarget).toBe(0.6);
    expect(legacy.confidence).toBe(0.65);

    delete process.env[ABSTENTION_FLAG];
    expect(translate(input).state.stress).toBeLessThan(0.5);
  });

  it('the hatch covers the MIN_SPREAD floor too, not only the coercion', () => {
    const degenerate = {
      live: { heartRate: 72, activity: 'resting' },
      baselines: { rhrMedian: 60, rhrMAD: 1e-12, hrvMedian: 45, hrvMAD: 1e-12 },
      state: { hrv: 40 },
    };
    expect(translate(degenerate).state.stress).toBeLessThan(1);
    process.env[ABSTENTION_FLAG] = '1';
    expect(translate(degenerate).state.stress).toBe(1);   // the measured pre-fix value
    expect(translate(degenerate).state.recovery).toBe(0);
  });

  it('the flag changes nothing for inputs that carry no null-shaped values', () => {
    const input = { live: { heartRate: 80, activity: 'resting' }, baselines: { rhrMedian: 58, rhrMAD: 4 }, state: { hrv: 40 } };
    const on = (() => { process.env[ABSTENTION_FLAG] = '1'; return targetsOf(input); })();
    delete process.env[ABSTENTION_FLAG];
    expect(on).toBe(targetsOf(input));
  });
});

describe('W4-D15(e) · the HRV fallback coincidence is pinned, not left to luck', () => {
  // `baselines.js` nulls the RHR pair when there is no personal evidence, so `translate` abstains.
  // The HRV pair is handled the same way — and the reason it is SAFE to null it is that translate
  // owns its own population fallback for HRV, whose numbers happen to equal the engine's prior
  // exactly. Nothing pinned that equality, so a change to POPULATION.hrv would have silently moved
  // every user's HRV scoring while every test stayed green.
  it('HRV_FALLBACK equals the engine POPULATION.hrv prior', () => {
    expect(HRV_FALLBACK.median).toBe(POPULATION.hrv.value);
    expect(HRV_FALLBACK.mad).toBe(POPULATION.hrv.spread);
  });

  it('a null HRV pair SCORES identically to the engine prior being passed through', () => {
    const live = { heartRate: 70, activity: 'resting' };
    const state = { hrv: 50 };
    const nulled = translate({ live, state, baselines: { hrvMedian: null, hrvMAD: null } });
    const prior = translate({ live, state, baselines: { hrvMedian: POPULATION.hrv.value, hrvMAD: POPULATION.hrv.spread } });
    expect(nulled.state).toEqual(prior.state);
    expect(nulled.bpmCenter).toBe(prior.bpmCenter);
    expect(nulled.energyCeiling).toBe(prior.energyCeiling);
  });

  it('...but reports LOWER confidence, which is the whole point of nulling it', () => {
    // The numbers are the same; the epistemic status is not. Passing the prior through the legacy
    // key would launder "we have never measured this person" into "we measured 45", and the D14
    // confidence ladder would then serve a total stranger the band width of a known user.
    const live = { heartRate: 70, activity: 'resting' };
    const state = { hrv: 50 };
    const nulled = translate({ live, state, baselines: { hrvMedian: null, hrvMAD: null } });
    const prior = translate({ live, state, baselines: { hrvMedian: POPULATION.hrv.value, hrvMAD: POPULATION.hrv.spread } });
    expect(nulled.confidence).toBeLessThan(prior.confidence);
  });
});
