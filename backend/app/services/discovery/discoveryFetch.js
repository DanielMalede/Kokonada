// backend/app/services/discovery/discoveryFetch.js
'use strict';

const discoveryVectorService = require('./discoveryVectorService');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const mid = (r) => (Array.isArray(r) && r.length === 2 ? (num(r[0]) + num(r[1])) / 2 : num(r));

// Map the generator's aiParams to the buildVector feature space. Params carry bpm as a
// center and energy as a [min,max] band — take the center / midpoint.
function extractTargetFeatures(aiParams = {}) {
  return {
    bpm:          num(aiParams.target_bpm) ?? num(aiParams.bpmCenter),
    energy:       mid(aiParams.energy),
    valence:      num(aiParams.valence),
    acousticness: num(aiParams.acousticness),
    danceability: num(aiParams.danceability),
  };
}

// Vector-discovery replacement for the dead fetchVibeDiscovery. Exclude the user's library +
// the anti-repeat blacklist so results are genuinely undiscovered.
async function vectorDiscoveryFetch({ musicProfile = {}, aiParams = {}, blacklistCanonicalKeys = [] } = {}) {
  const exclude = new Set(blacklistCanonicalKeys || []);
  for (const t of musicProfile.library || []) if (t?.canonicalKey) exclude.add(t.canonicalKey);
  return discoveryVectorService.find({
    targetFeatures: extractTargetFeatures(aiParams),
    seedGenres: Array.isArray(aiParams.seed_genres) ? aiParams.seed_genres : [],
    excludeCanonicalKeys: exclude,
  });
}

module.exports = { vectorDiscoveryFetch, extractTargetFeatures };
