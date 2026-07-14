// backend/app/services/discovery/discoveryFetch.js
'use strict';

const discoveryVectorService = require('./discoveryVectorService');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const mid = (r) => (Array.isArray(r) && r.length === 2 ? (num(r[0]) + num(r[1])) / 2 : num(r));

// Feature-only discovery target (default ON; opt out with DISCOVERY_FEATURE_ONLY_TARGET=false).
// The corpus embeddings are ~98% genre-less (source tracks — esp. YouTube library — carry no
// genre metadata, so buildVector fills only the 6 audio-feature dims). A genre-seeded target
// puts most of its unit-norm in the 64-dim genre bag, which is ORTHOGONAL to the genre-less
// corpus → raw cosine collapses just under DISCOVERY_MIN_COSINE and discovery starves. Until the
// corpus carries real genres (cross-provider ingestion), match on audio features only.
// FULL legacy rollback needs BOTH DISCOVERY_FEATURE_ONLY_TARGET=false AND DISCOVERY_MIN_COSINE=0.5
// — the flag alone restores genre-seeded targets but the retuned 0.3 floor would then admit the
// ~0.48 genre-orthogonal collapsed hits the old 0.5 floor rejected.
const featureOnlyTarget = () => process.env.DISCOVERY_FEATURE_ONLY_TARGET !== 'false';

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

// Recall aid ONLY: when the biosonic band is known, re-centre the QUERY vector on the band
// so the over-fetch surfaces genuinely in-band candidates (the hard cut is still withinBand
// downstream). Leaves the no-targets path — and extractTargetFeatures — byte-identical.
function biasToBand(base, targets) {
  if (!targets || typeof targets !== 'object') return base;
  const center = num(targets.bpmCenter);
  const floor = num(targets.energyFloor);
  const ceil = num(targets.energyCeiling);
  const energy = (floor !== undefined && ceil !== undefined) ? (floor + ceil) / 2 : undefined;
  return {
    ...base,
    bpm:          center ?? base.bpm,
    energy:       energy ?? base.energy,
    valence:      num(targets.valenceTarget) ?? base.valence,
    acousticness: num(targets.acousticnessBias) ?? base.acousticness,
  };
}

// Vector-discovery replacement for the dead fetchVibeDiscovery. Exclude the user's library +
// the anti-repeat blacklist so results are genuinely undiscovered. When band-aware discovery
// is active the caller threads the SAME biosonic targets the pipeline enforces, so the
// service can post-filter candidates to the un-relaxable band before they are all dropped.
async function vectorDiscoveryFetch({ musicProfile = {}, aiParams = {}, blacklistCanonicalKeys = [], targets = null } = {}) {
  const exclude = new Set(blacklistCanonicalKeys || []);
  for (const t of musicProfile.library || []) if (t?.canonicalKey) exclude.add(t.canonicalKey);
  return discoveryVectorService.find({
    targetFeatures: biasToBand(extractTargetFeatures(aiParams), targets),
    seedGenres: featureOnlyTarget() ? [] : (Array.isArray(aiParams.seed_genres) ? aiParams.seed_genres : []),
    excludeCanonicalKeys: exclude,
    targets: targets ?? null,
  });
}

module.exports = { vectorDiscoveryFetch, extractTargetFeatures };
