'use strict';

// Pure hard gates, applied in severity order. The ledger windows are absolute:
// nothing served inside them can be selected, ever. Genre exclusion is
// EXACT-TOKEN (excluding "pop punk" must not kill "pop" — legacy substring bug).
// The energy ceiling is hard only when the biosonic targets are confident;
// featureless tracks are never energy-dropped (they pay a score penalty instead).

function _matchesProvider(track, provider) {
  if (!provider) return true;
  if (provider === 'spotify') {
    return track.provider === 'spotify' || String(track.uri ?? '').startsWith('spotify:');
  }
  if (provider === 'youtube') {
    return String(track.provider ?? '').startsWith('youtube');
  }
  return true;
}

function applyHardFilters(candidates = [], {
  hardExcluded = new Set(),
  moodExcluded = new Set(),
  provider = null,
  excludeGenres = [],
  energyCeiling = null,
  targetConfidence = 0,
} = {}) {
  const excludeSet = new Set(excludeGenres.map(g => String(g).toLowerCase().trim()));
  const hardEnergy = energyCeiling != null && targetConfidence >= 0.7;

  return candidates.filter((track) => {
    if (!track) return false;
    const key = track.canonicalKey;
    if (key && (hardExcluded.has(key) || moodExcluded.has(key))) return false;
    if (!_matchesProvider(track, provider)) return false;
    if ((track.genres || []).some(g => excludeSet.has(String(g).toLowerCase().trim()))) return false;
    if (hardEnergy && Number.isFinite(track.features?.energy) && track.features.energy > energyCeiling) return false;
    return true;
  });
}

module.exports = { applyHardFilters };
