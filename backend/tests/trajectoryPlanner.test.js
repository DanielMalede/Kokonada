'use strict';

// B4 — THE TRAJECTORY PLANNER (W4-008, pure-core half).
//
// MMR decides WHICH tracks a listener gets. This module decides in WHAT ORDER, and it is the
// second half of the iso-principle: `wellbeingRegulator` (W4-006) publishes an arc as data —
// meet the listener where they are, then guide them — and something has to actually lay the
// playlist along it. Before this, `selectPlaylist` returned MMR's greedy pick order, which is
// "best score first, then whatever survived the diversity penalty": a stress arc and a workout
// arc came out in the same shape.
//
// WHAT THIS SUITE IS FOR, IN ORDER OF LOAD-BEARING-NESS
//
//  1. THE ORDER-ONLY INVARIANT. A sequencer that can add, drop or duplicate a track is a
//     selection bug wearing an ordering hat — it would silently bypass the band, the serve
//     ledger and the relaxation ladder, all of which run upstream of here. Every property test
//     below re-asserts the output is a PERMUTATION of the input, and nothing else.
//  2. NO-OP ON NO INFORMATION. An unconstrained request (`manual`, every band null) has no arc,
//     so the planner must return the pick order untouched — reordering a playlist you know
//     nothing about is churn, not intelligence. This is also what keeps the W4-007 golden set's
//     control scenario byte-identical.
//  3. THE ARC IS REAL. Per archetype, the curve has the shape its name claims and the planned
//     order tracks it. A planner that is monotone in nothing is a cost function with no product.
//  4. OCTAVE-FOLDED CONTINUITY. Neighbour tempo distance is the folded metric from
//     `selection/tempo` (§M.10), so 87 next to 174 is a groove continuing, not a 87-bpm jump,
//     while a genuine 70→160 discontinuity is still charged.
//  5. NUMERICAL HYGIENE (§0.4 S8) and DETERMINISM (§0.4 S9). Junk features, degenerate bands and
//     empty windows produce a finite cost and a valid permutation, and the same input always
//     produces the same output — no clock, no randomness, no environment inside the engine.

const fc = require('fast-check');

const {
  planTrajectory, resolveArchetype, buildCurve,
  ARCHETYPES, PLANNER_VERSION, DISABLE_ENV_VAR, SMOOTHNESS,
} = require('../app/agents/runtime/delivery/trajectoryPlanner');
const { ARCHETYPE_DIRECTION } = require('../app/agents/runtime/knowledge/stateTaxonomy');
const { toLog2, foldedDistanceLog2 } = require('../app/services/selection/tempo');
const { createRng } = require('../sim/rng');

// ── fixtures ────────────────────────────────────────────────────────────────────────────────

/** A pick as `selection/pipeline` builds it: the scored wrapper around a track. */
const pick = (id, features) => ({ track: { id, features }, total: 0.5 });

const feat = (bpm, energy, valence) => ({
  bpm, energy, valence, acousticness: 0.3, danceability: 0.5, source: 'api', confidence: 1,
});

/** Full 13-key targets (§0.2.5) plus the additive keys, as `translate()` emits them. */
const TARGETS = (over = {}) => ({
  version: 'biosonic/v3',
  bpmCenter: 100, bpmWidth: 30, energyFloor: 0.1, energyCeiling: 0.9, valenceTarget: 0.5,
  acousticnessBias: 0.1, instrumentalBias: 0.1, tempoBand: 'active', confidence: 0.8,
  activityDriven: false, activityIntensity: null, cadenceLocked: false,
  state: { recovery: 0.5, stress: 0.3, exertion: 0.2 },
  ...over,
});

/** A deterministic corpus that spans the whole band on every axis (§0.4 S9 — seeded, never Math.random). */
function corpus(n, seed = 'w4-008') {
  const rng = createRng(seed);
  return Array.from({ length: n }, (_, i) => pick(
    `t${String(i).padStart(3, '0')}`,
    feat(
      Math.round(rng.range(70, 140)),
      Math.round(rng.range(0.05, 0.95) * 1000) / 1000,
      Math.round(rng.range(0.05, 0.95) * 1000) / 1000,
    ),
  ));
}

const ids = (list) => list.map(p => p.track.id);
const energies = (list) => list.map(p => p.track.features?.energy ?? null);

/** Spearman rank correlation between a series and 1..n — how monotone the realised arc is. */
function trendCorrelation(series) {
  const clean = series.filter(v => typeof v === 'number' && Number.isFinite(v));
  const n = clean.length;
  if (n < 3) return 0;
  const rank = [...clean].map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const pos = new Array(n);
  rank.forEach((originalIndex, r) => { pos[originalIndex] = r; });
  let num = 0;
  for (let i = 0; i < n; i++) num += (i - (n - 1) / 2) * (pos[i] - (n - 1) / 2);
  let dx = 0; let dy = 0;
  for (let i = 0; i < n; i++) { dx += (i - (n - 1) / 2) ** 2; dy += (pos[i] - (n - 1) / 2) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

const maxFoldedNeighbourJump = (list) => {
  let worst = 0;
  for (let i = 0; i + 1 < list.length; i++) {
    const d = foldedDistanceLog2(toLog2(list[i].track.features?.bpm), toLog2(list[i + 1].track.features?.bpm));
    if (d != null && d > worst) worst = d;
  }
  return worst;
};

// ── 1 · the contract ────────────────────────────────────────────────────────────────────────

describe('trajectoryPlanner — the contract', () => {
  test('the output is always a PERMUTATION of the input: same objects, same count, no dupes', () => {
    const picks = corpus(30);
    const { ordered } = planTrajectory(picks, { targets: TARGETS() });
    expect(ordered).toHaveLength(picks.length);
    expect(new Set(ordered).size).toBe(picks.length);
    for (const p of ordered) expect(picks).toContain(p); // identity, not equality
    expect(ids(ordered).sort()).toEqual(ids(picks).sort());
  });

  test('it never mutates the input array or the picks inside it', () => {
    const picks = corpus(20);
    const before = [...picks];
    const snapshot = JSON.stringify(picks);
    planTrajectory(picks, { targets: TARGETS() });
    expect(picks).toEqual(before);
    expect(JSON.stringify(picks)).toBe(snapshot);
  });

  test('fewer than two picks is returned as-is — there is nothing to sequence', () => {
    for (const picks of [[], corpus(1)]) {
      const out = planTrajectory(picks, { targets: TARGETS() });
      expect(ids(out.ordered)).toEqual(ids(picks));
      expect(out.stats.planned).toBe(false);
    }
  });

  test('NO INFORMATION, NO REORDER: an unconstrained target leaves the pick order alone', () => {
    // The W4-007 golden set's control scenario. Every band is null, so there is no curve in any
    // axis and therefore nothing to lay the playlist along. Reordering here would be churn.
    const picks = corpus(25);
    const blank = TARGETS({
      bpmCenter: null, bpmWidth: null, energyFloor: null, energyCeiling: null,
      valenceTarget: null, tempoBand: null,
    });
    const { ordered, stats } = planTrajectory(picks, { targets: blank });
    expect(ids(ordered)).toEqual(ids(picks));
    expect(stats.planned).toBe(false);
    expect(stats.axes).toEqual([]);
  });

  test('identity when disabled, so the kill switch is a real escape hatch (S11)', () => {
    const picks = corpus(25);
    const { ordered, stats } = planTrajectory(picks, { targets: TARGETS(), disabled: true });
    expect(ids(ordered)).toEqual(ids(picks));
    expect(stats.planned).toBe(false);
    // ONE flag for the whole trajectory feature: the regulator that publishes the arc and the
    // planner that walks it must switch off together, or the arc is computed and then ignored.
    expect(DISABLE_ENV_VAR).toBe('WAVE4_TRAJECTORY_DISABLED');
    expect(DISABLE_ENV_VAR)
      .toBe(require('../app/agents/runtime/translation/wellbeingRegulator').DISABLE_ENV_VAR);
  });

  test('PURE (S9): the engine reads no clock, no randomness and no environment', () => {
    const src = require('fs').readFileSync(
      require.resolve('../app/agents/runtime/delivery/trajectoryPlanner'), 'utf8',
    );
    expect(src).not.toMatch(/process\.env|Date\.now|Math\.random|new Date\(/);
  });

  test('a hostile input does not produce a hostile result', () => {
    for (const bad of [null, undefined, 42, 'picks', {}]) {
      expect(() => planTrajectory(bad, { targets: TARGETS() })).toThrow(TypeError);
    }
    // targets, on the other hand, are allowed to be absent — that is simply "no arc".
    const picks = corpus(5);
    for (const t of [undefined, null, {}]) {
      const out = planTrajectory(picks, { targets: t });
      expect(ids(out.ordered)).toEqual(ids(picks));
      expect(out.stats.planned).toBe(false);
    }
  });
});

// ── 2 · archetype resolution ────────────────────────────────────────────────────────────────

describe('trajectoryPlanner — choosing the arc', () => {
  test('every archetype the taxonomy can name has a curve spec here', () => {
    // The taxonomy assigns one of these to all ~32 states. A state whose archetype this module
    // does not implement would silently fall back and its musicPolicy would be a lie.
    for (const id of Object.keys(ARCHETYPE_DIRECTION)) {
      expect(ARCHETYPES[id]).toBeDefined();
    }
    expect(Object.keys(ARCHETYPES).sort()).toEqual(Object.keys(ARCHETYPE_DIRECTION).sort());
  });

  test("the regulator's published archetype wins over every default", () => {
    const t = TARGETS({ cadenceLocked: true, trajectory: { archetype: 'monotone-wind-down' } });
    expect(resolveArchetype(t)).toBe('monotone-wind-down');
  });

  test('an unrecognised archetype token falls through to the defaults instead of crashing', () => {
    expect(resolveArchetype(TARGETS({ trajectory: { archetype: 'disco-inferno' } }))).toBe('steady');
    expect(resolveArchetype(TARGETS({ trajectory: { archetype: 42 } }))).toBe('steady');
  });

  test('a cadence lock is the strongest instruction there is: footfall has no arc', () => {
    expect(resolveArchetype(TARGETS({ cadenceLocked: true, bpmCenter: 162, tempoBand: 'peak' })))
      .toBe('cadence-locked');
  });

  test('without an arc the band itself picks the default shape', () => {
    expect(resolveArchetype(TARGETS({ bpmCenter: 66, tempoBand: 'resting' }))).toBe('monotone-wind-down');
    expect(resolveArchetype(TARGETS({ bpmCenter: 110, tempoBand: 'active' }))).toBe('steady');
    expect(resolveArchetype(TARGETS({ bpmCenter: 150, tempoBand: 'peak' }))).toBe('warmup-peak-cooldown');
    // An explicit activity chip at a mid band still wants a workout SHAPE; a mid band with no
    // chip is just a mid-energy request.
    expect(resolveArchetype(TARGETS({ bpmCenter: 110, tempoBand: 'active', activityDriven: true })))
      .toBe('warmup-peak-cooldown');
  });

  test('a stale tempoBand token is corroborated against bpmCenter, not trusted blindly', () => {
    // `tempoBand` is effectively write-only today (logged, stored on ServeEvent from a DIFFERENT
    // source) and the W4-007 golden fixtures already carry an older 'slow'|'mid'|'fast' spelling.
    // The number is the fact; the token is the hint.
    expect(resolveArchetype(TARGETS({ bpmCenter: 66, tempoBand: 'slow' }))).toBe('monotone-wind-down');
    expect(resolveArchetype(TARGETS({ bpmCenter: 162, tempoBand: 'fast' }))).toBe('warmup-peak-cooldown');
    expect(resolveArchetype(TARGETS({ bpmCenter: null, tempoBand: 'resting' }))).toBe('monotone-wind-down');
  });
});

// ── 3 · the curves have the shape their names claim ─────────────────────────────────────────

describe('trajectoryPlanner — arc shapes', () => {
  const K = 24;
  const curveFor = (archetype, over = {}) =>
    buildCurve(archetype, TARGETS({ trajectory: { archetype }, ...over }), K);

  const nonIncreasing = (a) => a.every((v, i) => i === 0 || v <= a[i - 1] + 1e-9);
  const nonDecreasing = (a) => a.every((v, i) => i === 0 || v >= a[i - 1] - 1e-9);

  test('monotone-wind-down descends, monotonically, in energy AND tempo', () => {
    const c = curveFor('monotone-wind-down');
    expect(nonIncreasing(c.energy)).toBe(true);
    expect(nonIncreasing(c.l2)).toBe(true);
    expect(c.energy[K - 1]).toBeLessThan(c.energy[0]);
  });

  test('gentle-lift rises, monotonically', () => {
    const c = curveFor('gentle-lift');
    expect(nonDecreasing(c.energy)).toBe(true);
    expect(c.energy[K - 1]).toBeGreaterThan(c.energy[0]);
  });

  test('meet-then-lower HOLDS first and only then descends — that is the whole iso-principle', () => {
    const meet = curveFor('meet-then-lower');
    const wind = curveFor('monotone-wind-down');
    expect(nonIncreasing(meet.energy)).toBe(true);
    // Over the opening quarter it has barely moved, where a plain wind-down is already leaving.
    const q = Math.floor(K / 4);
    const meetDrop = meet.energy[0] - meet.energy[q];
    const windDrop = wind.energy[0] - wind.energy[q];
    expect(meetDrop).toBeLessThan(windDrop * 0.5);
    // And it still arrives: both end near the bottom of the band.
    expect(meet.energy[K - 1]).toBeLessThan(meet.energy[0]);
  });

  test('warmup-peak-cooldown is a DOUBLE SIGMOID: rise, peak in the middle, fall', () => {
    const c = curveFor('warmup-peak-cooldown');
    const peakAt = c.energy.indexOf(Math.max(...c.energy));
    expect(peakAt).toBeGreaterThan(K * 0.3);
    expect(peakAt).toBeLessThan(K * 0.7);
    expect(nonDecreasing(c.energy.slice(0, peakAt + 1))).toBe(true);
    expect(nonIncreasing(c.energy.slice(peakAt))).toBe(true);
    expect(c.energy[peakAt]).toBeGreaterThan(c.energy[0] + 0.2);
    expect(c.energy[K - 1]).toBeLessThan(c.energy[peakAt] - 0.2);
  });

  test("a depleted body lowers the workout's PEAK without touching the hard band", () => {
    // The regulator's `intensityScale` lever (W4-006): somebody who asked to train still trains.
    const full = buildCurve('warmup-peak-cooldown',
      TARGETS({ trajectory: { archetype: 'warmup-peak-cooldown', intensityScale: 1 } }), K);
    const spent = buildCurve('warmup-peak-cooldown',
      TARGETS({ trajectory: { archetype: 'warmup-peak-cooldown', intensityScale: 0.65 } }), K);
    expect(Math.max(...spent.energy)).toBeLessThan(Math.max(...full.energy));
    expect(Math.max(...spent.l2)).toBeLessThan(Math.max(...full.l2));
    // ...and never below the floor the band already guarantees.
    expect(Math.min(...spent.energy)).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });

  test('the flat archetypes are flat, and flat-focus guards continuity hardest', () => {
    for (const id of ['steady', 'flat-focus', 'cadence-locked']) {
      const c = curveFor(id);
      expect(Math.max(...c.energy) - Math.min(...c.energy)).toBeLessThan(1e-9);
      expect(Math.max(...c.l2) - Math.min(...c.l2)).toBeLessThan(1e-9);
    }
    expect(SMOOTHNESS['flat-focus']).toBeGreaterThan(SMOOTHNESS.steady);
  });

  test('cadence-locked pins tempo to the anchor even when the arc asks it to move', () => {
    const c = buildCurve('cadence-locked', TARGETS({
      bpmCenter: 162, bpmWidth: 8, cadenceLocked: true,
      trajectory: { archetype: 'cadence-locked', start: { energy: 0.8, bpm: 120 }, end: { energy: 0.4, bpm: 90 } },
    }), K);
    for (const v of c.l2) expect(v).toBeCloseTo(Math.log2(162), 12);
    expect(c.cadenceLocked).toBe(true);
  });

  test("the regulator's endpoints are honoured EXACTLY at both ends when it supplies them", () => {
    const c = buildCurve('monotone-wind-down', TARGETS({
      trajectory: {
        archetype: 'monotone-wind-down',
        start: { energy: 0.72, bpm: 118 }, end: { energy: 0.22, bpm: 78 },
      },
    }), K);
    expect(c.energy[0]).toBeCloseTo(0.72, 9);
    expect(c.energy[K - 1]).toBeCloseTo(0.22, 9);
    expect(c.l2[0]).toBeCloseTo(Math.log2(118), 9);
    expect(c.l2[K - 1]).toBeCloseTo(Math.log2(78), 9);
  });

  test('valence LIFTS gently or not at all — it is never forced (D4)', () => {
    const lift = buildCurve('gentle-lift',
      TARGETS({ valenceTarget: 0.4, trajectory: { archetype: 'gentle-lift', valenceApproach: 'lift-gently' } }), K);
    expect(nonDecreasing(lift.valence)).toBe(true);
    expect(lift.valence[0]).toBeCloseTo(0.4, 9);
    // Bounded, and small: an ordering preference, not a mood filter.
    expect(lift.valence[K - 1] - lift.valence[0]).toBeGreaterThan(0);
    expect(lift.valence[K - 1] - lift.valence[0]).toBeLessThanOrEqual(0.15);

    for (const approach of ['sustain', 'meet', undefined]) {
      const flat = buildCurve('steady',
        TARGETS({ valenceTarget: 0.4, trajectory: { archetype: 'steady', valenceApproach: approach } }), K);
      expect(Math.max(...flat.valence) - Math.min(...flat.valence)).toBeLessThan(1e-9);
    }
  });

  test('an axis with no band has no curve, rather than a fabricated one', () => {
    const c = buildCurve('steady', TARGETS({ valenceTarget: null, bpmCenter: null }), K);
    expect(c.valence).toBeNull();
    expect(c.l2).toBeNull();
    expect(c.energy).toHaveLength(K);
  });
});

// ── 4 · the planner realises the arc ────────────────────────────────────────────────────────

describe('trajectoryPlanner — the playlist follows the arc', () => {
  test('a wind-down comes DOWN: the planned energy series trends negative', () => {
    const picks = corpus(40);
    const { ordered, stats } = planTrajectory(picks, {
      targets: TARGETS({ trajectory: { archetype: 'monotone-wind-down' } }),
    });
    expect(stats.planned).toBe(true);
    expect(stats.archetype).toBe('monotone-wind-down');
    expect(trendCorrelation(energies(ordered))).toBeLessThan(-0.8);
  });

  test('a lift goes UP, over the same tracks — the arc, not the corpus, sets the direction', () => {
    const picks = corpus(40);
    const down = planTrajectory(picks, { targets: TARGETS({ trajectory: { archetype: 'monotone-wind-down' } }) });
    const up = planTrajectory(picks, { targets: TARGETS({ trajectory: { archetype: 'gentle-lift' } }) });
    expect(trendCorrelation(energies(up.ordered))).toBeGreaterThan(0.8);
    expect(ids(up.ordered)).not.toEqual(ids(down.ordered));
    expect(ids(up.ordered).sort()).toEqual(ids(down.ordered).sort()); // same set, opposite shape
  });

  test('a workout builds and releases: the middle third is the loudest', () => {
    const picks = corpus(45);
    const { ordered } = planTrajectory(picks, {
      targets: TARGETS({ bpmCenter: 150, tempoBand: 'peak', activityDriven: true, activityIntensity: 'high' }),
    });
    const e = energies(ordered);
    const third = Math.floor(e.length / 3);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(e.slice(third, 2 * third))).toBeGreaterThan(mean(e.slice(0, third)));
    expect(mean(e.slice(third, 2 * third))).toBeGreaterThan(mean(e.slice(2 * third)));
  });

  test('planning never makes the arc worse than the order it was handed', () => {
    for (const archetype of Object.keys(ARCHETYPES)) {
      const { stats } = planTrajectory(corpus(35, `cost-${archetype}`), {
        targets: TARGETS({ trajectory: { archetype } }),
      });
      expect(stats.cost).toBeLessThanOrEqual(stats.costBefore + 1e-9);
      expect(Number.isFinite(stats.cost)).toBe(true);
    }
  });

  test('...including the case where the SEED loses to the order it was handed', () => {
    // The clause above passes on clean corpora whether or not the incoming order is allowed to
    // compete with the seed, so on its own it does not pin the guarantee. This is a MEASURED
    // counterexample: a sweep of 4000 random corpora found 4 (0.1%) where rank-matching plus 2-opt
    // lands in a local optimum WORSE than the order MMR already produced — 2-opt is a local search
    // and a confident seed can start it in the wrong basin. On this one the seed's own optimum
    // costs 0.938 against an incoming 0.826, a 14% regression; letting the identity order compete
    // as a second start finds 0.708, better than either. Fixed rather than fuzzed because 1-in-1000
    // is far too rare for a property run to police.
    const features = [
      { bpm: 79, energy: 0.0331, valence: 0.1168 },
      { bpm: 140, energy: 0.187, valence: 0.7749 },
      { bpm: null, energy: null, valence: 0.4009 },
      { bpm: 184, energy: 0.5948, valence: 0.772 },
      { bpm: 88, energy: 0.7663, valence: null },
      { bpm: null, energy: 0.9188, valence: 0.8491 },
      { bpm: 66, energy: 0.5988, valence: null },
    ];
    const picks = features.map((f, i) => pick(`seedloss${i}`, f));
    const { stats } = planTrajectory(picks, {
      targets: TARGETS({
        bpmCenter: 141, bpmWidth: 49, energyFloor: 0.3729, energyCeiling: 0.924,
        valenceTarget: 0.9231, cadenceLocked: true, activityDriven: false,
        trajectory: { archetype: 'gentle-lift' },
      }),
    });
    expect(stats.costBefore).toBeCloseTo(0.826, 3);
    expect(stats.cost).toBeLessThan(stats.costBefore);
    expect(stats.cost).toBeLessThan(0.938); // the seed-only answer, which this must beat
  });

  test('OCTAVE-FOLDED CONTINUITY: the planner INTERLEAVES octave twins instead of blocking them', () => {
    // A corpus of octave twins at one flat energy, so the fit term is constant and the ONLY thing
    // the planner can optimise is tempo continuity. This is the assertion that a raw-bpm seam
    // metric fails, and the first version of this test did NOT catch that: `maxFoldedNeighbourJump`
    // is small for BOTH metrics, because folding forgives the very octave jump the unfolded solver
    // is forced to pay. What separates them is the SHAPE of the answer — an unfolded metric
    // segregates the pool into two blocks and crosses the octave exactly once, where the folded
    // metric walks the circular tempo order and crosses at nearly every seam.
    //
    // Measured over this corpus: folded → 5 crossings, max seam 0.033 octaves;
    //                            raw    → 1 crossing,  max seam 0.096 octaves.
    const tempi = [66, 131, 68, 135, 70, 139];
    const picks = tempi.map((bpm, i) => pick(`x${i}`, feat(bpm, 0.5, 0.5)));
    const { ordered, stats } = planTrajectory(picks, {
      targets: TARGETS({ bpmCenter: 100, bpmWidth: 60, trajectory: { archetype: 'steady' } }),
    });
    let crossings = 0;
    for (let i = 0; i + 1 < ordered.length; i++) {
      const a = ordered[i].track.features.bpm;
      const b = ordered[i + 1].track.features.bpm;
      if (Math.abs(Math.log2(a) - Math.log2(b)) > 0.5) crossings++;
    }
    expect(crossings).toBeGreaterThanOrEqual(4);
    expect(maxFoldedNeighbourJump(ordered)).toBeLessThanOrEqual(0.05);
    expect(stats.folded).toBeGreaterThan(0); // the fold actually fired, it is not decoration
  });

  test('THE BEAM SEED EARNS ITS PLACE on a flat arc, where rank-matching has nothing to sort by', () => {
    // A flat curve makes the fit term position-independent, so the entire objective is the seam
    // path and the dominant-axis seed has no axis to match on. §M.11's beam-8 fallback is what
    // covers that branch — and the first version of this suite did not pin it: replacing the beam
    // with the incoming order changed no assertion, because 2-opt from identity happened to reach
    // the same answer on every case being exercised.
    //
    // Measured over 600 seeded flat-arc scenarios (2026-08-20): the beam produces a cheaper plan in
    // 444, loses in 128, ties in 28, mean cost 3.673 vs 3.865. This is the widest case in that
    // sweep — beam 1.805 against 2.622 seeded from the incoming order, a 31% difference.
    const features = [
      { bpm: 136, energy: 0.9375, valence: 0.4406 }, { bpm: 77, energy: 0.8705, valence: 0.4312 },
      { bpm: 91, energy: 0.1034, valence: 0.602 }, { bpm: 143, energy: 0.5885, valence: 0.4932 },
      { bpm: 87, energy: 0.9158, valence: 0.0986 }, { bpm: 182, energy: 0.2185, valence: 0.2101 },
      { bpm: 130, energy: 0.5025, valence: 0.6786 }, { bpm: 90, energy: 0.0956, valence: 0.0979 },
      { bpm: 91, energy: 0.9712, valence: 0.9803 }, { bpm: 63, energy: 0.9727, valence: 0.0203 },
      { bpm: 168, energy: 0.2992, valence: 0.9102 },
    ];
    const { stats } = planTrajectory(features.map((f, i) => pick(`beam${i}`, f)), {
      targets: TARGETS({
        bpmCenter: 103, bpmWidth: 37, energyFloor: 0.1558, energyCeiling: 0.9721,
        valenceTarget: 0.7029, cadenceLocked: false, trajectory: { archetype: 'flat-focus' },
      }),
    });
    expect(stats.seed).toBe('beam'); // the degenerate branch is the one under test
    expect(stats.cost).toBeCloseTo(1.805, 3);
    expect(stats.cost).toBeLessThan(2.3); // comfortably under the 2.622 an identity seed reaches
  });

  test('a CADENCE anchor CHARGES the fold: 81 bpm is not a free match for a 162-spm run', () => {
    // §M.10 — footfall has no octave, so only the candidate may move and it pays OFF_OCTAVE_PENALTY.
    // The distinction travels with `targets.cadenceLocked`, NOT with the archetype name: a regulator
    // that publishes a moving arc for a running state must still not let half-time claim a perfect
    // match. Same corpus, same arc, one flag apart — the locked run must cost strictly more.
    const tempi = [160, 162, 164, 166, 80, 81, 82, 83];
    const picks = tempi.map((bpm, i) => pick(`c${i}`, feat(bpm, 0.5, 0.5)));
    const base = {
      bpmCenter: 162, bpmWidth: 14, energyFloor: 0.5, energyCeiling: 0.95,
      trajectory: { archetype: 'warmup-peak-cooldown' },
    };
    const free = planTrajectory(picks, { targets: TARGETS({ ...base, cadenceLocked: false }) });
    const locked = planTrajectory(picks, { targets: TARGETS({ ...base, cadenceLocked: true }) });
    expect(locked.stats.archetype).toBe('warmup-peak-cooldown'); // the arc, not the flag, names it
    expect(locked.stats.cost).toBeGreaterThan(free.stats.cost);
  });

  test('FEATURELESS TRACKS GO WHERE THE ARC ASKS LEAST — the middle, never the peak', () => {
    // A featureless track cannot be judged against the curve at all. Putting one at the peak of
    // a workout or the bottom of a wind-down is where it is most audibly wrong, so it is charged
    // in proportion to how EXTREME the position's demand is and drifts to the mid-arc.
    const measured = Array.from({ length: 24 }, (_, i) => pick(`m${i}`, feat(80 + i * 3, 0.05 + i * 0.037, 0.5)));
    const blind = Array.from({ length: 6 }, (_, i) => pick(`blind${i}`, null));
    const { ordered } = planTrajectory([...measured, ...blind], {
      targets: TARGETS({ trajectory: { archetype: 'monotone-wind-down' } }),
    });
    const n = ordered.length;
    const positions = ordered
      .map((p, i) => (p.track.features == null ? i : -1))
      .filter(i => i >= 0);
    expect(positions).toHaveLength(6);
    const meanPos = positions.reduce((s, v) => s + v, 0) / positions.length / (n - 1);
    expect(meanPos).toBeGreaterThan(0.3);
    expect(meanPos).toBeLessThan(0.7);
    // and none of them is parked on an endpoint, where the arc is most specific
    expect(positions).not.toContain(0);
    expect(positions).not.toContain(n - 1);
  });

  test('a partially-measured track is judged on what it has, not dropped or fabricated', () => {
    const picks = [
      ...Array.from({ length: 10 }, (_, i) => pick(`full${i}`, feat(90 + i * 4, 0.1 + i * 0.08, 0.5))),
      pick('tempo-only', { bpm: 92, energy: null, valence: null, source: 'llm', confidence: 0.3 }),
      pick('energy-only', { bpm: null, energy: 0.85, valence: null, source: 'llm', confidence: 0.3 }),
    ];
    const { ordered } = planTrajectory(picks, {
      targets: TARGETS({ trajectory: { archetype: 'gentle-lift' } }),
    });
    // energy-only is the loudest thing in the pool and the arc rises: it belongs near the end.
    const at = (id) => ids(ordered).indexOf(id);
    expect(at('energy-only')).toBeGreaterThan(ordered.length / 2);
    expect(at('tempo-only')).toBeGreaterThanOrEqual(0);
  });
});

// ── 5 · determinism and numerical hygiene ───────────────────────────────────────────────────

describe('trajectoryPlanner — determinism and hygiene', () => {
  test('the same input always produces the same order and the same cost (S9)', () => {
    const targets = TARGETS({ trajectory: { archetype: 'meet-then-lower' } });
    const a = planTrajectory(corpus(40, 'det'), { targets });
    const b = planTrajectory(corpus(40, 'det'), { targets });
    expect(ids(a.ordered)).toEqual(ids(b.ordered));
    expect(a.stats.cost).toBe(b.stats.cost);
  });

  test('every stat it reports is a finite number or a closed token, never NaN', () => {
    const { stats } = planTrajectory(corpus(30), { targets: TARGETS() });
    for (const key of ['cost', 'costBefore', 'k', 'passes', 'swaps', 'folded']) {
      expect(Number.isFinite(stats[key])).toBe(true);
    }
    expect(['dominant-axis', 'beam', 'none']).toContain(stats.seed);
    expect(stats.v).toBe(PLANNER_VERSION);
  });

  test('S15 telemetry is one line of tokens and coarse numbers — no vitals, no track identity', () => {
    const { stats } = planTrajectory(corpus(30), { targets: TARGETS({ trajectory: { archetype: 'flat-focus' } }) });
    expect(stats.telemetry).toMatch(/^\[trajectory\] /);
    expect(stats.telemetry).not.toMatch(/\n/);
    expect(stats.telemetry).toContain('arc=flat-focus');
    expect(stats.telemetry).toContain(`v=${PLANNER_VERSION}`);
    expect(stats.telemetry).not.toMatch(/t0\d\d|hr=|bpmValue/);
  });

  test('FUZZ: arbitrary junk features never break the permutation or produce a non-finite cost (S8)', () => {
    const junk = fc.oneof(
      fc.constant(null), fc.constant(undefined), fc.constant(NaN),
      fc.constant(Infinity), fc.constant(-Infinity), fc.constant(0),
      fc.constant(''), fc.constant('120'), fc.constant(true), fc.constant([]), fc.constant({}),
      fc.double({ min: -1e6, max: 1e6, noNaN: false }),
    );
    const features = fc.oneof(
      fc.constant(null),
      fc.record({ bpm: junk, energy: junk, valence: junk }),
    );
    fc.assert(fc.property(
      fc.array(features, { minLength: 2, maxLength: 30 }),
      fc.constantFrom(...Object.keys(ARCHETYPES)),
      (fs, archetype) => {
        const picks = fs.map((f, i) => pick(`j${i}`, f));
        const { ordered, stats } = planTrajectory(picks, { targets: TARGETS({ trajectory: { archetype } }) });
        expect(ordered).toHaveLength(picks.length);
        expect(new Set(ordered).size).toBe(picks.length);
        expect(Number.isFinite(stats.cost)).toBe(true);
        expect(stats.cost).toBeGreaterThanOrEqual(0);
      },
    ), { numRuns: 300, seed: 20260820 });
  });

  test('FUZZ: a degenerate or hostile band never throws and never fabricates an arc (S8)', () => {
    const num = fc.oneof(
      fc.constant(null), fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity),
      fc.constant(0), fc.double({ min: -500, max: 500, noNaN: true }),
    );
    fc.assert(fc.property(
      fc.record({
        bpmCenter: num, bpmWidth: num, energyFloor: num, energyCeiling: num, valenceTarget: num,
        cadenceLocked: fc.boolean(), activityDriven: fc.boolean(),
        tempoBand: fc.constantFrom('resting', 'active', 'peak', 'slow', null, undefined),
      }),
      (over) => {
        const picks = corpus(12, 'band-fuzz');
        const { ordered, stats } = planTrajectory(picks, { targets: TARGETS(over) });
        expect(ids(ordered).sort()).toEqual(ids(picks).sort());
        expect(Number.isFinite(stats.cost)).toBe(true);
        expect(ARCHETYPES[stats.archetype] ?? stats.archetype === 'none').toBeTruthy();
      },
    ), { numRuns: 300, seed: 20260820 });
  });

  test('an inverted band (floor above ceiling) is survived, not amplified', () => {
    const picks = corpus(15, 'inverted');
    const { ordered, stats } = planTrajectory(picks, {
      targets: TARGETS({ energyFloor: 0.9, energyCeiling: 0.1, trajectory: { archetype: 'monotone-wind-down' } }),
    });
    expect(ids(ordered).sort()).toEqual(ids(picks).sort());
    expect(Number.isFinite(stats.cost)).toBe(true);
    for (const v of buildCurve('monotone-wind-down',
      TARGETS({ energyFloor: 0.9, energyCeiling: 0.1 }), 10).energy) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('a corpus where every track is identical is a no-op the solver terminates on', () => {
    const picks = Array.from({ length: 20 }, (_, i) => pick(`same${i}`, feat(100, 0.5, 0.5)));
    const { ordered, stats } = planTrajectory(picks, { targets: TARGETS() });
    expect(ids(ordered)).toEqual(ids(picks)); // zero improvement available → the seed order stands
    expect(stats.swaps).toBe(0);
  });
});

// ── 6 · the perf budget (§0.4 S10: trajectory planning < 30 ms at k=50) ─────────────────────

// WHY THE SLO IS MEASURED IN A CHILD PROCESS, AND THE COLLAPSE GUARD IS NOT.
//
// §0.4 S10 budgets trajectory planning at < 30 ms for k=50. That is a PRODUCTION number, and jest
// cannot measure it: its module sandbox is roughly an order of magnitude slower than plain node on
// tight numeric work. Measured on this box, 2026-08-20, the same 2e7-iteration `Math.sqrt` loop
// costs 311 ms under `node -e` and 6551 ms inside a jest test — 21x, on arithmetic with no
// allocation at all. The planner itself measures ~1.2 ms per plan under node and ~34 ms under jest.
//
// So asserting 30 ms against the in-jest figure would not be enforcing S10; it would be enforcing
// an accidental ~25x-stricter budget on babel-jest's sandbox, and it would sit right at the edge of
// its own noise — the exact defect W4-D09 removed from the two pre-existing budget assertions.
//
// The two questions are therefore asked with two instruments:
//   · the SLO, in a child `node` process, against S10's literal 30 ms (execFileSync + a seeded
//     corpus, the `wave4.stateGuard` precedent for shelling out to `process.execPath`);
//   · COLLAPSE, in-process every run, against a ceiling sized to jest's own observed range — that
//     is what catches an O(k³) rewrite or a re-introduced allocation in the k² loop, and it does
//     not need to know what a millisecond means outside the sandbox to do it.

describe('trajectoryPlanner — performance', () => {
  const perf = require('../jest/perfBudget');
  const { execFileSync } = require('child_process');

  test('meets the §0.4 S10 SLO — under 30 ms per plan at k=50, measured OUTSIDE jest', () => {
    const program = `
      const { planTrajectory } = require(process.argv[1]);
      const { createRng } = require(process.argv[2]);
      const rng = createRng('perf-slo');
      const picks = Array.from({ length: 50 }, (_, i) => ({
        track: { id: 't' + i, features: {
          bpm: Math.round(rng.range(70, 140)),
          energy: rng.range(0.05, 0.95),
          valence: rng.range(0.05, 0.95),
        } },
        total: 0.5,
      }));
      const targets = ${JSON.stringify(TARGETS({ trajectory: { archetype: 'warmup-peak-cooldown' } }))};
      for (let i = 0; i < 20; i++) planTrajectory(picks, { targets });
      let min = Infinity;
      for (let s = 0; s < 7; s++) {
        const t = process.hrtime.bigint();
        planTrajectory(picks, { targets });
        const ms = Number(process.hrtime.bigint() - t) / 1e6;
        if (ms < min) min = ms;
      }
      process.stdout.write(String(min));
    `;
    const out = execFileSync(process.execPath, [
      '-e', program,
      require.resolve('../app/agents/runtime/delivery/trajectoryPlanner'),
      require.resolve('../sim/rng'),
    ], { encoding: 'utf8', timeout: 60000 });
    const ms = Number(out);
    // Min-of-N (W4-D09): wall-clock noise is one-sided, so every sample must be inflated for the
    // result to be. Recorded on every run so a slow drift inside the budget stays visible.
    console.log(`[perf] trajectoryPlanner k=50 (out-of-jest) min=${ms} budget=30`);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeLessThan(30);
  });

  test('COLLAPSE GUARD: the in-jest cost stays inside its observed range', async () => {
    const picks = corpus(50, 'perf');
    const targets = TARGETS({ trajectory: { archetype: 'warmup-peak-cooldown' } });
    const m = await perf.measure(() => { planTrajectory(picks, { targets }); },
      { samples: 7, warmup: 2, label: 'trajectoryPlanner k=50 (in-jest)' });
    // 120 is ~3.5x the worst in-jest min observed on this box (34 ms) — clear of the sandbox's
    // whole range, so only a real algorithmic regression can trip it. No `strictMs`: the SLO is
    // the child-process test above, and pointing PERF_STRICT at this instrument would make one
    // spelling of the switch fail for reasons that have nothing to do with the engine.
    perf.expectWithinBudget(m, { budgetMs: 120 });
  });
});
