'use strict';

// W4-D63 — the PURE half of "which taxonomy states can the real stack actually reach?".
//
// `tests/stateTaxonomy.reachability.test.js` proves all 34 states are reachable in the PURE
// engine from a purpose-built script. `tests/sim.fullStackSoak.test.js` measured 11 through the
// real socket lane and asserted only a floor (`hit.length > 2`), which is honest but is not a
// number W4-015 can cite. The gap between 34 and 11 is not the corpus — it is the SEAM: the live
// lane hands `resolveAffect` a heart rate and a baseline blob and nothing else, so every axis fed
// by sleep, HRV, body battery, readiness or a mood tap abstains before the taxonomy is consulted.
//
// So the measurement has to say WHICH states a lane cannot reach and WHY, from the run that
// missed them rather than from an author's claim. That reasoning is pure — a fold over
// (target, reported label, per-axis mass) triples — and lives here, away from Mongo, so it can be
// pinned exhaustively and cheaply. `tests/sim.stateCoverage.soak.test.js` supplies the real
// triples from the real seams.

const {
  measureStateCoverage, coverageScope, MISS_REASONS,
} = require('../sim/stateCoverage');
const { SCRIPTS } = require('../sim/stateScripts');
const { STATES, byId } = require('../app/agents/runtime/knowledge/stateTaxonomy');

const AXES = ['arousal', 'stress', 'recovery', 'exertion', 'fatigue', 'circadianAlertness', 'valence'];

/** An axis bag where everything carried evidence, minus the named abstentions. */
function axesWith(abstained = []) {
  const out = {};
  for (const a of AXES) out[a] = { value: 0.5, mass: abstained.includes(a) ? 0 : 0.8 };
  return out;
}

/** One lane result: this script targeted `target` and the lane reported `label`. */
const result = (target, label, abstained = []) => ({
  target, persona: 'athlete', label, axes: axesWith(abstained),
});

/** Every state reached by its own script, nothing abstaining — the perfect lane. */
const perfectRun = () => STATES.map((s) => result(s.id, s.id));

describe('measureStateCoverage — the number', () => {
  test('a lane that reaches every targeted state reports full coverage', () => {
    const r = measureStateCoverage({ lane: 'pure', states: STATES, results: perfectRun() });
    expect(r.lane).toBe('pure');
    expect(r.taxonomySize).toBe(STATES.length);
    expect(r.targetedCount).toBe(STATES.length);
    expect(r.reachedCount).toBe(STATES.length);
    expect(r.coverage).toBe(1);
    expect(r.missed).toEqual([]);
    expect(r.untargeted).toEqual([]);
  });

  test('coverage is a NUMBER over the targeted corpus, not a floor', () => {
    const results = perfectRun();
    // three scripts land on a state that is already reached, so three targets go unreached
    results[0] = result(STATES[0].id, STATES[1].id);
    results[2] = result(STATES[2].id, STATES[1].id);
    results[3] = result(STATES[3].id, STATES[1].id);

    const r = measureStateCoverage({ lane: 'serving', states: STATES, results });
    expect(r.reachedCount).toBe(STATES.length - 3);
    expect(r.coverage).toBeCloseTo((STATES.length - 3) / STATES.length, 10);
    expect(r.missed.map((m) => m.id).sort())
      .toEqual([STATES[0].id, STATES[2].id, STATES[3].id].sort());
  });

  test('a state reached by SOMEONE ELSE\'S script still counts as reached', () => {
    // Coverage is a question about the taxonomy, not about the corpus's aim: if any run on the
    // lane resolved that label, the lane can produce it.
    const results = perfectRun();
    results[0] = result(STATES[0].id, STATES[1].id); // target 0 misses...
    results[1] = result(STATES[1].id, STATES[0].id); // ...but another run lands on it
    const r = measureStateCoverage({ lane: 'serving', states: STATES, results });
    expect(r.reachedCount).toBe(STATES.length);
    expect(r.missed).toEqual([]);
  });

  test('states with no run at all are `untargeted`, never counted as missed', () => {
    // The ungated smoke scope runs a handful of scripts. Reporting the other 30 as
    // "unreachable" would be a lie told by arithmetic.
    const results = [result(STATES[0].id, STATES[0].id), result(STATES[1].id, STATES[1].id)];
    const r = measureStateCoverage({ lane: 'smoke', states: STATES, results });
    expect(r.targetedCount).toBe(2);
    expect(r.reachedCount).toBe(2);
    expect(r.coverage).toBe(1);
    expect(r.missed).toEqual([]);
    expect(r.untargeted).toHaveLength(STATES.length - 2);
    expect(r.untargeted).not.toContain(STATES[0].id);
  });

  test('coverage counts TARGETS hit, not labels produced — a subset sweep cannot score 1.0 by drifting', () => {
    // The two are identical over the full 34-script sweep and diverge only on a subset, which is
    // precisely where the strided smoke scope lives: six scripts whose runs each drift onto a
    // neighbouring state produce six distinct real labels while hitting nothing they aimed at.
    // `reached / targeted` reports 1.0 for that sweep — and can exceed 1.0 outright.
    const results = [
      result(STATES[0].id, STATES[10].id),
      result(STATES[1].id, STATES[11].id),
      result(STATES[2].id, STATES[12].id),
    ];
    const r = measureStateCoverage({ lane: 'smoke', states: STATES, results });
    expect(r.targetedCount).toBe(3);
    expect(r.reachedCount).toBe(3);      // the lane really did produce three real states...
    expect(r.missed).toHaveLength(3);    // ...none of them the ones the scripts aimed at
    expect(r.coverage).toBe(0);
    expect(r.coverage).toBeLessThanOrEqual(1);
  });

  test('an empty corpus is coverage 0, not a divide-by-zero (§0.4 S8)', () => {
    const r = measureStateCoverage({ lane: 'none', states: STATES, results: [] });
    expect(r.targetedCount).toBe(0);
    expect(r.coverage).toBe(0);
    expect(Number.isFinite(r.coverage)).toBe(true);
    expect(r.untargeted).toHaveLength(STATES.length);
  });
});

describe('measureStateCoverage — the reason a state was not reached', () => {
  test('a required axis that carried NO mass is named as the reason', () => {
    const target = STATES.find((s) => s.requiredSignals.includes('recovery'));
    const results = perfectRun().map((r) => (r.target === target.id
      ? result(target.id, 'neutral-baseline', ['recovery', 'valence'])
      : r));

    const r = measureStateCoverage({ lane: 'live', states: STATES, results });
    const miss = r.missed.find((m) => m.id === target.id);
    expect(miss).toBeDefined();
    expect(miss.reason).toBe(MISS_REASONS.SIGNAL_ABSENT);
    // only the abstentions this state actually REQUIRES — `valence` abstained too but this
    // state never asked for it, so naming it would misattribute the cause.
    expect(miss.abstainedRequired).toEqual(['recovery']);
    expect(miss.reportedInstead).toBe('neutral-baseline');
  });

  test('when every required axis carried evidence, the miss is a contest, not a blind spot', () => {
    const target = STATES[5];
    const results = perfectRun().map((r) => (r.target === target.id
      ? result(target.id, STATES[6].id)
      : r));
    const r = measureStateCoverage({ lane: 'serving', states: STATES, results });
    const miss = r.missed.find((m) => m.id === target.id);
    expect(miss.reason).toBe(MISS_REASONS.OUTCOMPETED);
    expect(miss.abstainedRequired).toEqual([]);
    expect(miss.reportedInstead).toBe(STATES[6].id);
  });

  test('a run that resolved no label at all is reported as such', () => {
    const target = STATES[7];
    const results = perfectRun().map((r) => (r.target === target.id
      ? result(target.id, null, ['arousal'])
      : r));
    const r = measureStateCoverage({ lane: 'live', states: STATES, results });
    const miss = r.missed.find((m) => m.id === target.id);
    expect(miss.reason).toBe(MISS_REASONS.NO_LABEL);
    expect(miss.reportedInstead).toBeNull();
  });

  test('EVERY missed state carries a reason drawn from the closed vocabulary', () => {
    // The DoD W4-D63 set: a miss without a named reason is the "claim instead of a measurement"
    // the row exists to kill. A closed vocabulary is what lets W4-015 cite it.
    const results = perfectRun().map((r, i) => (i % 2
      ? result(r.target, 'neutral-baseline', byId(r.target).requiredSignals.slice(0, 1))
      : r));
    const r = measureStateCoverage({ lane: 'live', states: STATES, results });
    expect(r.missed.length).toBeGreaterThan(0);
    for (const m of r.missed) {
      expect(Object.values(MISS_REASONS)).toContain(m.reason);
      expect(typeof m.explain).toBe('string');
      expect(m.explain.length).toBeGreaterThan(0);
    }
  });

  test('the missed list is ordered by state id, so two runs diff cleanly', () => {
    const results = perfectRun().map((r) => result(r.target, 'neutral-baseline'));
    const r = measureStateCoverage({ lane: 'live', states: STATES, results });
    expect(r.missed.map((m) => m.id)).toEqual([...r.missed.map((m) => m.id)].sort());
  });
});

describe('measureStateCoverage — hygiene', () => {
  test('a reported label that is not a state at all is surfaced, not silently counted', () => {
    const results = perfectRun();
    results[0] = result(STATES[0].id, 'not-a-state');
    const r = measureStateCoverage({ lane: 'live', states: STATES, results });
    expect(r.unknownLabels).toEqual(['not-a-state']);
    expect(r.reachedCount).toBe(STATES.length - 1);
  });

  test('a result naming a target that is not a state is rejected loudly', () => {
    expect(() => measureStateCoverage({
      lane: 'live', states: STATES, results: [result('ghost-state', 'deep-rest')],
    })).toThrow(/ghost-state/);
  });

  test('missing axes, null masses and NaN masses all read as ABSTAINED, never as evidence', () => {
    const target = STATES.find((s) => s.requiredSignals.length >= 2);
    const [a1, a2] = target.requiredSignals;
    const broken = axesWith();
    delete broken[a1];
    broken[a2] = { value: 0.5, mass: NaN };
    const results = perfectRun().map((r) => (r.target === target.id
      ? { target: target.id, persona: 'athlete', label: 'neutral-baseline', axes: broken }
      : r));
    const r = measureStateCoverage({ lane: 'live', states: STATES, results });
    const miss = r.missed.find((m) => m.id === target.id);
    expect(miss.abstainedRequired).toEqual([a1, a2].sort());
    expect(miss.reason).toBe(MISS_REASONS.SIGNAL_ABSENT);
  });

  test('a run with no axes bag at all does not throw — it reports every required axis absent', () => {
    const target = STATES[3];
    const results = [{ target: target.id, persona: 'athlete', label: null }];
    const r = measureStateCoverage({ lane: 'live', states: STATES, results });
    expect(r.missed[0].abstainedRequired).toEqual([...target.requiredSignals].sort());
  });

  test('the report carries a single-line house telemetry record (S15)', () => {
    const r = measureStateCoverage({ lane: 'serving', states: STATES, results: perfectRun() });
    expect(r.line).toMatch(/^\[sim\.coverage\] lane=serving /);
    expect(r.line).toContain(`reached=${STATES.length}`);
    expect(r.line.split('\n')).toHaveLength(1);
    // §0.2.2: a coverage report is state vocabulary and counts — never a vital.
    expect(r.line).not.toMatch(/\bhr=|heartRate|bpm=/);
  });

  test('it is pure: the same input twice gives a deep-equal report (S9 — no clock, no rng)', () => {
    const input = { lane: 'serving', states: STATES, results: perfectRun() };
    expect(measureStateCoverage(input)).toEqual(measureStateCoverage(input));
  });
});

describe('coverageScope — what the default budget runs (the W4-D60 rule, applied to the corpus)', () => {
  test('the full scope is every script, in corpus order', () => {
    expect(coverageScope(SCRIPTS, { full: true })).toEqual(SCRIPTS);
  });

  test('the default scope is a small STRIDED sample, so it spans domains rather than one block', () => {
    // The corpus is grouped by domain (rest, stress, focus, exertion, circadian, mood). Taking
    // the first N would run six rest scripts and prove nothing about the rest of the taxonomy,
    // which is the failure mode a cheap default is most likely to hide.
    const scope = coverageScope(SCRIPTS, { full: false, sample: 6 });
    expect(scope).toHaveLength(6);
    expect(new Set(scope.map((s) => s.target)).size).toBe(6);
    for (const s of scope) expect(SCRIPTS).toContain(s);
    const domainsSpanned = new Set(scope.map((s) => SCRIPTS.indexOf(s) > 23 ? 'late' : 'early'));
    expect(domainsSpanned.size).toBe(2);
  });

  test('a sample larger than the corpus is the corpus, never a padded or truncated list', () => {
    expect(coverageScope(SCRIPTS, { full: false, sample: 999 })).toEqual(SCRIPTS);
  });

  test('it never returns the caller array, so a mutating caller cannot shrink the next sweep', () => {
    const full = coverageScope(SCRIPTS, { full: true });
    full.pop();
    expect(coverageScope(SCRIPTS, { full: true })).toHaveLength(SCRIPTS.length);
  });
});
