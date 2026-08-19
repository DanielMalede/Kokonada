'use strict';

// A4 — the state taxonomy (W4-006, pure-core half). This suite is the CONTRACT the table has to
// satisfy; `stateTaxonomy.reachability.test.js` is the product DoD (every state reachable by a
// persona script). The two are deliberately separate: this one can be reasoned about by reading
// the table, that one can only be answered by running physiology through the engine.
//
// The load-bearing idea being protected here is EMISSION FAIRNESS. §M.5's emission carries a
// `−log σ` term, so a state authored with narrower widths is rewarded more whenever it fits —
// the affect engine's own header warns about exactly this ("a state authored with an implausibly
// tight width will dominate whenever it happens to fit"). A hand-tuned table drifts into that
// within a few edits. So widths here are NOT authored: the author declares a per-axis ROLE and
// the module solves for the widths that spend an identical precision budget. Every state then
// has, by construction, the same peak emission, and a state wins only by being CLOSER, never by
// claiming harder. This suite pins that property rather than trusting it.
//
// The second idea is NO FREE PASSES. A state that leaves an axis unconstrained pays nothing when
// that axis contradicts it, so it can beat a state that does constrain the axis and is right.
// Every state therefore constrains all seven axes; an axis a state has no opinion about is
// declared `agnostic`, which spends almost none of the budget and is nearly flat.

const {
  validateStateSet, forward, AXIS_NAMES, NEUTRAL,
  DWELL_TAU_MIN_SEC, DWELL_TAU_MAX_SEC,
} = require('../app/agents/runtime/physiology/affectEngine');

const {
  TAXONOMY_VERSION, STATES, DOMAINS, BANDS, AXIS_ROLES, ROLE_WEIGHTS,
  VALENCE_APPROACHES, TRAJECTORY_ARCHETYPES, ARCHETYPE_DIRECTION,
  LEGACY_STATE_MAP, HR_DEPENDENT_AXES, LOG_PRECISION_BUDGET,
  peakLogEmission, byId, bandOf, policyOf, explainOf, fromLegacyLabel, stateBandTable,
} = require('../app/agents/runtime/knowledge/stateTaxonomy');

const { _STATE_TO_BAND } = require('../app/services/moodDescriptors');

const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI);

// The states the mission names, verbatim from §3 W4-006. Kept as a literal list so a rename or a
// quiet drop shows up here rather than in a soak report four days later.
const MISSION_STATES = {
  rest: ['deep-rest', 'meditative', 'resting-content', 'drowsy-low-battery', 'post-exertion-recovery', 'sleep-onset-wind-down'],
  stress: ['acute-stress', 'simmering-tension', 'anxious-restless', 'overload-needs-downshift', 'recovering-from-stress'],
  focus: ['deep-focus', 'light-focus', 'creative-flow', 'mental-fatigue', 'restless-distracted'],
  movement: ['warmup', 'steady-cardio', 'peak-effort', 'intervals', 'cooldown', 'obligated-workout-low-recovery', 'casual-walk', 'commute-active'],
  rhythm: ['morning-activation', 'morning-sluggish', 'afternoon-dip', 'evening-unwind', 'night-owl-alert', 'pre-sleep'],
  emotional: ['energized-positive', 'low-mood-low-energy', 'tense-but-positive', 'neutral-baseline'],
};

// What state B pays, in nats, when the evidence sits exactly on state A's centre. This is the
// test's OWN metric, deliberately not imported from the module under test.
function separationNats(a, b) {
  let acc = 0;
  for (const axis of AXIS_NAMES) {
    const d = a.region[axis].center - b.region[axis].center;
    acc += (d * d) / (2 * b.region[axis].width * b.region[axis].width);
  }
  return acc;
}

// A full-mass evidence vector sitting on one state's centre.
function evidenceAtCentre(state) {
  const axes = {};
  for (const axis of AXIS_NAMES) axes[axis] = { value: state.region[axis].center, mass: 1 };
  return axes;
}

describe('stateTaxonomy — the port contract', () => {
  test('satisfies the affect engine validateStateSet contract it is injected through', () => {
    const v = validateStateSet(STATES);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  test('is frozen all the way down — a consumer cannot mutate shared truth', () => {
    expect(Object.isFrozen(STATES)).toBe(true);
    for (const s of STATES) {
      expect(Object.isFrozen(s)).toBe(true);
      expect(Object.isFrozen(s.region)).toBe(true);
      expect(Object.isFrozen(s.musicPolicy)).toBe(true);
      for (const axis of AXIS_NAMES) expect(Object.isFrozen(s.region[axis])).toBe(true);
    }
  });

  test('declares a version and six domains, each with at least three states', () => {
    expect(TAXONOMY_VERSION).toEqual(expect.any(Number));
    expect(DOMAINS).toHaveLength(6);
    for (const d of DOMAINS) {
      expect(STATES.filter((s) => s.domain === d).length).toBeGreaterThanOrEqual(3);
    }
  });

  test('contains exactly the states the mission names, in the domains it names', () => {
    const expected = Object.values(MISSION_STATES).flat();
    expect(STATES.map((s) => s.id).sort()).toEqual([...expected].sort());
    for (const [domain, ids] of Object.entries(MISSION_STATES)) {
      for (const id of ids) expect(byId(id).domain).toBe(domain);
    }
  });

  test('ids are kebab-case and unique; bands come from the closed vocabulary', () => {
    const seen = new Set();
    for (const s of STATES) {
      expect(s.id).toMatch(/^[a-z][a-z-]*[a-z]$/);
      expect(seen.has(s.id)).toBe(false);
      seen.add(s.id);
      expect(BANDS).toContain(s.band);
    }
  });
});

describe('stateTaxonomy — emission fairness (no state wins by claiming harder)', () => {
  test('every state constrains all seven axes — an unconstrained axis is a free pass', () => {
    for (const s of STATES) {
      expect(Object.keys(s.region).sort()).toEqual([...AXIS_NAMES].sort());
    }
  });

  test('every state spends an identical precision budget, so peak emissions are equal', () => {
    const peaks = STATES.map((s) => peakLogEmission(s));
    const spread = Math.max(...peaks) - Math.min(...peaks);
    expect(spread).toBeLessThan(1e-9);
    // and the peak is the budget the module says it is, not a number that drifted
    expect(peaks[0]).toBeCloseTo(LOG_PRECISION_BUDGET - AXIS_NAMES.length * HALF_LOG_2PI, 9);
  });

  test('peakLogEmission is the real emission at the centre, not a bookkeeping copy', () => {
    // Reconstruct it from the widths alone: Σ (−ln σ − ½ln2π).
    for (const s of STATES) {
      const fromWidths = AXIS_NAMES.reduce(
        (acc, a) => acc + (-Math.log(s.region[a].width) - HALF_LOG_2PI), 0,
      );
      expect(peakLogEmission(s)).toBeCloseTo(fromWidths, 9);
    }
  });

  test('role weights order the widths: defining is tightest, agnostic is nearly flat', () => {
    for (const s of STATES) {
      for (const a of AXIS_NAMES) {
        for (const b of AXIS_NAMES) {
          if (ROLE_WEIGHTS[s.region[a].role] > ROLE_WEIGHTS[s.region[b].role]) {
            expect(s.region[a].width).toBeLessThan(s.region[b].width);
          }
        }
      }
      // An agnostic axis has to be genuinely non-committal: wider than the flat-prior width
      // 1/sqrt(2*pi), the point where its peak contribution turns negative.
      for (const a of AXIS_NAMES) {
        if (s.region[a].role === 'agnostic') expect(s.region[a].width).toBeGreaterThan(0.398);
      }
    }
  });

  test('every axis role comes from the closed vocabulary and every state has a defining axis', () => {
    for (const s of STATES) {
      const roles = AXIS_NAMES.map((a) => s.region[a].role);
      for (const r of roles) expect(AXIS_ROLES).toContain(r);
      expect(roles.filter((r) => r === 'defining').length).toBeGreaterThanOrEqual(1);
      // At least four non-agnostic axes. Below that the budget solver concentrates so much
      // precision on the survivors that a `defining` width collapses past any plausible
      // measurement error — the state stops being a region and becomes a needle.
      expect(roles.filter((r) => r !== 'agnostic').length).toBeGreaterThanOrEqual(4);
    }
  });

  test('THE reachability precondition: every state is the emission argmax at its own centre', () => {
    // Run it through the REAL forward step with a uniform prior and dt = 0, so this pins the
    // engine's arithmetic rather than a restatement of it.
    const losers = [];
    for (const s of STATES) {
      const { alpha } = forward({ states: STATES, alpha: null, axes: evidenceAtCentre(s), dtSec: 0 });
      let best = 0;
      for (let i = 1; i < alpha.length; i++) if (alpha[i] > alpha[best]) best = i;
      if (STATES[best].id !== s.id) losers.push(`${s.id} loses to ${STATES[best].id}`);
    }
    expect(losers).toEqual([]);
  });
});

describe('stateTaxonomy — confusable states must be musically harmless', () => {
  // Thirty-four states over seven axes cannot all be far apart, and pretending otherwise is how a
  // taxonomy ships a confusion that a listener actually hears. So the rule is not "never
  // confusable" — it is "if two states are confusable, mistaking one for the other must not
  // change the music". That converts an unavoidable modelling limit into a bounded one.
  //
  // The direction check is deliberately about OPPOSING arcs, not merely different ones. Flat
  // instead of gently falling is a difference nobody can name; RISING instead of falling hands
  // the listener the opposite of what the state asked for, which is the mirror failure VISION §6
  // exists to prevent. `morning-sluggish` gave up its lift to satisfy exactly this.
  const CONFUSABLE_NATS = 1.0; // e^-1: the runner-up still holds ~37% of the winner's emission

  test('confusable pairs never disagree about band, arc direction or energy', () => {
    const offenders = [];
    for (let i = 0; i < STATES.length; i++) {
      for (let j = i + 1; j < STATES.length; j++) {
        const a = STATES[i];
        const b = STATES[j];
        // The fallback is a live alternative everywhere BY DESIGN — see its own pins below.
        if (a.id === 'neutral-baseline' || b.id === 'neutral-baseline') continue;
        const sep = Math.min(separationNats(a, b), separationNats(b, a));
        if (sep >= CONFUSABLE_NATS) continue;
        const why = `${a.id}~${b.id} (sep ${sep.toFixed(2)} nats)`;
        if (a.band !== b.band) offenders.push(`${why}: bands ${a.band}/${b.band}`);
        const dirA = ARCHETYPE_DIRECTION[a.musicPolicy.trajectoryArchetype];
        const dirB = ARCHETYPE_DIRECTION[b.musicPolicy.trajectoryArchetype];
        if (dirA * dirB === -1) offenders.push(`${why}: opposing arc directions`);
        if (Math.abs(a.musicPolicy.energyBias - b.musicPolicy.energyBias) > 0.25) {
          offenders.push(`${why}: energy bias gap`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the fallback earns its exemption: it applies no regulation and steers no band', () => {
    // `neutral-baseline` sits at the engine's neutral, so it is a near-neighbour of every
    // mid-range state and always a live hypothesis — which is the point of a fallback, not a
    // defect in it. What makes that safe is not distance but CONSEQUENCE: being mistaken for it
    // must cost the listener nothing at all. Both halves of that are pinned here.
    const fallback = byId('neutral-baseline');
    expect(fallback.musicPolicy).toEqual({
      energyBias: 0,
      valenceApproach: 'meet',
      textureBias: { acousticness: 0, instrumentalness: 0 },
      trajectoryArchetype: 'steady',
    });
    expect(ARCHETYPE_DIRECTION[fallback.musicPolicy.trajectoryArchetype]).toBe(0);
    // And it contributes no band, so `biometricBand` falls through to the heart rate — which is
    // exactly what "nothing in particular stands out" should mean.
    expect(stateBandTable()['neutral-baseline']).toBeUndefined();
  });

  test('no two states share an identical centre vector', () => {
    const seen = new Map();
    for (const s of STATES) {
      const key = AXIS_NAMES.map((a) => s.region[a].center.toFixed(4)).join('|');
      expect(seen.get(key)).toBeUndefined();
      seen.set(key, s.id);
    }
  });
});

describe('stateTaxonomy — hysteresis and dwell', () => {
  test('enter/exit thresholds scale with the size of the state set, not a hardcoded number', () => {
    const uniform = 1 / STATES.length;
    for (const s of STATES) {
      expect(s.enterThreshold).toBeGreaterThan(uniform * 3);
      expect(s.enterThreshold).toBeLessThan(0.35);
      expect(s.exitThreshold).toBeGreaterThan(0);
      expect(s.exitThreshold).toBeLessThan(s.enterThreshold);
    }
  });

  test('declared dwell taus survive the engine clamp — no silent re-interpretation', () => {
    for (const s of STATES) {
      expect(s.dwellTauSec).toBeGreaterThanOrEqual(DWELL_TAU_MIN_SEC);
      expect(s.dwellTauSec).toBeLessThanOrEqual(DWELL_TAU_MAX_SEC);
      expect(s.minDwellSec).toBeGreaterThanOrEqual(60);
      expect(s.minDwellSec).toBeLessThanOrEqual(1800);
    }
  });

  test('the states that change the music most are the hardest to enter', () => {
    const loud = ['peak-effort', 'intervals', 'acute-stress', 'overload-needs-downshift'];
    const quiet = byId('neutral-baseline').enterThreshold;
    for (const id of loud) expect(byId(id).enterThreshold).toBeGreaterThan(quiet);
  });
});

describe('stateTaxonomy — requiredSignals and degraded mode', () => {
  test('every required signal is a defining axis of that state', () => {
    for (const s of STATES) {
      for (const r of s.requiredSignals) expect(s.region[r].role).toBe('defining');
    }
  });

  test('exactly one state — the fallback — requires nothing, so a candidate always exists', () => {
    const open = STATES.filter((s) => s.requiredSignals.length === 0);
    expect(open.map((s) => s.id)).toEqual(['neutral-baseline']);
  });

  test('`degraded` is not an opinion: it is true exactly when no required signal needs live HR', () => {
    for (const s of STATES) {
      const needsHr = s.requiredSignals.some((r) => HR_DEPENDENT_AXES.includes(r));
      expect(s.degraded).toBe(!needsHr);
    }
  });

  test('a peak-band state can never be claimed without exertion evidence', () => {
    for (const s of STATES.filter((x) => x.band === 'peak')) {
      expect(s.requiredSignals).toContain('exertion');
    }
  });
});

describe('stateTaxonomy — music policy is a regulator, never a mirror', () => {
  test('policy vocabularies are closed', () => {
    for (const s of STATES) {
      const p = s.musicPolicy;
      expect(VALENCE_APPROACHES).toContain(p.valenceApproach);
      expect(TRAJECTORY_ARCHETYPES).toContain(p.trajectoryArchetype);
      expect(ARCHETYPE_DIRECTION[p.trajectoryArchetype]).toEqual(expect.any(Number));
      expect(p.energyBias).toBeGreaterThanOrEqual(-1);
      expect(p.energyBias).toBeLessThanOrEqual(1);
      for (const k of ['acousticness', 'instrumentalness']) {
        expect(p.textureBias[k]).toBeGreaterThanOrEqual(0);
        expect(p.textureBias[k]).toBeLessThanOrEqual(0.4);
      }
    }
  });

  test('VISION §6: an agitated state is never pushed harder', () => {
    for (const s of STATES) {
      if (s.region.stress.center >= 0.55) {
        expect(s.musicPolicy.energyBias).toBeLessThanOrEqual(0);
        expect(ARCHETYPE_DIRECTION[s.musicPolicy.trajectoryArchetype]).toBeLessThanOrEqual(0);
      }
    }
  });

  test('a depleted body is never handed a strong push', () => {
    for (const s of STATES) {
      if (s.region.recovery.center <= 0.3) expect(s.musicPolicy.energyBias).toBeLessThanOrEqual(0.1);
    }
  });

  test('there is no vocabulary for forcing valence — only meeting, sustaining or a gentle lift', () => {
    expect([...VALENCE_APPROACHES].sort()).toEqual(['lift-gently', 'meet', 'sustain']);
  });
});

describe('stateTaxonomy — explain templates claim only what the state measures', () => {
  const BANNED = /\b(heart|bpm|hrv|pulse|oxygen|blood|patient|diagnos|disorder|symptom|panic|anxiety|depress|medical|clinical|cortisol|apnea|arrhythm)/i;

  test('every claim is a defining axis of the state that makes it', () => {
    for (const s of STATES) {
      expect(s.explainTemplate.claims.length).toBeGreaterThan(0);
      for (const c of s.explainTemplate.claims) {
        expect(AXIS_NAMES).toContain(c);
        expect(s.region[c].role).toBe('defining');
      }
    }
  });

  test('template text carries no number and no clinical vocabulary', () => {
    for (const s of STATES) {
      expect(s.explainTemplate.text).toEqual(expect.any(String));
      expect(s.explainTemplate.text).not.toMatch(/\d/);
      expect(s.explainTemplate.text).not.toMatch(BANNED);
      expect(s.explainTemplate.text.length).toBeLessThanOrEqual(90);
    }
  });

  test('explainOf/policyOf/bandOf resolve by id and abstain on an unknown one', () => {
    expect(explainOf('deep-rest')).toBe(byId('deep-rest').explainTemplate);
    expect(policyOf('deep-rest')).toBe(byId('deep-rest').musicPolicy);
    expect(bandOf('peak-effort')).toBe('peak');
    for (const fn of [byId, explainOf, policyOf, bandOf]) {
      expect(fn('nope')).toBeNull();
      expect(fn(null)).toBeNull();
      expect(fn(undefined)).toBeNull();
    }
  });
});

describe('stateTaxonomy — legacy compatibility (the seam W4-006 has to keep)', () => {
  test('all nine legacy labels map into the taxonomy, plus the Neutral fallback', () => {
    for (const label of Object.keys(_STATE_TO_BAND)) {
      expect(byId(fromLegacyLabel(label))).not.toBeNull();
    }
    expect(fromLegacyLabel('Neutral')).toBe('neutral-baseline');
    expect(fromLegacyLabel('not a label')).toBeNull();
    expect(Object.keys(LEGACY_STATE_MAP)).toHaveLength(Object.keys(_STATE_TO_BAND).length + 1);
  });

  test('the mapping preserves the band every legacy label already resolved to', () => {
    for (const [label, band] of Object.entries(_STATE_TO_BAND)) {
      expect(bandOf(fromLegacyLabel(label))).toBe(band);
    }
  });

  test('stateBandTable is a STRICT SUPERSET of _STATE_TO_BAND — no consumer loses a key', () => {
    const table = stateBandTable();
    for (const [label, band] of Object.entries(_STATE_TO_BAND)) expect(table[label]).toBe(band);
    for (const s of STATES) {
      if (s.id === 'neutral-baseline') continue;
      expect(table[s.id]).toBe(s.band);
    }
    expect(Object.keys(table).length).toBe(Object.keys(_STATE_TO_BAND).length + STATES.length - 1);
  });
});

describe('stateTaxonomy — zero knowledge and purity', () => {
  test('the module reads no clock, no randomness and no environment (S9/S11)', () => {
    const src = require('fs').readFileSync(
      require.resolve('../app/agents/runtime/knowledge/stateTaxonomy'), 'utf8',
    );
    expect(src).not.toMatch(/Date\.now|Math\.random|process\.env|require\(['"](mongoose|redis|ioredis)/);
  });

  test('no state id or template leaks a vital — the labels are internal vocabulary', () => {
    const blob = JSON.stringify(STATES);
    expect(blob).not.toMatch(/\bbpm\b|heartRate|rmssd|spO2/i);
  });

  test('NEUTRAL is where the agnostic axes sit, so an opinionless axis is genuinely opinionless', () => {
    for (const s of STATES) {
      for (const a of AXIS_NAMES) {
        if (s.region[a].role === 'agnostic') expect(s.region[a].center).toBe(NEUTRAL[a]);
      }
    }
  });
});
