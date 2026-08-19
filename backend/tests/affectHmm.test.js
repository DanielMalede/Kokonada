'use strict';

// A3 — the affect engine's TEMPORAL layer (W4-005, second half): §M.5's HMM forward update,
// hysteresis label projection, and the `AffectState` DTO.
//
// The one architectural decision this suite exists to protect: **the taxonomy state set is an
// injected PORT, not a table inside this engine.** W4-006 owns `stateTaxonomy.js` and its ~32
// states; W4-005 owns the machinery that runs over any valid state set and degrades to
// axes-only when given none. Two tasks, one source of truth, no fight over it. Everything below
// therefore drives a deliberately small 6-state / 3-domain FIXTURE — if a change to this engine
// only passes against the real taxonomy, it is a change in the wrong file.
//
// The failure mode being engineered out is flap. A raw argmax over a noisy posterior re-labels
// a person several times a minute, and every re-label is a music change they did not ask for.
// Stickiness (A(s,s) = exp(-dt/tau)), enter/exit thresholds and a minimum dwell are what make
// the label something a human would recognise as a state rather than a reading.

const fc = require('fast-check');
const { measure, expectWithinBudget } = require('../jest/perfBudget');

const {
  AFFECT_ENGINE_VERSION, AFFECT_STATE_VERSION,
  validateStateSet, stateSetSignature, createAffectState,
  forward, projectLabel, posteriorEntropy, updateAffect,
  SWITCH_MARGIN, STRONG_SWITCH_ALPHA, WITHIN_DOMAIN_SHARE, CROSS_DOMAIN_SHARE,
  DWELL_TAU_MIN_SEC, DWELL_TAU_MAX_SEC,
} = require('../app/agents/runtime/physiology/affectEngine');

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);

// A miniature stand-in for W4-006's taxonomy: 3 domains x 2 states, enough to exercise the
// within/cross transition split and every hysteresis branch, small enough to reason about.
function fixtureStates() {
  return [
    {
      id: 'deep-rest',
      domain: 'rest',
      band: 'resting',
      region: { arousal: { center: 0.2, width: 0.15 }, exertion: { center: 0.05, width: 0.1 }, stress: { center: 0.15, width: 0.15 } },
      enterThreshold: 0.35, exitThreshold: 0.15, minDwellSec: 300, dwellTauSec: 900,
    },
    {
      id: 'resting-content',
      domain: 'rest',
      band: 'resting',
      region: { arousal: { center: 0.42, width: 0.15 }, exertion: { center: 0.1, width: 0.12 }, stress: { center: 0.2, width: 0.15 } },
      enterThreshold: 0.35, exitThreshold: 0.15, minDwellSec: 300, dwellTauSec: 900,
    },
    {
      id: 'acute-stress',
      domain: 'stress',
      band: 'resting',
      region: { stress: { center: 0.85, width: 0.15 }, arousal: { center: 0.7, width: 0.2 }, exertion: { center: 0.15, width: 0.15 } },
      enterThreshold: 0.35, exitThreshold: 0.15, minDwellSec: 180, dwellTauSec: 600,
    },
    {
      id: 'simmering-tension',
      domain: 'stress',
      band: 'resting',
      region: { stress: { center: 0.55, width: 0.18 }, arousal: { center: 0.5, width: 0.2 } },
      enterThreshold: 0.35, exitThreshold: 0.15, minDwellSec: 300, dwellTauSec: 1200,
    },
    {
      id: 'steady-cardio',
      domain: 'exertion',
      band: 'active',
      region: { exertion: { center: 0.6, width: 0.15 }, arousal: { center: 0.75, width: 0.2 } },
      enterThreshold: 0.35, exitThreshold: 0.15, minDwellSec: 180, dwellTauSec: 600,
      requiredSignals: ['exertion'],
    },
    {
      id: 'peak-effort',
      domain: 'exertion',
      band: 'peak',
      region: { exertion: { center: 0.9, width: 0.12 }, arousal: { center: 0.9, width: 0.15 } },
      enterThreshold: 0.35, exitThreshold: 0.15, minDwellSec: 120, dwellTauSec: 300,
      requiredSignals: ['exertion'],
    },
  ];
}

// axes shaped the way `computeAxes` emits them.
function axesOf(over = {}, mass = 1) {
  const base = {
    arousal: 0.5, stress: 0.2, recovery: 0.6, exertion: 0.15,
    fatigue: 0.2, circadianAlertness: 0.5, valence: 0.5,
  };
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    const o = over[k];
    if (o && typeof o === 'object') out[k] = { value: o.value ?? v, mass: o.mass ?? mass, evidence: 1, parts: [] };
    else out[k] = { value: o ?? v, mass, evidence: 1, parts: [] };
  }
  return out;
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
const idx = (states, id) => states.findIndex((s) => s.id === id);

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — the state-set PORT', () => {
  test('the fixture (and therefore the contract W4-006 must satisfy) validates', () => {
    const v = validateStateSet(fixtureStates());
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  test.each([
    ['not an array', 'x'],
    ['empty', []],
    ['duplicate ids', [{ id: 'a', domain: 'd', region: { stress: { center: 0.5, width: 0.2 } } }, { id: 'a', domain: 'd', region: { stress: { center: 0.5, width: 0.2 } } }]],
    ['missing domain', [{ id: 'a', region: { stress: { center: 0.5, width: 0.2 } } }]],
    ['empty region — constrains nothing, so it would win every tie', [{ id: 'a', domain: 'd', region: {} }]],
    ['unknown axis name', [{ id: 'a', domain: 'd', region: { vibes: { center: 0.5, width: 0.2 } } }]],
    ['zero width — an infinite-precision claim', [{ id: 'a', domain: 'd', region: { stress: { center: 0.5, width: 0 } } }]],
    ['centre outside the unit interval', [{ id: 'a', domain: 'd', region: { stress: { center: 1.7, width: 0.2 } } }]],
    ['exit above enter — hysteresis inverted', [{ id: 'a', domain: 'd', region: { stress: { center: 0.5, width: 0.2 } }, enterThreshold: 0.3, exitThreshold: 0.6 }]],
    ['negative dwell', [{ id: 'a', domain: 'd', region: { stress: { center: 0.5, width: 0.2 } }, minDwellSec: -1 }]],
    ['requiredSignals naming an axis the region does not constrain', [{ id: 'a', domain: 'd', region: { stress: { center: 0.5, width: 0.2 } }, requiredSignals: ['nope'] }]],
  ])('rejects: %s', (_label, bad) => {
    const v = validateStateSet(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  test('the signature is stable across calls and changes when the state set does', () => {
    const a = stateSetSignature(fixtureStates());
    expect(stateSetSignature(fixtureStates())).toBe(a);
    const renamed = fixtureStates();
    renamed[0] = { ...renamed[0], id: 'deep-rest-2' };
    expect(stateSetSignature(renamed)).not.toBe(a);
    // ...and it is a short token, not the table — this blob goes into Redis (W4-009).
    expect(a.length).toBeLessThan(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — createAffectState', () => {
  test('starts genuinely uninformed: uniform posterior, no label, no time', () => {
    const states = fixtureStates();
    const s = createAffectState({ states });
    expect(s.alpha).toHaveLength(states.length);
    for (const a of s.alpha) expect(a).toBeCloseTo(1 / states.length, 9);
    expect(s.label).toBeNull();
    expect(s.labelSinceMs).toBeNull();
    expect(s.lastAtMs).toBeNull();
    expect(s.sig).toBe(stateSetSignature(states));
    expect(s.v).toBe(AFFECT_STATE_VERSION);
  });

  test('with no state set it is still a valid, tiny blob (W4-006 has not landed yet)', () => {
    const s = createAffectState();
    expect(s.alpha).toEqual([]);
    expect(s.sig).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — forward (M.5)', () => {
  const states = fixtureStates();

  test('the posterior is a probability distribution: non-negative, finite, sums to 1', () => {
    const { alpha } = forward({ states, alpha: createAffectState({ states }).alpha, axes: axesOf(), dtSec: 60 });
    expect(sum(alpha)).toBeCloseTo(1, 9);
    for (const a of alpha) expect(a).toBeGreaterThanOrEqual(0);
  });

  test('evidence at a state\'s centre concentrates the posterior there', () => {
    const uniform = createAffectState({ states }).alpha;
    const { alpha } = forward({
      states, alpha: uniform, dtSec: 60,
      axes: axesOf({ exertion: 0.9, arousal: 0.9, stress: 0.2 }),
    });
    const best = alpha.indexOf(Math.max(...alpha));
    expect(states[best].id).toBe('peak-effort');
    expect(alpha[best]).toBeGreaterThan(0.5);
  });

  test('M.5 "missing axis -> factor 1": a mass-0 axis cannot influence the posterior AT ALL', () => {
    const uniform = createAffectState({ states }).alpha;
    const quiet = forward({ states, alpha: uniform, dtSec: 60, axes: axesOf({ stress: { value: 0.01, mass: 0 } }) }).alpha;
    const loud = forward({ states, alpha: uniform, dtSec: 60, axes: axesOf({ stress: { value: 0.99, mass: 0 } }) }).alpha;
    // Two wildly different claims about stress, both with zero evidence behind them. If the
    // posterior can tell them apart, the engine is inventing physiology.
    for (let i = 0; i < states.length; i++) expect(quiet[i]).toBeCloseTo(loud[i], 12);
  });

  test('a PARTIALLY-massed axis moves the posterior proportionally, not all-or-nothing', () => {
    const uniform = createAffectState({ states }).alpha;
    const s = idx(states, 'acute-stress');
    const weak = forward({ states, alpha: uniform, dtSec: 60, axes: axesOf({ stress: { value: 0.85, mass: 0.2 }, arousal: { value: 0.7, mass: 0.2 }, exertion: { value: 0.15, mass: 0.2 } }) }).alpha;
    const strong = forward({ states, alpha: uniform, dtSec: 60, axes: axesOf({ stress: { value: 0.85, mass: 1 }, arousal: { value: 0.7, mass: 1 }, exertion: { value: 0.15, mass: 1 } }) }).alpha;
    expect(strong[s]).toBeGreaterThan(weak[s]);
    expect(weak[s]).toBeGreaterThan(1 / states.length);
  });

  test('stickiness is exactly A(s,s) = exp(-dt/tau), with the off-diagonal split 70/30', () => {
    // Isolating the transition matrix means removing EVERY other mechanism, `requiredSignals`
    // included: with zero-mass evidence the two states that require an exertion signal are
    // excluded, which renormalises the row and hides the constants behind a second effect.
    // (Found by this assertion failing at 0.7484 against an expected 0.7165 — the difference
    // was exactly the excluded states' share.)
    const plain = fixtureStates().map(({ requiredSignals: _drop, ...rest }) => rest);
    const noEvidence = axesOf({}, 0);
    const from = idx(plain, 'deep-rest');
    const delta = plain.map((_, i) => (i === from ? 1 : 0));
    const dtSec = 300;
    const { alpha } = forward({ states: plain, alpha: delta, axes: noEvidence, dtSec });

    const selfP = Math.exp(-dtSec / plain[from].dwellTauSec);
    expect(alpha[from]).toBeCloseTo(selfP, 9);

    const within = plain.reduce((a, s, i) => (i !== from && s.domain === plain[from].domain ? a + alpha[i] : a), 0);
    const cross = plain.reduce((a, s, i) => (s.domain !== plain[from].domain ? a + alpha[i] : a), 0);
    expect(within).toBeCloseTo(WITHIN_DOMAIN_SHARE * (1 - selfP), 9);
    expect(cross).toBeCloseTo(CROSS_DOMAIN_SHARE * (1 - selfP), 9);
    expect(WITHIN_DOMAIN_SHARE + CROSS_DOMAIN_SHARE).toBeCloseTo(1, 9);
  });

  test('a longer gap mixes more — an hour of silence should not preserve a stale belief', () => {
    const noEvidence = axesOf({}, 0);
    const from = idx(states, 'deep-rest');
    const delta = states.map((_, i) => (i === from ? 1 : 0));
    const short = forward({ states, alpha: delta, axes: noEvidence, dtSec: 30 }).alpha[from];
    const long = forward({ states, alpha: delta, axes: noEvidence, dtSec: 3600 }).alpha[from];
    expect(long).toBeLessThan(short);
    expect(posteriorEntropy(forward({ states, alpha: delta, axes: noEvidence, dtSec: 3600 }).alpha))
      .toBeGreaterThan(posteriorEntropy(forward({ states, alpha: delta, axes: noEvidence, dtSec: 30 }).alpha));
  });

  test('dt = 0 (the first reading, or two in the same millisecond) is pure emission, no mixing', () => {
    const from = idx(states, 'deep-rest');
    const delta = states.map((_, i) => (i === from ? 1 : 0));
    const { alpha } = forward({ states, alpha: delta, axes: axesOf({}, 0), dtSec: 0 });
    expect(alpha[from]).toBeCloseTo(1, 9);
  });

  test('a domain of one state sends its whole off-diagonal mass across, not into itself', () => {
    const solo = [
      { id: 'only', domain: 'lonely', region: { stress: { center: 0.5, width: 0.2 } }, dwellTauSec: 600 },
      { id: 'other', domain: 'elsewhere', region: { stress: { center: 0.5, width: 0.2 } }, dwellTauSec: 600 },
    ];
    const { alpha } = forward({ states: solo, alpha: [1, 0], axes: axesOf({}, 0), dtSec: 600 });
    expect(sum(alpha)).toBeCloseTo(1, 9);
    expect(alpha[0]).toBeCloseTo(Math.exp(-1), 9);
    expect(alpha[1]).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  test('requiredSignals: a state whose signal is absent is EXCLUDED, not merely disfavoured', () => {
    const uniform = createAffectState({ states }).alpha;
    const { alpha, excluded } = forward({
      states, alpha: uniform, dtSec: 60,
      axes: axesOf({ exertion: { value: 0.9, mass: 0 }, arousal: 0.9 }),
    });
    expect(excluded).toEqual(expect.arrayContaining(['steady-cardio', 'peak-effort']));
    expect(alpha[idx(states, 'peak-effort')]).toBe(0);
    expect(sum(alpha)).toBeCloseTo(1, 9);
  });

  test('...but if EVERY state would be excluded, exclusion is lifted rather than returning NaN', () => {
    const allRequire = fixtureStates().map((s) => ({ ...s, requiredSignals: ['exertion'] }));
    const { alpha, excluded, exclusionLifted } = forward({
      states: allRequire, alpha: createAffectState({ states: allRequire }).alpha, dtSec: 60,
      axes: axesOf({ exertion: { value: 0.5, mass: 0 } }),
    });
    expect(exclusionLifted).toBe(true);
    expect(excluded).toEqual([]);
    expect(sum(alpha)).toBeCloseTo(1, 9);
  });

  test('SHARP regions far from the evidence still rank correctly (log-space underflow)', () => {
    // The real taxonomy is ~32 states, several of them tight. With widths this narrow the raw
    // likelihoods are around exp(-1200), which is zero in float64 — so an implementation that
    // exponentiates before shifting by the maximum gets an all-zero posterior, silently falls
    // back to the transition prior, and loses every distinction the emissions carried. Shifting
    // first keeps the RATIOS, which is all a normalised posterior needs.
    const sharp = [
      { id: 'near', domain: 'a', band: 'resting', region: { stress: { center: 0.5, width: 0.01 } }, dwellTauSec: 600 },
      { id: 'far', domain: 'b', band: 'resting', region: { stress: { center: 0.1, width: 0.01 } }, dwellTauSec: 600 },
    ];
    const { alpha } = forward({
      states: sharp, alpha: [0.5, 0.5], dtSec: 60,
      axes: axesOf({ stress: 0.9 }),
    });
    expect(alpha.every(Number.isFinite)).toBe(true);
    expect(sum(alpha)).toBeCloseTo(1, 9);
    expect(alpha[0]).toBeGreaterThan(0.99); // 'near' is 40 sigma away; 'far' is 80. Still ordered.
  });

  test('S8: no combination of inputs produces NaN or a negative probability', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 7, maxLength: 7 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 7, maxLength: 7 }),
        fc.double({ min: 0, max: 100000, noNaN: true }),
        (values, masses, dtSec) => {
          const names = ['arousal', 'stress', 'recovery', 'exertion', 'fatigue', 'circadianAlertness', 'valence'];
          const axes = {};
          names.forEach((n, i) => { axes[n] = { value: values[i], mass: masses[i] }; });
          const { alpha } = forward({ states, alpha: createAffectState({ states }).alpha, axes, dtSec });
          return alpha.every((a) => Number.isFinite(a) && a >= 0) && Math.abs(sum(alpha) - 1) < 1e-9;
        },
      ),
      { numRuns: 300, seed: 20260819 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — posteriorEntropy', () => {
  test('normalised to [0,1]: uniform is 1, certain is 0', () => {
    expect(posteriorEntropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(1, 9);
    expect(posteriorEntropy([1, 0, 0, 0])).toBeCloseTo(0, 9);
    expect(posteriorEntropy([0.7, 0.1, 0.1, 0.1])).toBeGreaterThan(0);
    expect(posteriorEntropy([0.7, 0.1, 0.1, 0.1])).toBeLessThan(1);
  });

  test('a single-state or empty set is 0, not NaN (log |S| = 0 division)', () => {
    expect(posteriorEntropy([1])).toBe(0);
    expect(posteriorEntropy([])).toBe(0);
    expect(posteriorEntropy(null)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — projectLabel (hysteresis)', () => {
  const states = fixtureStates();
  const alphaWith = (id, p) => {
    const rest = (1 - p) / (states.length - 1);
    return states.map((s) => (s.id === id ? p : rest));
  };
  // Two named states at explicit probabilities, the remainder spread evenly. Needed because the
  // hysteresis branches are about the RELATIONSHIP between the incumbent and the winner, and
  // `alphaWith` can only pin one of them.
  const alphaPair = (curId, curP, bestId, bestP) => {
    const rest = (1 - curP - bestP) / (states.length - 2);
    return states.map((s) => {
      if (s.id === curId) return curP;
      if (s.id === bestId) return bestP;
      return rest;
    });
  };

  test('bootstrap: no label is adopted until the winner clears its OWN enterThreshold', () => {
    const weak = projectLabel({ states, alpha: alphaWith('deep-rest', 0.3), prior: createAffectState({ states }), now: T0 });
    expect(weak.label).toBeNull();
    const strong = projectLabel({ states, alpha: alphaWith('deep-rest', 0.4), prior: createAffectState({ states }), now: T0 });
    expect(strong.label).toBe('deep-rest');
    expect(strong.transitioned).toBe(true);
    expect(strong.from).toBeNull();
    expect(strong.labelSinceMs).toBe(T0);
  });

  // Deliberately below STRONG_SWITCH_ALPHA on both sides, so these cases exercise the DWELL and
  // MARGIN gates rather than being short-circuited by the strong clause.
  const contested = alphaPair('deep-rest', 0.28, 'resting-content', 0.28 + SWITCH_MARGIN + 0.04);

  test('a clear margin inside the dwell window does NOT switch — this is the anti-flap core', () => {
    const out = projectLabel({
      states, prior: { label: 'deep-rest', labelSinceMs: T0 }, now: T0 + 60_000, // 60 s of 300 s
      alpha: contested,
    });
    expect(contested[idx(states, 'resting-content')]).toBeLessThan(STRONG_SWITCH_ALPHA);
    expect(out.label).toBe('deep-rest');
    expect(out.transitioned).toBe(false);
  });

  test('...and the SAME evidence switches once the minimum dwell has elapsed', () => {
    const out = projectLabel({
      states, prior: { label: 'deep-rest', labelSinceMs: T0 }, now: T0 + 301_000, alpha: contested,
    });
    expect(out.label).toBe('resting-content');
    expect(out.transitioned).toBe(true);
    expect(out.from).toBe('deep-rest');
    expect(out.labelSinceMs).toBe(T0 + 301_000);
  });

  test('a margin BELOW the threshold never switches, however long the dwell', () => {
    const photoFinish = alphaPair('deep-rest', 0.40, 'resting-content', 0.40 + SWITCH_MARGIN / 2);
    const out = projectLabel({
      states, prior: { label: 'deep-rest', labelSinceMs: T0 }, now: T0 + 86_400_000, alpha: photoFinish,
    });
    expect(out.label).toBe('deep-rest');
    expect(out.transitioned).toBe(false);
  });

  test('DEVIATION FROM M.5: alpha > 0.5 alone does NOT switch — it must also clear the margin', () => {
    // Two states straddling the strong bar is exactly the boundary-flap case the dwell exists
    // to prevent, and a bare absolute clause would re-admit it.
    const straddling = alphaPair('deep-rest', 0.47, 'resting-content', 0.51);
    const out = projectLabel({
      states, prior: { label: 'deep-rest', labelSinceMs: T0 }, now: T0 + 1000, alpha: straddling,
    });
    expect(straddling[idx(states, 'resting-content')]).toBeGreaterThan(STRONG_SWITCH_ALPHA);
    expect(out.label).toBe('deep-rest');
  });

  test('M.5 clause 2: an overwhelming winner switches immediately, dwell or not', () => {
    const out = projectLabel({
      states, prior: { label: 'deep-rest', labelSinceMs: T0 }, now: T0 + 1000,
      alpha: alphaWith('peak-effort', 0.9),
    });
    expect(STRONG_SWITCH_ALPHA).toBeLessThan(0.9);
    expect(out.label).toBe('peak-effort');
    expect(out.transitioned).toBe(true);
  });

  test('an exitThreshold breach releases the current label even without the switch margin', () => {
    // The current state has collapsed to 0.05, below its own exitThreshold — it is no longer
    // held. The winner is only marginally ahead, but holding a state nobody believes is worse.
    const collapsed = alphaPair('deep-rest', 0.05, 'simmering-tension', 0.42);
    expect(collapsed[idx(states, 'deep-rest')]).toBeLessThan(states[idx(states, 'deep-rest')].exitThreshold);
    expect(collapsed[idx(states, 'simmering-tension')]).toBeLessThan(STRONG_SWITCH_ALPHA);
    const out = projectLabel({
      states, prior: { label: 'deep-rest', labelSinceMs: T0 }, now: T0 + 1000, alpha: collapsed,
    });
    // Only the EXIT gate can explain this switch: the dwell is 1 s of 300 s, and the winner is
    // below the strong bar.
    expect(out.label).toBe('simmering-tension');
  });

  test('BOTH dwell bypasses are reserved for a REGIME change, not an adjacent one', () => {
    const prior = { label: 'deep-rest', labelSinceMs: T0 };
    const now = T0 + 1000; // 1 s of a 300 s dwell

    // Adjacent (same domain, same band): overwhelming evidence still waits out the dwell,
    // because a deep-rest -> resting-content relabel is the same music.
    const overwhelmingAdjacent = alphaPair('deep-rest', 0.05, 'resting-content', 0.9);
    expect(states[idx(states, 'resting-content')].band).toBe(states[idx(states, 'deep-rest')].band);
    expect(projectLabel({ states, prior, now, alpha: overwhelmingAdjacent }).label).toBe('deep-rest');

    // Cross-BAND: the person has started running. Making them wait five minutes for the music
    // to notice is exactly the failure M.5's strong clause exists to prevent.
    const overwhelmingRegime = alphaPair('deep-rest', 0.05, 'peak-effort', 0.9);
    expect(states[idx(states, 'peak-effort')].band).not.toBe(states[idx(states, 'deep-rest')].band);
    expect(projectLabel({ states, prior, now, alpha: overwhelmingRegime }).label).toBe('peak-effort');

    // Cross-DOMAIN inside one band counts too: the regulator's answer to stress is nothing like
    // its answer to rest, even though both are 'resting' tempo.
    const crossDomain = alphaPair('deep-rest', 0.05, 'acute-stress', 0.9);
    expect(states[idx(states, 'acute-stress')].band).toBe(states[idx(states, 'deep-rest')].band);
    expect(projectLabel({ states, prior, now, alpha: crossDomain }).label).toBe('acute-stress');
  });

  test('the winner still has to clear its own enterThreshold to be adopted', () => {
    const picky = fixtureStates().map((s) => (s.id === 'resting-content' ? { ...s, enterThreshold: 0.9 } : s));
    const out = projectLabel({
      states: picky, prior: { label: 'deep-rest', labelSinceMs: T0 }, now: T0 + 86_400_000,
      alpha: alphaWith('resting-content', 0.6),
    });
    expect(out.label).toBe('deep-rest');
  });

  test('a label that vanished from the state set is dropped rather than carried as a ghost', () => {
    const out = projectLabel({
      states, prior: { label: 'a-state-from-a-previous-taxonomy', labelSinceMs: T0 }, now: T0 + 1000,
      alpha: alphaWith('deep-rest', 0.5),
    });
    expect(out.label).toBe('deep-rest');
    expect(out.from).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — anti-flap (the property that makes the label usable)', () => {
  const states = fixtureStates();

  // A body sitting exactly on the deep-rest / resting-content boundary with sensor noise: the
  // single hardest case for a labeller, and the one a raw argmax handles worst.
  function boundaryStream(n, seedRng) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const jitter = () => (seedRng() - 0.5) * 0.12;
      out.push(axesOf({
        arousal: 0.31 + jitter(),
        exertion: 0.075 + jitter() * 0.3,
        stress: 0.175 + jitter() * 0.5,
      }));
    }
    return out;
  }

  // A deterministic LCG — no Math.random anywhere in a test that has to be reproducible.
  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // THE CONTROL, and getting it right took a correction worth recording. The first version
  // compared reported transitions against the argmax of the FORWARD posterior — which is not a
  // control at all, because the forward recursion has already done the smoothing (it measured
  // 0 flips, i.e. it was silently testing nothing). The honest baseline is a MEMORYLESS
  // labeller: match the current evidence to the nearest region and report it. That is what an
  // implementation without a temporal layer does, and it is what the layer has to beat.
  function memorylessLabel(axes) {
    const { alpha } = forward({ states, alpha: createAffectState({ states }).alpha, axes, dtSec: 0 });
    return states[alpha.indexOf(Math.max(...alpha))].id;
  }

  function run(stream, stepMs = 60_000) {
    let st = createAffectState({ states });
    let transitions = 0;
    let memFlips = 0;
    let lastMem = null;
    stream.forEach((axes, i) => {
      const now = T0 + i * stepMs;
      const mem = memorylessLabel(axes);
      if (lastMem !== null && mem !== lastMem) memFlips++;
      lastMem = mem;
      const { alpha } = forward({ states, alpha: st.alpha, axes, dtSec: st.lastAtMs == null ? 0 : (now - st.lastAtMs) / 1000 });
      const p = projectLabel({ states, alpha, prior: st, now });
      if (p.transitioned && p.from) transitions++;
      st = { ...st, alpha, label: p.label, labelSinceMs: p.labelSinceMs, lastAtMs: now };
    });
    return { transitions, memFlips, label: st.label };
  }

  test('an hour of boundary-hugging noise: a memoryless labeller churns, this one does not', () => {
    const { transitions, memFlips, label } = run(boundaryStream(60, lcg(20260819)));
    expect(memFlips).toBeGreaterThan(10);  // measured 24 — one relabel every 2.5 minutes
    expect(transitions).toBe(0);           // ...and the filtered engine holds one label all hour
    expect(label).not.toBeNull();          // while still committing to one, rather than abstaining
  });

  test('a genuinely oscillating signal is rate-limited to the dwell, not tracked', () => {
    // A person drifting back and forth between deep-rest and resting-content every 3 minutes.
    // The evidence really does alternate, so a memoryless labeller is not even wrong — it is
    // just useless, because each relabel is a music change. The dwell is the product guarantee.
    const rng = lcg(4242);
    const stream = Array.from({ length: 60 }, (_, i) => {
      const j = () => (rng() - 0.5) * 0.10;
      const phase = Math.sin((2 * Math.PI * i) / 6);
      return axesOf({
        arousal: 0.31 + 0.13 * phase + j(),
        exertion: 0.075 + 0.025 * phase + j() * 0.2,
        stress: 0.175 + j() * 0.4,
      });
    });
    const { transitions, memFlips } = run(stream);
    expect(memFlips).toBeGreaterThan(15);
    expect(transitions).toBeLessThan(memFlips);
    // The guarantee: adjacent relabels never run faster than the incumbent's minDwellSec.
    expect(transitions).toBeLessThanOrEqual((60 * 60) / 300);
  });

  test('a real state change is still detected promptly — stability is not deafness', () => {
    let st = createAffectState({ states });
    let now = T0;
    // 20 minutes of rest...
    for (let i = 0; i < 20; i++) {
      const axes = axesOf({ arousal: 0.2, exertion: 0.05, stress: 0.15 });
      const { alpha } = forward({ states, alpha: st.alpha, axes, dtSec: st.lastAtMs == null ? 0 : 60 });
      const p = projectLabel({ states, alpha, prior: st, now });
      st = { ...st, alpha, label: p.label, labelSinceMs: p.labelSinceMs, lastAtMs: now };
      now += 60_000;
    }
    expect(st.label).toBe('deep-rest');

    // ...then the person starts running.
    let detectedAfterMin = null;
    for (let i = 0; i < 15; i++) {
      const axes = axesOf({ arousal: 0.9, exertion: 0.9, stress: 0.2 });
      const { alpha } = forward({ states, alpha: st.alpha, axes, dtSec: 60 });
      const p = projectLabel({ states, alpha, prior: st, now });
      st = { ...st, alpha, label: p.label, labelSinceMs: p.labelSinceMs, lastAtMs: now };
      if (st.label === 'peak-effort' && detectedAfterMin === null) detectedAfterMin = i + 1;
      now += 60_000;
    }
    expect(detectedAfterMin).not.toBeNull();
    expect(detectedAfterMin).toBeLessThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — updateAffect and the AffectState DTO', () => {
  const states = fixtureStates();
  const baselines = {
    rhrMedian: 60, rhrMAD: 3, hrvMedian: 45, hrvMAD: 8,
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, value: 70, raw: 70, mad: 5, n: 600, nEff: 10, confidence: 0.5, overall: 70 })),
    cosinor: { M: 65, A: 5, phi: 15, confidence: 0.6 },
    zones: { restingHeartRate: 60, maxHeartRate: 190, hrr: 130, zones: [] },
    maxHeartRate: 190, maxHeartRateSource: 'provided',
    trend: { rhr: 0, hrv: 0 }, confidence: 0.8,
    coverage: { hrvConfidence: 0.9 },
  };
  const input = {
    baselines,
    live: { heartRate: 163, confidence: 0.94, activity: 'running' },
    state: { hrv: 27, bodyBattery: 41, dailyReadiness: 38 },
    tzOffsetMinutes: 0,
  };

  test('returns {state, affect}, mirroring the anomalyFilter convention', () => {
    const out = updateAffect(createAffectState({ states }), input, { now: T0, states });
    expect(Object.keys(out).sort()).toEqual(['affect', 'state']);
  });

  test('the DTO carries exactly the documented shape', () => {
    const { affect } = updateAffect(createAffectState({ states }), input, { now: T0, states });
    expect(affect.v).toBe(AFFECT_ENGINE_VERSION);
    expect(affect.computedAt).toBe(new Date(T0).toISOString());
    expect(typeof affect.posteriorEntropy).toBe('number');
    expect(typeof affect.confidence).toBe('number');
    expect(affect.axes.exertion.value).toBeGreaterThan(0.5);
    expect(affect.topState).not.toBeNull();
    expect(affect.topState.domain).toBe('exertion');
    expect(['resting', 'active', 'peak']).toContain(affect.topState.band);
  });

  test('S9: `now` is a required parameter, and computedAt comes from it, never from the clock', () => {
    expect(() => updateAffect(createAffectState({ states }), input, { states })).toThrow(/now/);
    const later = updateAffect(createAffectState({ states }), input, { now: T0 + 999_000, states });
    expect(later.affect.computedAt).toBe(new Date(T0 + 999_000).toISOString());
  });

  test('ZERO KNOWLEDGE: no raw vital appears anywhere in the DTO, at any depth', () => {
    const { affect } = updateAffect(createAffectState({ states }), input, { now: T0, states });
    const vitals = [163, 27, 41, 38, 60, 45, 190, 130, 70];
    const seenNumbers = [];
    const seenStrings = [];
    (function walk(v) {
      if (typeof v === 'number') seenNumbers.push(v);
      else if (typeof v === 'string') seenStrings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    }(affect));
    for (const n of seenNumbers) expect(vitals).not.toContain(n);
    for (const s of seenStrings) for (const n of vitals) expect(s).not.toContain(String(n));
  });

  test('WITHOUT a state set the engine still works: axes only, topState null, nothing thrown', () => {
    const { state, affect } = updateAffect(createAffectState(), input, { now: T0 });
    expect(affect.topState).toBeNull();
    expect(affect.posteriorEntropy).toBe(0);
    expect(affect.axes.exertion.value).toBeGreaterThan(0.5);
    expect(state.alpha).toEqual([]);
  });

  test('a CHANGED taxonomy resets the posterior instead of misaligning it against stale indices', () => {
    const first = updateAffect(createAffectState({ states }), input, { now: T0, states });
    const renamed = fixtureStates().map((s, i) => (i === 0 ? { ...s, id: 'renamed' } : s));
    const { state, affect } = updateAffect(first.state, input, { now: T0 + 60_000, states: renamed });
    expect(affect.stateSetChanged).toBe(true);
    expect(state.sig).toBe(stateSetSignature(renamed));
    expect(state.alpha).toHaveLength(renamed.length);
    expect(sum(state.alpha)).toBeCloseTo(1, 9);
  });

  test('an INVALID state set is refused loudly rather than silently producing a wrong label', () => {
    expect(() => updateAffect(createAffectState(), input, { now: T0, states: [{ id: 'x' }] }))
      .toThrow(/state set/i);
  });

  test('S15 telemetry: bands and counts, never a value that came off a sensor', () => {
    const { affect } = updateAffect(createAffectState({ states }), input, { now: T0, states });
    expect(affect.telemetry).toMatch(/^\[affect\]/);
    for (const n of ['163', '27', '41', '38']) expect(affect.telemetry).not.toContain(n);
    expect(affect.telemetry).toContain('state=');
  });

  test('the persisted state blob stays small and carries a version (S15 migrations)', () => {
    const { state } = updateAffect(createAffectState({ states }), input, { now: T0, states });
    expect(state.v).toBe(AFFECT_STATE_VERSION);
    expect(JSON.stringify(state).length).toBeLessThan(1024);
  });

  test('DETERMINISM: identical inputs give a byte-identical result (replay, S9)', () => {
    const a = updateAffect(createAffectState({ states }), input, { now: T0, states });
    const b = updateAffect(createAffectState({ states }), input, { now: T0, states });
    expect(JSON.stringify(a.affect)).toBe(JSON.stringify(b.affect));
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  test('the source file contains no direct clock or randomness call (S9, mechanically)', () => {
    const src = require('fs').readFileSync(
      require.resolve('../app/agents/runtime/physiology/affectEngine'), 'utf8',
    );
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/Math\.random\(\)/);
    expect(src).not.toMatch(/new Date\(\)/);
  });

  test('the dwell tau default is bounded by M.5\'s 3-30 minute prior', () => {
    const noTau = fixtureStates().map(({ dwellTauSec: _drop, ...rest }) => rest);
    const from = 0;
    for (const dtSec of [60, 600]) {
      const delta = noTau.map((_, i) => (i === from ? 1 : 0));
      const { alpha } = forward({ states: noTau, alpha: delta, axes: axesOf({}, 0), dtSec });
      const tau = -dtSec / Math.log(alpha[from]);
      expect(tau).toBeGreaterThanOrEqual(DWELL_TAU_MIN_SEC - 1e-6);
      expect(tau).toBeLessThanOrEqual(DWELL_TAU_MAX_SEC + 1e-6);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — S10 performance budget', () => {
  const states = fixtureStates();

  test('the forward update costs far less than its 5 ms budget', async () => {
    const axes = axesOf({ exertion: 0.6, arousal: 0.75 });
    const alpha = createAffectState({ states }).alpha;
    // 1000 updates against a 5 s budget: per-update that is the 5 ms S10 asks for, measured on
    // the MIN of several samples (W4-D09) so a loaded box cannot turn a correct build red.
    const m = await measure(() => {
      for (let i = 0; i < 1000; i++) forward({ states, alpha, axes, dtSec: 60 });
    }, { samples: 5, warmup: 2, label: 'affect-forward-1000' });
    expectWithinBudget(m, { budgetMs: 5000, strictMs: 500 });
  });
});
