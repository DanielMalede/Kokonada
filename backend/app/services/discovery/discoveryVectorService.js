// backend/app/services/discovery/discoveryVectorService.js
'use strict';

const vectorIndex = require('../vector/vectorIndex');
const trackCatalogRepo = require('../../repositories/trackCatalogRepo');
const { buildTargetVector } = require('./targetVector');
const { withVectorBudget } = require('./withVectorBudget');
const mmr = require('../selection/mmr');

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Spotify-independent discovery: match the mood/target vector against our corpus, exclude
// the user's library, threshold, diversify (MMR), hydrate. ENHANCEMENT — returns [] on any
// failure and never throws into the generation path.
async function find(opts = {}) {
  const {
    targetFeatures = {}, seedGenres = [], excludeCanonicalKeys = new Set(),
    k = num(process.env.DISCOVERY_K, 30),
    overfetch = num(process.env.DISCOVERY_OVERFETCH, 6),
    minCosine = num(process.env.DISCOVERY_MIN_COSINE, 0.5),
    budgetMs = num(process.env.DISCOVERY_QUERY_BUDGET_MS, 2500),
  } = opts || {};
  try {
    const target = buildTargetVector(targetFeatures, seedGenres);
    const hits = await withVectorBudget(
      vectorIndex.queryNear(target, { k: Math.max(1, k * overfetch) }), budgetMs, []
    );
    // Threshold + exclude familiar (by canonicalKey).
    const kept = (hits || []).filter(h =>
      h && num(h.score, 0) >= minCosine && !excludeCanonicalKeys.has(h.canonicalKey));
    if (!kept.length) return [];

    // Hydrate metadata; drop unplayable (no uri).
    const meta = await trackCatalogRepo.getMany(kept.map(h => h.recordingKey));
    const candidates = [];
    for (const h of kept) {
      const m = meta.get(h.recordingKey);
      if (!m || !m.uri) continue;
      candidates.push({ track: {
        id: m.recordingKey, recordingKey: m.recordingKey, canonicalKey: m.canonicalKey,
        uri: m.uri, title: m.title, artist: m.artist, genres: m.genres || [], isDiscovery: true,
      }, total: num(h.score, 0) });
    }
    if (!candidates.length) return [];

    // MMR diversify to k (reuses the hardened selector).
    return mmr.select(candidates, { k, lambda: 0.7 }).map(s => s.track);
  } catch {
    return []; // enhancement contract: any failure → no discovery, delivery unaffected
  }
}

module.exports = { find };
