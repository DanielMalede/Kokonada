'use strict';

const FAMILIAR_RATIO  = 0.7;
const TIGHT_BPM_DELTA   = 15;
const TIGHT_ENERGY_DELTA  = 0.2;
const RELAXED_BPM_DELTA   = 30;
const RELAXED_ENERGY_DELTA  = 0.35;

// ── Pure helpers ───────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Selects up to `familiarTarget` tracks from the library that best match the
 * AI-computed audio targets. Uses three tiers of BPM/energy tolerance,
 * falling through to broader matches if tight matches are insufficient.
 *
 * Only Spotify tracks (non-null tempo) are eligible — YouTube tracks in the
 * library lack audio features needed for BPM/energy matching.
 *
 * @param {{ id, tempo, energy, provider }[]} library
 * @param {{ target_bpm, target_energy }} aiParams
 * @param {number} familiarTarget
 * @returns {object[]}
 */
function _selectFamiliarTracks(library, aiParams, familiarTarget) {
  const { target_bpm, target_energy } = aiParams;

  // Only tracks with measured audio features qualify
  const candidates = library.filter(t => t.tempo != null && t.energy != null);

  if (!candidates.length) return [];

  // Tier 1 — tight match
  const tight = candidates.filter(t =>
    Math.abs(t.tempo  - target_bpm)    <= TIGHT_BPM_DELTA &&
    Math.abs(t.energy - target_energy) <= TIGHT_ENERGY_DELTA
  );
  if (tight.length >= familiarTarget) {
    return shuffle(tight).slice(0, familiarTarget);
  }

  // Tier 2 — relaxed match
  const relaxed = candidates.filter(t =>
    Math.abs(t.tempo  - target_bpm)    <= RELAXED_BPM_DELTA &&
    Math.abs(t.energy - target_energy) <= RELAXED_ENERGY_DELTA
  );
  if (relaxed.length >= familiarTarget) {
    return shuffle(relaxed).slice(0, familiarTarget);
  }

  // Tier 3 — broadest: all candidates sorted by BPM proximity
  if (relaxed.length > 0) {
    const sorted = [...candidates].sort(
      (a, b) => Math.abs(a.tempo - target_bpm) - Math.abs(b.tempo - target_bpm)
    );
    return sorted.slice(0, familiarTarget);
  }

  // Fallback: return whatever we have (shouldn't happen given tier-3 logic above,
  // but keeps the function safe against empty relaxed sets)
  const sorted = [...candidates].sort(
    (a, b) => Math.abs(a.tempo - target_bpm) - Math.abs(b.tempo - target_bpm)
  );
  return sorted.slice(0, familiarTarget);
}

/**
 * Interleaves familiar and discovery tracks in a 2:1 pattern:
 *   [f, f, d, f, f, d, ...]
 * Appends any remaining tracks from either list once the other is exhausted.
 *
 * @param {object[]} familiar
 * @param {object[]} discovery
 * @returns {object[]}
 */
function _mergeNatural(familiar, discovery) {
  const merged = [];
  let fi = 0;
  let di = 0;
  let slot = 0; // 0,1 → familiar; 2 → discovery (cycles of 3)

  while (fi < familiar.length || di < discovery.length) {
    if (slot < 2 && fi < familiar.length) {
      merged.push(familiar[fi++]);
    } else if (slot === 2 && di < discovery.length) {
      merged.push(discovery[di++]);
    } else if (fi < familiar.length) {
      merged.push(familiar[fi++]);
    } else {
      merged.push(discovery[di++]);
    }
    slot = (slot + 1) % 3;
  }

  return merged;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Builds a playlist using the 70/30 familiar/discovery split.
 *
 * @param {{
 *   musicProfile:         { library: object[] },
 *   aiParams:             { target_bpm, target_energy, target_valence, target_acousticness, seed_genres },
 *   fetchDiscoveryTracks: (params: object) => Promise<object[]>,
 *   playlistSize?:        number,
 * }} opts
 * @returns {Promise<{ familiar: object[], discovery: object[], merged: object[] }>}
 */
async function mixPlaylist({ musicProfile, aiParams, fetchDiscoveryTracks, playlistSize = 20 }) {
  const familiarTarget  = Math.round(playlistSize * FAMILIAR_RATIO);
  const discoveryTarget = playlistSize - familiarTarget;

  const familiar  = _selectFamiliarTracks(musicProfile.library || [], aiParams, familiarTarget);
  const rawDiscovery = await fetchDiscoveryTracks(aiParams);
  const discovery = rawDiscovery.slice(0, discoveryTarget);

  const merged = _mergeNatural(familiar, discovery);

  return { familiar, discovery, merged };
}

module.exports = { mixPlaylist, _selectFamiliarTracks, _mergeNatural };
