'use strict';

// Maximal Marginal Relevance: greedy selection balancing score against
// similarity to what's already picked — guaranteed intra-playlist variety.
// Similarity v1 (embeddings land in Phase 7): same-artist dominates (an
// artist monoculture is the worst perceived repetition), then measured
// feature distance, then genre Jaccard as the weakest signal.

const { cosine } = require('../vector/embedding');
const { measured } = require('../features/featureProvider');
const { toLog2, foldedDistanceLog2 } = require('./tempo');

// S11 escape hatch — one flag for the whole W4-007 selection change (scorer, this
// similarity, and biosonicBand's null handling). Read per call so no restart is needed.
const legacySimilarity = () => Boolean(process.env.WAVE4_SCORING_V2_DISABLED);

// Relative contribution of each dim to perceived similarity; renormalised over the dims the
// PAIR actually shares, so a partial comparison stays calibrated instead of scoring low
// merely for being partial. Sums to 1 (§W4-007: "coefficients sum to 1").
const SIM_WEIGHTS = Object.freeze({ bpm: 0.30, energy: 0.25, valence: 0.20, acousticness: 0.15, danceability: 0.10 });
// Similarity is a broader question than "does this track fit the request", so its tempo
// tolerance is wider than the scorer's 0.12-octave kernel: two tracks a few percent apart in
// tempo are, for playlist-variety purposes, the same tempo.
// Resolved ONCE at load, not per call: this constant is read inside the O(k²·window) greedy
// loop, so a per-call `process.env` hop would run thousands of times per generation — the
// exact shape of the shadow-audit latency finding that memoized the scorer's weights.
const SIM_SIGMA_OCT = (() => {
  const v = parseFloat(process.env.MMR_SIM_SIGMA_OCT ?? '0.30');
  return Number.isFinite(v) && v > 0 ? v : 0.30;
})();

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Genre sets are memoized per track object: the greedy loop runs O(k²·window)
// similarity calls and rebuilding Sets each time was the shadow-audit latency
// kill (975ms on a 500-track pool).
const _genreSets = new WeakMap();
function _genreSet(track) {
  let set = _genreSets.get(track);
  if (!set) {
    set = new Set((track.genres || []).map(g => String(g).toLowerCase()));
    _genreSets.set(track, set);
  }
  return set;
}

function _jaccardSets(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const g of setA) if (setB.has(g)) inter++;
  return inter / (setA.size + setB.size - inter);
}

// v1: three dims, raw-bpm distance over an arbitrary 130-bpm scale, unweighted mean.
function _featureSimV1(fa, fb) {
  if (!fa || !fb) return null;
  const dims = [];
  if (Number.isFinite(fa.bpm) && Number.isFinite(fb.bpm)) dims.push(1 - Math.min(1, Math.abs(fa.bpm - fb.bpm) / 130));
  if (Number.isFinite(fa.energy) && Number.isFinite(fb.energy)) dims.push(1 - Math.abs(fa.energy - fb.energy));
  if (Number.isFinite(fa.valence) && Number.isFinite(fb.valence)) dims.push(1 - Math.abs(fa.valence - fb.valence));
  if (!dims.length) return null;
  return dims.reduce((s, d) => s + d, 0) / dims.length;
}

// v2 (W4-007): all five judged dims, weighted, with the tempo term on the shared octave-
// folded metric. Three things v1 got wrong, all of which made MMR suppress the wrong tracks:
//   · it never looked at acousticness or danceability, so a solo acoustic ballad and a club
//     edit at the same tempo and energy came back IDENTICAL and one was dropped as a dupe;
//   · it compared raw bpm against a 130-bpm scale, so 87 and 174 — the same groove with a
//     halved beat-tracker reading — scored 0.33 similar and both survived as "variety";
//   · it took an unweighted mean over whichever dims happened to be present, so tempo and
//     acousticness carried the same authority over perceived repetition.
// Per-TRACK derived similarity vector, memoized on the features object exactly as the genre
// Sets above are memoized on the track. The greedy loop asks the same track for its tempo and
// its four unit-interval dims once per PAIR — up to ~250k times per generation at k=50 — and
// every one of those was re-running `Math.log2` plus five type coercions on values that
// cannot change. Hoisting them is what keeps the five-dim similarity affordable: measured on
// the 500-track golden corpus, the MMR stage went 558 ms -> below v1's 287 ms, with the fold
// arithmetic still living in ./tempo rather than being copied here.
//
// Same assumption as the genre memo above: `featuresOf` builds a fresh projection per track
// per generation and nothing mutates one in place. A caller that edited a features object
// after it had been compared would keep the old vector.
const SIM_UNIT_DIMS = Object.freeze(['energy', 'valence', 'acousticness', 'danceability']);
const SIM_UNIT_WEIGHTS = Object.freeze(SIM_UNIT_DIMS.map(d => SIM_WEIGHTS[d]));
const _simVectors = new WeakMap();
function _simVector(f) {
  let v = _simVectors.get(f);
  if (!v) {
    v = { l2: toLog2(f.bpm), dims: SIM_UNIT_DIMS.map(d => measured(f[d])) };
    _simVectors.set(f, v);
  }
  return v;
}

function _featureSimV2(fa, fb) {
  if (!fa || !fb || typeof fa !== 'object' || typeof fb !== 'object') return null;
  const va = _simVector(fa);
  const vb = _simVector(fb);
  let weightSum = 0;
  let acc = 0;

  const da = foldedDistanceLog2(va.l2, vb.l2);
  if (da != null) {
    acc += SIM_WEIGHTS.bpm * Math.exp(-0.5 * (da / SIM_SIGMA_OCT) ** 2);
    weightSum += SIM_WEIGHTS.bpm;
  }
  for (let i = 0; i < SIM_UNIT_DIMS.length; i++) {
    const a = va.dims[i];
    const b = vb.dims[i];
    if (a == null || b == null) continue;
    acc += SIM_UNIT_WEIGHTS[i] * (1 - Math.min(1, Math.abs(a - b)));
    weightSum += SIM_UNIT_WEIGHTS[i];
  }
  // No shared dim: abstain. The caller falls back to genre, which is the honest weaker
  // signal — a fabricated 0 would read as "guaranteed variety" and a 1 as "duplicate".
  if (weightSum <= 0) return null;
  return Math.min(1, Math.max(0, acc / weightSum));
}

function _featureSim(fa, fb) {
  return legacySimilarity() ? _featureSimV1(fa, fb) : _featureSimV2(fa, fb);
}

function defaultSimilarity(a, b) {
  const artistA = String(a.artist ?? '').toLowerCase().trim();
  const artistB = String(b.artist ?? '').toLowerCase().trim();
  if (artistA && artistA === artistB) return 1;

  // Embedding cosine (Phase 7) is the strongest signal when both sides have one.
  if (a.embedding?.length && b.embedding?.length && a.embedding.length === b.embedding.length) {
    return clamp01(cosine(a.embedding, b.embedding));
  }

  const feat = _featureSim(a.features, b.features);
  const genre = _jaccardSets(_genreSet(a), _genreSet(b));
  if (feat != null) return clamp01(0.6 * feat + 0.3 * genre);
  return clamp01(0.3 * genre);
}

/**
 * @param {Array<{track: object, total: number}>} scored
 * @returns the selected subset, in pick order
 */
function select(scored = [], { k = 50, lambda = 0.7, similarity = defaultSimilarity } = {}) {
  const remaining = [...scored].sort((a, b) => b.total - a.total);
  const picked = [];
  // Candidate window: only the top slice of the (score-sorted) remainder can
  // realistically win a pick — evaluating all 500 every round is wasted work.
  const windowSize = Math.max(k * 2, 100);

  while (picked.length < k && remaining.length) {
    let bestIdx = 0;
    let bestValue = -Infinity;
    const limit = Math.min(remaining.length, windowSize);
    for (let i = 0; i < limit; i++) {
      const cand = remaining[i];
      // Branch-and-bound: candidates are score-sorted, so λ·total is a falling
      // upper bound on value — once it can't beat the incumbent, nothing later
      // can either. Cuts the similarity work by an order of magnitude under load.
      if (lambda * cand.total <= bestValue) break;
      let maxSim = 0;
      for (const p of picked) {
        const sim = similarity(cand.track, p.track);
        if (sim > maxSim) maxSim = sim;
        if (maxSim >= 1) break;
      }
      const value = lambda * cand.total - (1 - lambda) * maxSim;
      if (value > bestValue) { bestValue = value; bestIdx = i; }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  return picked;
}

module.exports = { select, defaultSimilarity, _jaccardSets, _featureSim };
