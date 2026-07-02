'use strict';

// Maximal Marginal Relevance: greedy selection balancing score against
// similarity to what's already picked — guaranteed intra-playlist variety.
// Similarity v1 (embeddings land in Phase 7): same-artist dominates (an
// artist monoculture is the worst perceived repetition), then measured
// feature distance, then genre Jaccard as the weakest signal.

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

function _featureSim(fa, fb) {
  if (!fa || !fb) return null;
  const dims = [];
  if (Number.isFinite(fa.bpm) && Number.isFinite(fb.bpm)) dims.push(1 - Math.min(1, Math.abs(fa.bpm - fb.bpm) / 130));
  if (Number.isFinite(fa.energy) && Number.isFinite(fb.energy)) dims.push(1 - Math.abs(fa.energy - fb.energy));
  if (Number.isFinite(fa.valence) && Number.isFinite(fb.valence)) dims.push(1 - Math.abs(fa.valence - fb.valence));
  if (!dims.length) return null;
  return dims.reduce((s, d) => s + d, 0) / dims.length;
}

function defaultSimilarity(a, b) {
  const artistA = String(a.artist ?? '').toLowerCase().trim();
  const artistB = String(b.artist ?? '').toLowerCase().trim();
  if (artistA && artistA === artistB) return 1;

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

module.exports = { select, defaultSimilarity };
