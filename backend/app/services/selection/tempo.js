'use strict';

// Shared octave-folded tempo metric (Wave-4 W4-007, §M.10). PURE — no I/O, no clock.
//
// WHY THIS EXISTS AS ITS OWN MODULE
// Three call sites need the same tempo distance and must never drift apart: the scorer's
// tempo kernel (`selection/score.js`), MMR's similarity (`selection/mmr.js`), and — next —
// the trajectory planner's neighbour cost (W4-008 §M.11) and the v2 embedding's tempo dims
// (W4-014 §M.16). Before this module each of those carried its own ad-hoc arithmetic:
// `1 - min(1, |Δbpm| / 130)` in MMR and `exp(-((bpm-c)/(2w))²)` in the scorer, which disagree
// about what "close" means and both work in RAW bpm.
//
// WHY LOG SPACE
// Tempo is perceived multiplicatively: 60→66 and 160→176 are the same 10% change, but a raw
// difference calls the second one nearly three times worse. Working in log₂ makes the metric
// scale-free, and it makes the octave an integer step — which is what lets us fold it.
//
// WHY FOLD
// Every beat tracker in this corpus (ReccoBeats' API values and the CC0 AcousticBrainz
// analyses) reports half- or double-time for a substantial minority of tracks. That is a
// KNOWN, STRUCTURED measurement error, not a property of the music: an 87-bpm reading and a
// 174-bpm reading of the same groove must not be scored as opposites. Folding {−1, 0, +1}
// octaves corrects the artefact at its source instead of papering over it downstream.
//
// WHY THE CADENCE EXCEPTION
// When the target IS a step cadence — `translate`'s CADENCE_BPM (walking 118, running 162,
// cycling 145), flagged onto the targets as `cadenceLocked` — the number is a PHYSICAL
// entrainment target and footfall has no octave. A free fold would let an 81-bpm track claim
// a perfect match for a 162-spm run. But the measurement error is just as real there, so the
// half/double branch stays available and is charged OFF_OCTAVE_PENALTY octaves. §M.10's
// "NEVER fold the anchor itself" is honoured literally: the anchor is the fixed reference and
// only the candidate is allowed to move, at a price. This is also what replaces the
// double-time rationale behind biosonicBand's ACOUSTIC_CEIL — that texture gate stays, but the
// octave artefact is now handled where it belongs, in the tempo metric.

// Gaussian sigma in OCTAVES (§M.10 "kernel σ ≈ 0.12 octaves"). 0.12 octaves is ±8.7% of the
// centre — ~±10 bpm at 120 — so the kernel discriminates meaningfully INSIDE a band without
// re-implementing the band. Deliberately NOT derived from `targets.bpmWidth`: the width is
// already the un-relaxable hard gate in `biosonicBand`, and letting it set this sigma too
// would double-count it (a stress-narrowed width-8 band would get a kernel narrower than the
// gate that already excluded everything outside it). The energy kernel is the one W4-007
// binds to a band half-width, because energy has no separate hard gate of its own.
const DEFAULT_SIGMA_OCT = parseFloat(process.env.SCORE_SIGMA_BPM_OCT ?? '0.12');

// Octaves charged for matching a cadence anchor at half/double time (§M.10 "+0.15·d").
// At the default sigma this lands the octave twin at exp(-½(0.15/0.12)²) ≈ 0.46: clearly
// demoted below an on-cadence track, clearly still ahead of a genuinely off-cadence one.
const OFF_OCTAVE_PENALTY = parseFloat(process.env.SCORE_OFF_OCTAVE_PENALTY ?? '0.15');

// A tempo is usable only if it is a strictly positive finite number (log₂ of 0 is -Infinity
// and of a negative is NaN, so the domain guard IS the S8 numerical guard here). Numeric
// strings coerce — they arrive from JSON payloads — but null/''/booleans/objects abstain
// rather than becoming 0, the `Number(null) === 0` trap W4-D15 closed on the serving path.
function _bpm(x) {
  if (x == null || typeof x === 'boolean' || (typeof x === 'string' && !x.trim())) return null;
  if (typeof x === 'object') return null;
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Folded log₂ distance in OCTAVES between a candidate tempo and a target tempo.
 *
 * @param {number} bpm            candidate tempo
 * @param {number} centerBpm      target tempo
 * @param {{cadenceLocked?: boolean}} [opts]  cadence anchor → off-octave matches are charged
 * @returns {number|null} distance in octaves, or null when either side is unusable
 */
function octaveDistance(bpm, centerBpm, { cadenceLocked = false } = {}) {
  const b = _bpm(bpm);
  const c = _bpm(centerBpm);
  if (b == null || c == null) return null;

  const delta = Math.log2(b) - Math.log2(c);
  const penalty = cadenceLocked ? Math.max(0, OFF_OCTAVE_PENALTY) : 0;

  // The penalty is added BEFORE the min, not after: charging the winner would let a
  // half-time match beat a genuine near-miss at the same octave (170 vs a 162 anchor is
  // 0.069 away and must stay ahead of the 0.15-priced twin).
  let best = Math.abs(delta);
  for (const o of [-1, 1]) {
    const d = Math.abs(delta - o) + penalty;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Gaussian tempo kernel over the folded distance: k = exp(−½(d/σ)²), σ in octaves.
 *
 * @returns {number|null} fit ∈ [0,1], or null when either tempo is unusable (ABSTAIN —
 *          the caller decides what "no tempo evidence" is worth; it is never a fit of 0).
 */
function tempoKernel(bpm, centerBpm, { cadenceLocked = false, sigmaOct } = {}) {
  const d = octaveDistance(bpm, centerBpm, { cadenceLocked });
  if (d == null) return null;
  const s = Number(sigmaOct);
  // A degenerate sigma (0, negative, NaN, Infinity) must not produce NaN or a divide-by-zero
  // spike — fall back to the default rather than fabricating a perfect or impossible fit.
  const sigma = Number.isFinite(s) && s > 0 ? s : DEFAULT_SIGMA_OCT;
  const z = d / sigma;
  return Math.exp(-0.5 * z * z);
}

module.exports = { octaveDistance, tempoKernel, DEFAULT_SIGMA_OCT, OFF_OCTAVE_PENALTY };
