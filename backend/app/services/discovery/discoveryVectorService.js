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

// Spotify-independent discovery: match the mood/target vector against our corpus, exclude
// the user's library, threshold, diversify (MMR), hydrate. ENHANCEMENT — returns [] on any
// failure and never throws into the generation path.
async function find(opts = {}) {
  const {
    targetFeatures = {}, seedGenres = [], excludeCanonicalKeys = new Set(),
    targets = null,
    k = num(process.env.DISCOVERY_K, 30),
    overfetch = num(process.env.DISCOVERY_OVERFETCH, 6),
    minCosine = num(process.env.DISCOVERY_MIN_COSINE, 0.5),
    budgetMs = num(process.env.DISCOVERY_QUERY_BUDGET_MS, 2500),
  } = opts || {};
  const t0 = Date.now();
  // Band-aware post-filter: when ON, over-fetch more (the band drops candidates) and align
  // to the SAME band the pipeline enforces so survivors are not all discarded downstream.
  const bandAware = bandAwareEnabled() && hasUsableBand(targets);
  const effOverfetch = bandAware ? num(process.env.DISCOVERY_BAND_OVERFETCH, 12) : overfetch;
  // One parseable structured metric per call, on EVERY return path. Wrapped so the metric
  // itself can NEVER throw and NEVER changes find's return value (enhancement contract).
  // banded = in-band survivors (band-aware path); -1 when the band filter did not run.
  const emit = (candidates, hits, kept, banded = -1) => {
    try {
      console.log(`[discovery] candidates=${candidates?.length ?? 0} hits=${hits?.length ?? 0} kept=${kept?.length ?? 0} banded=${banded} latencyMs=${Date.now() - t0} indexReady=${(hits?.length ?? 0) > 0}`);
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
    let banded = -1;
    if (bandAware) {
      const featureMap = await audioFeatureRepo.getMany(kept.map(h => h.recordingKey));
      survivors = kept.filter(h => withinBand({ features: featuresOf(featureMap.get(h.recordingKey)) }, targets));
      banded = survivors.length;
      if (!survivors.length) { emit([], hits, kept, banded); return []; } // starve, never widen the band
    }

    // Hydrate metadata; drop only the truly unplayable. A candidate survives when it has a
    // URI OR is translatable (has BOTH title and artist) — a YouTube-corpus track carries
    // uri:null but is resolved to a Spotify URI at serve time via search (translateToSpotify).
    const meta = await trackCatalogRepo.getMany(survivors.map(h => h.recordingKey));
    const candidates = [];
    for (const h of survivors) {
      const m = meta.get(h.recordingKey);
      if (!m) continue;
      const translatable = Boolean(m.title && m.artist); // enough to resolve to Spotify via search at serve time
      if (!m.uri && !translatable) continue;             // truly unplayable: no URI and nothing to search with
      candidates.push({ track: {
        id: m.recordingKey, recordingKey: m.recordingKey, canonicalKey: m.canonicalKey,
        uri: m.uri ?? null, title: m.title, artist: m.artist, genres: m.genres || [], isDiscovery: true,
      }, total: num(h.score, 0) });
    }
    if (!candidates.length) { emit(candidates, hits, kept, banded); return []; }

    // MMR diversify to k (reuses the hardened selector).
    const result = mmr.select(candidates, { k, lambda: 0.7 }).map(s => s.track);
    emit(candidates, hits, kept, banded);
    return result;
  } catch {
    emit([], undefined, []); // indexReady=false — a budget/throw means the index served nothing
    return []; // enhancement contract: any failure → no discovery, delivery unaffected
  }
}

module.exports = { find };
