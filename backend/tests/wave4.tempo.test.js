'use strict';

// Wave-4 W4-007 — the shared octave-folded tempo module (§M.10).
//
// Tempo is the one selection dimension whose measurements carry a KNOWN, structured error:
// every beat tracker in the corpus (ReccoBeats, AcousticBrainz) reports half- or double-time
// for a large minority of tracks. Comparing raw bpm therefore punishes tracks for a metadata
// artefact rather than for how they sound — 87 and 174 are the same groove. The fold is a
// measurement-error correction first and a musical-equivalence claim second.
//
// The exception is a CADENCE anchor. When the target bpm IS a step cadence (walking 118,
// running 162, cycling 145 — `translate`'s CADENCE_BPM), the number is a physical entrainment
// target: footfall has no octave. Folding it for free would let an 81-bpm track claim a perfect
// match for a 162-spm run. So a cadence anchor still ALLOWS the half/double match (the
// measurement error is real there too) but charges OFF_OCTAVE_PENALTY octaves for it, and the
// anchor itself is never folded (§M.10: "NEVER fold the anchor itself").

process.env.NODE_ENV = 'test';

const {
  octaveDistance,
  tempoKernel,
  toLog2,
  foldedDistanceLog2,
  OFF_OCTAVE_PENALTY,
  DEFAULT_SIGMA_OCT,
} = require('../app/services/selection/tempo');
const { createRng } = require('../sim/rng');

describe('W4-007 · tempo.octaveDistance — §M.10 folded log-tempo distance', () => {
  it('is zero for an exact match and symmetric in its arguments', () => {
    expect(octaveDistance(120, 120)).toBe(0);
    expect(octaveDistance(90, 130)).toBeCloseTo(octaveDistance(130, 90), 12);
  });

  it('folds the octave: 87 vs 174 is a ZERO-distance match, as is 174 vs 87', () => {
    expect(octaveDistance(87, 174)).toBeCloseTo(0, 12);
    expect(octaveDistance(174, 87)).toBeCloseTo(0, 12);
  });

  it('measures the residual in octaves, so it is scale-free', () => {
    // A 10% tempo difference is the same distance at 60 bpm as at 160 bpm — the whole
    // point of working in log space (a raw-bpm metric calls 60→66 six units and 160→176
    // sixteen, and then rates the fast pair as the worse mismatch).
    expect(octaveDistance(60, 66)).toBeCloseTo(octaveDistance(160, 176), 12);
    expect(octaveDistance(120, 130)).toBeCloseTo(Math.log2(130 / 120), 12);
  });

  it('never exceeds half an octave for any pair WITHIN one octave of each other', () => {
    // The fold covers o ∈ {−1, 0, +1}, so it bounds the distance at 0.5 exactly over the
    // range a single fold can reach. That is the useful guarantee: any two tempos in the
    // same or adjacent octave are at most a half-octave apart after correction.
    for (let b = 30; b <= 260; b += 1) {
      for (const c of [60, 87, 120, 162, 200]) {
        if (Math.abs(Math.log2(b / c)) > 1.5) continue;
        expect(octaveDistance(b, c)).toBeLessThanOrEqual(0.5 + 1e-12);
      }
    }
  });

  it('folds ONE octave, not arbitrarily many — 40 vs 160 stays two octaves apart', () => {
    // §M.10 fixes o ∈ {−1, 0, +1} on purpose. Half/double is the beat-tracker artefact this
    // corrects; quarter/quadruple time is not that artefact, and treating 40 and 160 as the
    // same groove would hand a workout target a track nobody would call fast. Pinned so a
    // future "why not fold everything" refactor has to argue with a test.
    expect(octaveDistance(40, 160)).toBeCloseTo(1, 12);
    expect(octaveDistance(40, 80)).toBeCloseTo(0, 12);
  });

  it('CADENCE ANCHOR: the half/double match is allowed but costs OFF_OCTAVE_PENALTY octaves', () => {
    // 162 spm running cadence. An 81-bpm track is a plausible double-time read of a
    // 162-bpm track, so it is not rejected — but it must not tie with a genuine 162.
    expect(octaveDistance(81, 162, { cadenceLocked: true })).toBeCloseTo(OFF_OCTAVE_PENALTY, 12);
    expect(octaveDistance(324, 162, { cadenceLocked: true })).toBeCloseTo(OFF_OCTAVE_PENALTY, 12);
    expect(octaveDistance(162, 162, { cadenceLocked: true })).toBe(0);
  });

  it('CADENCE ANCHOR: an on-cadence track always beats its own half-time twin', () => {
    for (const anchor of [118, 145, 162]) {
      const exact = octaveDistance(anchor, anchor, { cadenceLocked: true });
      const half  = octaveDistance(anchor / 2, anchor, { cadenceLocked: true });
      expect(exact).toBeLessThan(half);
    }
  });

  it('CADENCE ANCHOR: the penalty never makes the folded branch beat a genuinely nearer raw distance', () => {
    // 170 vs a 162 anchor is a near-miss at the same octave (0.069) — the folded branch
    // (0.15+) must not win it. The `min` has to be taken AFTER the penalty is applied.
    const near = octaveDistance(170, 162, { cadenceLocked: true });
    expect(near).toBeCloseTo(Math.log2(170 / 162), 12);
    expect(near).toBeLessThan(OFF_OCTAVE_PENALTY);
  });

  it('abstains (null) on absent, zero, negative and non-finite tempos — never NaN, never 0', () => {
    for (const bad of [null, undefined, 0, -120, NaN, Infinity, -Infinity, 'x', {}, [], true]) {
      expect(octaveDistance(bad, 120)).toBeNull();
      expect(octaveDistance(120, bad)).toBeNull();
    }
    // A numeric string is real data from a JSON payload and coerces, like every other
    // numeric guard on the serving path.
    expect(octaveDistance('120', 120)).toBe(0);
  });
});

describe('W4-007 · tempo.tempoKernel — the Gaussian over folded distance', () => {
  it('peaks at 1 for an exact match and for the octave twin', () => {
    expect(tempoKernel(120, 120)).toBeCloseTo(1, 12);
    expect(tempoKernel(60, 120)).toBeCloseTo(1, 12);
  });

  it('is monotone decreasing in |Δ| away from the centre', () => {
    let prev = Infinity;
    for (const bpm of [120, 124, 130, 140, 150, 160]) {
      const k = tempoKernel(bpm, 120);
      expect(k).toBeLessThan(prev);
      prev = k;
    }
  });

  it('stays inside [0,1] for every tempo in the legal range, at every centre', () => {
    for (let b = 30; b <= 260; b += 7) {
      for (const c of [40, 87, 120, 162, 260]) {
        for (const cadenceLocked of [false, true]) {
          const k = tempoKernel(b, c, { cadenceLocked });
          expect(Number.isFinite(k)).toBe(true);
          expect(k).toBeGreaterThanOrEqual(0);
          expect(k).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('abstains (null) when either side is unusable — it never fabricates a fit', () => {
    expect(tempoKernel(null, 120)).toBeNull();
    expect(tempoKernel(120, null)).toBeNull();
  });

  it('CADENCE ANCHOR: the octave twin is demoted well below an exact match but stays a contender', () => {
    const exact = tempoKernel(162, 162, { cadenceLocked: true });
    const twin  = tempoKernel(81, 162, { cadenceLocked: true });
    const wrong = tempoKernel(110, 162, { cadenceLocked: true }); // genuinely off-cadence
    expect(exact).toBeCloseTo(1, 12);
    expect(twin).toBeLessThan(0.6);
    expect(twin).toBeGreaterThan(wrong);
  });

  it('honours an explicit sigma and defaults to DEFAULT_SIGMA_OCT (§M.10 ≈ 0.12 octaves)', () => {
    expect(DEFAULT_SIGMA_OCT).toBeCloseTo(0.12, 12);
    // One sigma out is exp(-1/2) by construction — this pins that the sigma is the
    // Gaussian's sigma and not, say, a half-width or a variance.
    const oneSigma = 120 * Math.pow(2, DEFAULT_SIGMA_OCT);
    expect(tempoKernel(oneSigma, 120)).toBeCloseTo(Math.exp(-0.5), 10);
    expect(tempoKernel(oneSigma, 120, { sigmaOct: 2 * DEFAULT_SIGMA_OCT })).toBeCloseTo(Math.exp(-0.125), 10);
  });

  it('a degenerate sigma cannot produce NaN (S8 numerical hygiene)', () => {
    for (const sigmaOct of [0, -1, NaN, null, Infinity]) {
      const k = tempoKernel(130, 120, { sigmaOct });
      expect(Number.isFinite(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
    }
  });
});

// ── the log-domain entry point (W4-007 evidence half) ──────────────────────────
//
// MMR asks for the same track's tempo once per PAIR — ~250k times per generation at k=50 —
// and every one of those was re-deriving `Math.log2`. `toLog2` + `foldedDistanceLog2` let a
// caller hoist that to once per TRACK. The pins that matter are not the arithmetic (that is
// the same fold as before) but the EQUIVALENCE: the moment the two entry points disagree,
// the scorer and MMR are back to two different notions of "close", which is the exact
// divergence this module exists to prevent.

describe('W4-007 · tempo.toLog2 / foldedDistanceLog2 — the hoisted path', () => {
  it('carries the same usability guard as the bpm path', () => {
    expect(toLog2(120)).toBeCloseTo(Math.log2(120), 12);
    expect(toLog2('120')).toBeCloseTo(Math.log2(120), 12);
    for (const bad of [null, undefined, 0, -1, NaN, Infinity, '', '  ', true, false, {}, []]) {
      expect(toLog2(bad)).toBeNull();
    }
  });

  it('abstains when either side is unusable, exactly as the bpm path does', () => {
    expect(foldedDistanceLog2(null, Math.log2(120))).toBeNull();
    expect(foldedDistanceLog2(Math.log2(120), null)).toBeNull();
  });

  it('EQUIVALENCE: agrees with octaveDistance over 300 seeded tempo pairs, both modes', () => {
    // Log-uniform draws over the corpus range, so half/double pairs occur naturally rather
    // than only at the hand-picked values the cases above use.
    const rng = createRng(0x7E3B0);
    for (let i = 0; i < 300; i++) {
      const a = 40 * Math.pow(2, rng.next() * 2.5);
      const b = 40 * Math.pow(2, rng.next() * 2.5);
      for (const cadenceLocked of [false, true]) {
        const viaBpm = octaveDistance(a, b, { cadenceLocked });
        const viaLog = foldedDistanceLog2(toLog2(a), toLog2(b), { cadenceLocked });
        expect(viaLog).toBeCloseTo(viaBpm, 12);
      }
    }
  });

  it('is the ONE implementation: octaveDistance delegates rather than duplicating the fold', () => {
    // A copy would drift silently; this asserts the delegation itself at the exact octave,
    // where a duplicated implementation is most likely to diverge.
    for (const [a, b] of [[87, 174], [174, 87], [162, 81], [120, 120], [70, 160]]) {
      expect(octaveDistance(a, b)).toBe(foldedDistanceLog2(toLog2(a), toLog2(b)));
    }
  });
});
