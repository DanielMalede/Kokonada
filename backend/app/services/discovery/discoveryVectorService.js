// backend/app/services/discovery/discoveryVectorService.js
'use strict';

const vectorIndex = require('../vector/vectorIndex');
const trackCatalogRepo = require('../../repositories/trackCatalogRepo');
const audioFeatureRepo = require('../../repositories/audioFeatureRepo');
const { buildTargetVector } = require('./targetVector');
const { withVectorBudget } = require('./withVectorBudget');
const { withinBand } = require('../selection/biosonicBand');
const { featuresOf } = require('../features/featureProvider');
const mmr = require('../selection/mmr');

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const fin = (v) => Number.isFinite(Number(v));

// DISCOVERY_BAND_OVERFETCH env footgun clamp (resilience audit L1/L2). num() alone lets
// Number("")/"0"/negative through as < 2 → queryNear(k·~0) → 1 candidate (worse than the
// no-band default 6); and an unbounded value blows numCandidates (= k·overfetch·10 in the
// Atlas adapter) past Atlas's 10 000 cap → the aggregate throws → discovery silently OFF.
// FLOOR: anything not a finite number >= 2 → the default 12. CEILING: 16, because with the
// adapter's numCandidates = k·10 and discovery k <= 50, 16·50·10 = 8 000 stays well within
// the 10 000 cap (at the operational k=30 it is 4 800). (16 not 40: 40 already blows the
// cap at k>=25 — a "max" that reproduces the very bug this guards.)
const BAND_OVERFETCH_DEFAULT = 12;
const BAND_OVERFETCH_MIN = 2;
const BAND_OVERFETCH_MAX = 16;
function bandOverfetch() {
  const raw = Number(process.env.DISCOVERY_BAND_OVERFETCH);
  if (!Number.isFinite(raw) || raw < BAND_OVERFETCH_MIN) return BAND_OVERFETCH_DEFAULT;
  return Math.min(BAND_OVERFETCH_MAX, raw);
}

// DISCOVERY_MIN_COSINE floor parse (same env-footgun class as bandOverfetch): a BLANK or
// non-finite value falls back to the default rather than Number('')===0 silently DISABLING the
// floor; an explicit '0' is honored (opt-out). Clamped to [0,1]. Only the env DEFAULT flows
// through here — an explicit opts.minCosine still wins via destructuring.
function minCosineDefault(d = 0.3) {
  const raw = process.env.DISCOVERY_MIN_COSINE;
  if (raw === undefined || String(raw).trim() === '') return d;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
}

// Band-aware only fires when the flag is ON at call time AND the targets object carries
// a gate withinBand actually applies — a bpm window (center + width, or an activity-wide
// window), an energy floor/ceiling, or a texture-intent class. Anything else → no-op guard.
const bandAwareEnabled = () => process.env.DISCOVERY_BAND_AWARE === 'true';
function hasUsableBand(t) {
  if (!t || typeof t !== 'object') return false;
  const bpm = fin(t.bpmCenter) && (t.activityDriven === true || fin(t.bpmWidth));
  const energy = fin(t.energyFloor) && fin(t.energyCeiling);
  const texture = t.activityIntensity === 'high' || t.activityIntensity === 'low';
  return bpm || energy || texture;
}

// featuresOf (the shared feature projection discovery and the pipeline both judge the band
// on) lives in featureProvider so the two can never drift — resilience audit M1.

// DORMANT genre-relevance seam. The stored/searched vector is now ALWAYS genre-free (the
// embedding.worker.js dilution fix), so genre relevance is a SEPARATE, EXPLICIT term — reusing
// mmr.js's proven Jaccard blend pattern, not a second embedding/Atlas index. Small, env-tunable
// weight (footgun-clamped to [0,1], same class of guard as bandOverfetch/minCosineDefault).
const GENRE_WEIGHT_DEFAULT = 0.15;
function genreWeight() {
  const raw = Number(process.env.DISCOVERY_GENRE_WEIGHT);
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : GENRE_WEIGHT_DEFAULT;
}

// Blends a feature cosine with an OPTIONAL genre-Jaccard boost. Dormancy invariant: when
// queryGenreSet is empty (every current caller — no one passes `queryGenres` to find() yet),
// this returns featureCosine UNCHANGED, byte-identical to pre-seam behavior. Exported for direct
// unit testing of the blend math (ranking-order tests alone can't pin exact values).
function _scoreTotal(featureCosine, candidateGenres, queryGenreSet) {
  if (!queryGenreSet || !queryGenreSet.size) return featureCosine;
  const candidateSet = new Set((candidateGenres || []).map(g => String(g).toLowerCase()));
  return featureCosine + genreWeight() * mmr._jaccardSets(queryGenreSet, candidateSet);
}

// Spotify-independent discovery: match the mood/target vector against our corpus, exclude
// the user's library, threshold, diversify (MMR), hydrate. ENHANCEMENT — returns [] on any
// failure and never throws into the generation path.
async function find(opts = {}) {
  const {
    targetFeatures = {}, seedGenres = [], excludeCanonicalKeys = new Set(),
    targets = null,
    queryGenres = [], // dormant genre-relevance seam — no current caller passes this (see _scoreTotal)
    k = num(process.env.DISCOVERY_K, 30),
    overfetch = num(process.env.DISCOVERY_OVERFETCH, 6),
    // Low FLOOR guard, not the primary gate. The starvation root cause was the genre-seeded
    // target (fixed in discoveryFetch), not this value — with a feature-only target the corpus
    // cosines cluster ~0.99, so this only rejects genuinely near-orthogonal hits; the
    // un-relaxable biosonic band (withinBand) + MMR + exclude-library are the real quality gates.
    // Lowered 0.5 → 0.3 purely to remove a stale genre-era floor; band-aware carries mood.
    minCosine = minCosineDefault(),
    budgetMs = num(process.env.DISCOVERY_QUERY_BUDGET_MS, 2500),
  } = opts || {};
  const t0 = Date.now();
  // Band-aware post-filter: when ON, over-fetch more (the band drops candidates) and align
  // to the SAME band the pipeline enforces so survivors are not all discarded downstream.
  const bandAware = bandAwareEnabled() && hasUsableBand(targets);
  const effOverfetch = bandAware ? bandOverfetch() : overfetch;
  // One parseable structured metric per call, on EVERY return path. Wrapped so the metric
  // itself can NEVER throw and NEVER changes find's return value (enhancement contract).
  // bandKept = in-band survivors (band-aware path); -1 when the band filter did not run.
  // NAMED bandKept (not banded) so it never conflates with the pipeline's [selection.v2]
  // banded= (pool tracks passing the band) — two different numbers on two different lines.
  const emit = (candidates, hits, kept, bandKept = -1) => {
    try {
      console.log(`[discovery] candidates=${candidates?.length ?? 0} hits=${hits?.length ?? 0} kept=${kept?.length ?? 0} bandKept=${bandKept} latencyMs=${Date.now() - t0} indexReady=${(hits?.length ?? 0) > 0}`);
    } catch { /* metric must never affect delivery */ }
  };
  try {
    const target = buildTargetVector(targetFeatures, seedGenres);
    const hits = await withVectorBudget(
      vectorIndex.queryNear(target, { k: Math.max(1, k * effOverfetch) }), budgetMs, []
    );
    // Threshold + exclude familiar (by canonicalKey).
    const kept = (hits || []).filter(h =>
      h && num(h.score, 0) >= minCosine && !excludeCanonicalKeys.has(h.canonicalKey));
    if (!kept.length) { emit([], hits, kept); return []; }

    // Band post-filter (flag ON + usable band). ONE feature batch for the kept candidates,
    // then drop anything the pipeline's un-relaxable band would drop — withinBand VERBATIM,
    // on the pipeline's feature shape. Featureless candidates (no doc) pass, exactly as
    // withinBand/filterBand treat them. Hydrating ONLY survivors cuts catalog reads vs today.
    let survivors = kept;
    let bandKept = -1;
    if (bandAware) {
      const featureMap = await audioFeatureRepo.getMany(kept.map(h => h.recordingKey));
      survivors = kept.filter(h => withinBand({ features: featuresOf(featureMap.get(h.recordingKey)) }, targets));
      bandKept = survivors.length;
      if (!survivors.length) { emit([], hits, kept, bandKept); return []; } // starve, never widen the band
    }

    // Hydrate metadata; drop only the truly unplayable. A candidate survives when it has a
    // URI OR is translatable (has BOTH title and artist) — a YouTube-corpus track carries
    // uri:null but is resolved to a Spotify URI at serve time via search (translateToSpotify).
    // ACCEPTED (audit): the feature getMany above + this catalog getMany are single indexed $in batches (not N+1), bounded by the outer AI_BUDGET_MS, not this call's budgetMs.
    const meta = await trackCatalogRepo.getMany(survivors.map(h => h.recordingKey));
    const queryGenreSet = new Set((Array.isArray(queryGenres) ? queryGenres : []).map(g => String(g).toLowerCase()));
    const candidates = [];
    for (const h of survivors) {
      const m = meta.get(h.recordingKey);
      if (!m) continue;
      const translatable = Boolean(m.title && m.artist); // enough to resolve to Spotify via search at serve time
      if (!m.uri && !translatable) continue;             // truly unplayable: no URI and nothing to search with
      candidates.push({ track: {
        id: m.recordingKey, recordingKey: m.recordingKey, canonicalKey: m.canonicalKey,
        uri: m.uri ?? null, title: m.title, artist: m.artist, genres: m.genres || [], isDiscovery: true,
      }, total: _scoreTotal(num(h.score, 0), m.genres, queryGenreSet) });
    }
    if (!candidates.length) { emit(candidates, hits, kept, bandKept); return []; }

    // MMR diversify to k (reuses the hardened selector).
    const result = mmr.select(candidates, { k, lambda: 0.7 }).map(s => s.track);
    emit(candidates, hits, kept, bandKept);
    return result;
  } catch {
    emit([], undefined, []); // indexReady=false — a budget/throw means the index served nothing
    return []; // enhancement contract: any failure → no discovery, delivery unaffected
  }
}

module.exports = { find, _scoreTotal };
