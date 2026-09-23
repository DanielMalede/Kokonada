'use strict';

// A5 — the wellbeing regulator (W4-006, pure-core half). A PURE decorator over `translate()`'s
// target object: it may tighten the target under strain, and it attaches the trajectory that
// W4-008 will sequence a playlist along. It is the structural mechanism behind VISION §6's
// "regulator, not a mirror".
//
// THE INVARIANT THIS SUITE EXISTS FOR — MONOTONE TIGHTENING. Every single change the regulator is
// permitted to make points the same way: energy down, texture calmer, tempo window narrower. It
// has no vocabulary for raising energy, brightening valence or widening a band. That is what
// makes "inferred agitation must never amplify agitation" a property of the code rather than a
// promise in a document, and it is fuzz-pinned below over arbitrary targets and arbitrary affect.
//
// Down-regulation is achieved by TRAJECTORY, never by forcing valence (D4's second half). The
// regulator therefore never touches `valenceTarget` at all — the arc's start meets the listener
// where they are and its end is where the state's policy wants to take them, which is the
// iso-principle expressed as data rather than as a cap.

const fc = require('fast-check');

const {
  apply, DISABLE_ENV_VAR, REGULATOR_VERSION, MIN_REGULATION_CONFIDENCE,
  MAX_CEILING_CUT, MIN_ENERGY_GAP, TRAJECTORY_VERSION,
} = require('../app/agents/runtime/translation/wellbeingRegulator');
const { byId, ARCHETYPE_DIRECTION } = require('../app/agents/runtime/knowledge/stateTaxonomy');
const { translate } = require('../app/services/biosonic/translate');

// The 13 keys §0.2.5 freezes. Named here so a rename anywhere shows up as a failure here.
const SUPERSET_KEYS = [
  'bpmCenter', 'bpmWidth', 'energyFloor', 'energyCeiling', 'valenceTarget', 'acousticnessBias',
  'instrumentalBias', 'tempoBand', 'confidence', 'activityDriven', 'activityIntensity', 'state',
  'version',
];
// The ones the regulator is allowed to move at all. Everything else must come through byte-equal.
const MUTABLE = ['energyFloor', 'energyCeiling', 'acousticnessBias', 'instrumentalBias', 'bpmWidth'];

function affectFor(stateId, { stress = 0.5, recovery = 0.5, arousal = 0.5, exertion = 0.2, confidence = 0.8 } = {}) {
  const ax = (v) => ({ value: v, mass: 0.8 });
  return {
    v: 'affect/v1',
    axes: {
      arousal: ax(arousal), stress: ax(stress), recovery: ax(recovery), exertion: ax(exertion),
      fatigue: ax(0.3), circadianAlertness: ax(0.5), valence: ax(0.5),
    },
    label: stateId,
    topState: stateId ? { id: stateId, domain: byId(stateId)?.domain, band: byId(stateId)?.band, alpha: 0.6 } : null,
    posteriorEntropy: 0.4,
    confidence,
  };
}

// Mood-only: no activity chip, so `activityDriven` is false and the passive recovery cap applies.
// This is the shape the regulator is allowed to tighten.
const CALM_TARGETS = () => translate({
  moodKey: 'calm', live: { heartRate: 62 }, hourOfDay: 21,
});
const WORKOUT_TARGETS = () => translate({
  moodKey: 'energetic', live: { activity: 'workout', heartRate: 150 }, hourOfDay: 18,
});

describe('wellbeingRegulator — the superset contract (§0.2.5)', () => {
  test('every original key survives, and only the tightening ones may differ', () => {
    const before = CALM_TARGETS();
    const after = apply(before, affectFor('overload-needs-downshift', { stress: 0.8, recovery: 0.2 }));
    for (const k of SUPERSET_KEYS) expect(after).toHaveProperty(k);
    for (const k of SUPERSET_KEYS) {
      if (MUTABLE.includes(k)) continue;
      expect(after[k]).toEqual(before[k]);
    }
    expect(after.state).toEqual(before.state);
  });

  test('the new keys are additive and versioned', () => {
    const after = apply(CALM_TARGETS(), affectFor('acute-stress', { stress: 0.85, recovery: 0.4 }));
    expect(after.stateId).toBe('acute-stress');
    expect(after.trajectory.v).toBe(TRAJECTORY_VERSION);
    expect(after.regulator).toEqual({ v: REGULATOR_VERSION, demand: expect.any(Number) });
  });

  test('the input object is never mutated — a decorator, not a rewriter', () => {
    const before = CALM_TARGETS();
    const snapshot = JSON.parse(JSON.stringify(before));
    apply(before, affectFor('acute-stress', { stress: 0.85, recovery: 0.3 }));
    expect(before).toEqual(snapshot);
  });
});

describe('wellbeingRegulator — monotone tightening (VISION §6, mechanised)', () => {
  test('over arbitrary targets and arbitrary affect, it can only ever tighten', () => {
    const arbTargets = fc.record({
      version: fc.constant('biosonic/v1'),
      bpmCenter: fc.integer({ min: 30, max: 220 }),
      bpmWidth: fc.integer({ min: 6, max: 40 }),
      energyFloor: fc.double({ min: 0, max: 0.9, noNaN: true }),
      energyCeiling: fc.double({ min: 0.1, max: 1, noNaN: true }),
      valenceTarget: fc.double({ min: 0, max: 1, noNaN: true }),
      acousticnessBias: fc.double({ min: 0, max: 0.4, noNaN: true }),
      instrumentalBias: fc.double({ min: 0, max: 0.4, noNaN: true }),
      tempoBand: fc.constantFrom('resting', 'active', 'peak'),
      confidence: fc.double({ min: 0.3, max: 1, noNaN: true }),
      activityDriven: fc.boolean(),
      activityIntensity: fc.constantFrom(null, 'high', 'low'),
      state: fc.constant({ recovery: 0.5, stress: 0.5, exertion: 0.3 }),
    }).map((t) => ({ ...t, energyFloor: Math.min(t.energyFloor, Math.max(0, t.energyCeiling - 0.05)) }));

    const unit = fc.double({ min: 0, max: 1, noNaN: true });
    const arbAffect = fc.record({
      stateId: fc.constantFrom(null, 'acute-stress', 'peak-effort', 'deep-rest', 'neutral-baseline', 'overload-needs-downshift', 'creative-flow'),
      stress: unit, recovery: unit, arousal: unit, exertion: unit, confidence: unit,
    });

    fc.assert(fc.property(arbTargets, arbAffect, (t, a) => {
      const out = apply(t, a.stateId === null ? null : affectFor(a.stateId, a));
      // never amplifies
      expect(out.energyCeiling).toBeLessThanOrEqual(t.energyCeiling + 1e-9);
      expect(out.energyFloor).toBeLessThanOrEqual(t.energyFloor + 1e-9);
      expect(out.bpmWidth).toBeLessThanOrEqual(t.bpmWidth);
      expect(out.acousticnessBias).toBeGreaterThanOrEqual(t.acousticnessBias - 1e-9);
      expect(out.instrumentalBias).toBeGreaterThanOrEqual(t.instrumentalBias - 1e-9);
      // never forces mood, never moves the centre
      expect(out.valenceTarget).toBe(t.valenceTarget);
      expect(out.bpmCenter).toBe(t.bpmCenter);
      expect(out.tempoBand).toBe(t.tempoBand);
      // stays a usable target
      expect(out.energyCeiling).toBeGreaterThan(out.energyFloor);
      expect(out.energyCeiling - out.energyFloor).toBeGreaterThanOrEqual(MIN_ENERGY_GAP - 1e-9);
      for (const k of ['energyFloor', 'energyCeiling', 'acousticnessBias', 'instrumentalBias']) {
        expect(Number.isFinite(out[k])).toBe(true);
        expect(out[k]).toBeGreaterThanOrEqual(0);
        expect(out[k]).toBeLessThanOrEqual(1);
      }
      expect(out.bpmWidth).toBeGreaterThan(0);
      return true;
    }), { numRuns: 300 });
  });

  test('texture caps hold at the values translate itself respects', () => {
    const t = { ...CALM_TARGETS(), acousticnessBias: 0.38, instrumentalBias: 0.38 };
    const out = apply(t, affectFor('overload-needs-downshift', { stress: 1, recovery: 0 }));
    expect(out.acousticnessBias).toBeLessThanOrEqual(0.4);
    expect(out.instrumentalBias).toBeLessThanOrEqual(0.4);
  });

  test('the cut is bounded — a regulator, not a mute button', () => {
    const before = CALM_TARGETS();
    const after = apply(before, affectFor('overload-needs-downshift', { stress: 1, recovery: 0 }));
    expect(before.energyCeiling - after.energyCeiling).toBeLessThanOrEqual(MAX_CEILING_CUT + 1e-9);
  });
});

describe('wellbeingRegulator — when it must do nothing at all', () => {
  const cases = [
    ['no affect at all', null],
    ['affect with no reported label', { ...affectFor('deep-rest'), label: null, topState: null }],
    ['a label below the confidence floor', affectFor('acute-stress', { stress: 0.9, recovery: 0.2, confidence: MIN_REGULATION_CONFIDENCE - 0.01 })],
    ['a label the taxonomy does not contain', { ...affectFor('deep-rest'), label: 'not-a-state' }],
  ];
  test.each(cases)('identity on %s', (_name, affect) => {
    const before = CALM_TARGETS();
    const after = apply(before, affect);
    expect(after).toBe(before); // the same object, not merely an equal one
  });

  test('identity when disabled, so the kill switch is a real escape hatch (S11)', () => {
    const before = CALM_TARGETS();
    expect(apply(before, affectFor('acute-stress', { stress: 0.95, recovery: 0.1 }), { disabled: true })).toBe(before);
    // the module names the flag but never reads it — the wiring half owns process.env
    expect(DISABLE_ENV_VAR).toBe('WAVE4_TRAJECTORY_DISABLED');
    const src = require('fs').readFileSync(
      require.resolve('../app/agents/runtime/translation/wellbeingRegulator'), 'utf8',
    );
    expect(src).not.toMatch(/process\.env|Date\.now|Math\.random/);
  });

  test('idempotent — decorating an already-decorated target changes nothing further', () => {
    const affect = affectFor('acute-stress', { stress: 0.85, recovery: 0.3 });
    const once = apply(CALM_TARGETS(), affect);
    const twice = apply(once, affect);
    expect(twice).toEqual(once);
  });

  test('a hostile target does not produce a hostile result', () => {
    for (const bad of [null, undefined, 42, 'targets', []]) {
      expect(() => apply(bad, affectFor('deep-rest'))).toThrow(TypeError);
    }
  });
});

describe('wellbeingRegulator — the trajectory is the iso-principle, as data', () => {
  test('it MEETS the listener: the arc starts at their current arousal, not at the goal', () => {
    const before = CALM_TARGETS();
    const high = apply(before, affectFor('acute-stress', { stress: 0.85, arousal: 0.85, recovery: 0.35 }));
    const low = apply(before, affectFor('acute-stress', { stress: 0.85, arousal: 0.25, recovery: 0.35 }));
    expect(high.trajectory.start.energy).toBeGreaterThan(low.trajectory.start.energy);
    expect(high.trajectory.start.bpm).toBeGreaterThanOrEqual(low.trajectory.start.bpm);
  });

  test('and then GUIDES: a down-regulating archetype ends below where it started', () => {
    const out = apply(CALM_TARGETS(), affectFor('acute-stress', { stress: 0.9, arousal: 0.8, recovery: 0.3 }));
    expect(ARCHETYPE_DIRECTION[out.trajectory.archetype]).toBe(-1);
    expect(out.trajectory.end.energy).toBeLessThanOrEqual(out.trajectory.start.energy);
    expect(out.trajectory.end.bpm).toBeLessThanOrEqual(out.trajectory.start.bpm);
  });

  test('every endpoint is REALISABLE inside the hard band the scorer enforces', () => {
    // A trajectory whose start lies outside `bpmCenter ± bpmWidth` asks W4-008 for a track the
    // band filter will have already thrown away. Pinned over the whole taxonomy.
    const targets = [CALM_TARGETS(), WORKOUT_TARGETS()];
    for (const t of targets) {
      for (const stateId of ['deep-rest', 'acute-stress', 'peak-effort', 'creative-flow', 'overload-needs-downshift', 'casual-walk', 'pre-sleep']) {
        for (const arousal of [0.05, 0.5, 0.95]) {
          const out = apply(t, affectFor(stateId, { arousal, stress: 0.5, recovery: 0.5 }));
          for (const point of [out.trajectory.start, out.trajectory.end]) {
            expect(point.bpm).toBeGreaterThanOrEqual(out.bpmCenter - out.bpmWidth);
            expect(point.bpm).toBeLessThanOrEqual(out.bpmCenter + out.bpmWidth);
            expect(point.energy).toBeGreaterThanOrEqual(out.energyFloor - 1e-9);
            expect(point.energy).toBeLessThanOrEqual(out.energyCeiling + 1e-9);
          }
        }
      }
    }
  });

  test('the archetype and the valence approach come from the taxonomy, not from here', () => {
    for (const stateId of ['deep-rest', 'peak-effort', 'creative-flow', 'morning-sluggish']) {
      const out = apply(CALM_TARGETS(), affectFor(stateId));
      expect(out.trajectory.archetype).toBe(byId(stateId).musicPolicy.trajectoryArchetype);
      expect(out.trajectory.valenceApproach).toBe(byId(stateId).musicPolicy.valenceApproach);
    }
  });
});

describe('wellbeingRegulator — the product gates it must not break (§0.2.6)', () => {
  test('an explicit activity is not overruled: intent wins, the arc regulates instead', () => {
    // translate() deliberately LIFTS the passive recovery cap for an explicit activity chip
    // ("user intent wins"). Capping it back down here would quietly undo that product decision,
    // so under an activity-driven target the regulator regulates through the arc alone.
    //
    // The state has to be one the regulator WOULD otherwise cap, or this asserts nothing. The
    // first version of this test used `obligated-workout-low-recovery`, which is already exempt
    // through its own activating direction and positive energy bias — deleting the product gate
    // entirely left the suite green. `cooldown` is down-regulating with a negative energy bias,
    // so it reaches the gate and the gate is the only thing stopping the cut. (Found by the
    // stub-out battery; the assertion was passing for the wrong reason.)
    const before = WORKOUT_TARGETS();
    expect(before.activityDriven).toBe(true);
    const state = byId('cooldown');
    expect(ARCHETYPE_DIRECTION[state.musicPolicy.trajectoryArchetype]).toBeLessThanOrEqual(0);
    expect(state.musicPolicy.energyBias).toBeLessThanOrEqual(0);

    const after = apply(before, affectFor('cooldown', { stress: 0.75, recovery: 0.15, arousal: 0.6 }));
    expect(after.regulator.demand).toBeGreaterThan(0); // there IS strain to regulate
    expect(after.energyCeiling).toBe(before.energyCeiling); // ...and the chip still wins
    expect(after.energyFloor).toBe(before.energyFloor);

    // The same state against a PASSIVE target is capped, which is what proves the gate is the
    // discriminator rather than some other exemption.
    const passive = apply(CALM_TARGETS(), affectFor('cooldown', { stress: 0.75, recovery: 0.15, arousal: 0.6 }));
    expect(passive.energyCeiling).toBeLessThan(CALM_TARGETS().energyCeiling);
  });

  test('...but an activity-driven target is still regulated through the arc', () => {
    const before = WORKOUT_TARGETS();
    const after = apply(before, affectFor('obligated-workout-low-recovery', { stress: 0.6, recovery: 0.1 }));
    expect(after.trajectory.intensityScale).toBeLessThan(1);
    expect(after.acousticnessBias).toBeGreaterThanOrEqual(before.acousticnessBias);
  });

  test('a passive target IS capped, and more so the more strain there is', () => {
    const before = CALM_TARGETS();
    expect(before.activityDriven).toBe(false);
    const mild = apply(before, affectFor('recovering-from-stress', { stress: 0.45, recovery: 0.6 }));
    const heavy = apply(before, affectFor('overload-needs-downshift', { stress: 0.9, recovery: 0.15 }));
    expect(heavy.energyCeiling).toBeLessThan(mild.energyCeiling);
    expect(mild.energyCeiling).toBeLessThanOrEqual(before.energyCeiling);
    expect(heavy.regulator.demand).toBeGreaterThan(mild.regulator.demand);
  });

  test('a calm, well-recovered listener is left alone apart from their arc', () => {
    const before = CALM_TARGETS();
    const after = apply(before, affectFor('resting-content', { stress: 0.1, recovery: 0.85, arousal: 0.35 }));
    expect(after.regulator.demand).toBe(0);
    expect(after.energyCeiling).toBe(before.energyCeiling);
    expect(after.bpmWidth).toBe(before.bpmWidth);
    expect(after.trajectory).toBeDefined();
  });

  test('an activating state never has its energy cut, whatever the arc says', () => {
    for (const stateId of ['peak-effort', 'steady-cardio', 'morning-activation', 'energized-positive']) {
      const before = CALM_TARGETS();
      const after = apply(before, affectFor(stateId, { stress: 0.2, recovery: 0.7, arousal: 0.7 }));
      expect(after.energyCeiling).toBe(before.energyCeiling);
    }
  });
});

describe('wellbeingRegulator — zero knowledge', () => {
  test('nothing it emits carries a vital, at any depth', () => {
    const out = apply(CALM_TARGETS(), affectFor('acute-stress', { stress: 0.9, recovery: 0.2 }));
    const blob = JSON.stringify(out);
    expect(blob).not.toMatch(/heartRate|rmssd|hrv|spO2|bodyBattery|restingHeartRate/i);
    // the state id is internal vocabulary; it is a closed token, never prose about a person
    expect(out.stateId).toMatch(/^[a-z][a-z-]*[a-z]$/);
  });

  test('its telemetry line is bands and tokens only (S15)', () => {
    const out = apply(CALM_TARGETS(), affectFor('acute-stress', { stress: 0.9, recovery: 0.2 }));
    expect(out.regulator).toBeDefined();
    expect(typeof out.telemetry).toBe('string');
    expect(out.telemetry).toMatch(/^\[regulator\]/);
    expect(out.telemetry).not.toMatch(/heartRate|hrv|bpm=\d{3}/i);
  });
});
