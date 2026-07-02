'use strict';

const { exposurePenalty } = require('../ledger/exposureScore');

// Weighted candidate scoring. Every term ∈ [0,1] (exposure capped at 2 before
// weighting); weights are env-tunable now and become bandit-sampled posteriors
// with the T7 feedback loop.

// Weights resolve from env ONCE and memoize: process.env access is a syscall-ish
// C++ hop, and the scorer runs hundreds of times per generation under load
// (shadow-audit latency finding). _resetWeights() exists for tests.
let _weights = null;
function _resolveWeights() {
  return (_weights ??= {
    taste:     parseFloat(process.env.SCORE_W_TASTE ?? '0.35'),
    feature:   parseFloat(process.env.SCORE_W_FEATURE ?? '0.30'),
    genre:     parseFloat(process.env.SCORE_W_GENRE ?? '0.20'),
    exposure:  parseFloat(process.env.SCORE_W_EXPOSURE ?? '0.40'),
    discovery: parseFloat(process.env.SCORE_W_DISCOVERY ?? '0.10'),
    unknown:   parseFloat(process.env.SCORE_W_UNKNOWN ?? '0.05'),
  });
}
function _resetWeights() { _weights = null; }

// The allow-genre Set is identical for every track in a generation — memoize per
// array reference instead of rebuilding it hundreds of times.
const _allowSets = new WeakMap();
function _allowSet(allowGenres) {
  let set = _allowSets.get(allowGenres);
  if (!set) {
    set = new Set(allowGenres.map(g => String(g).toLowerCase().trim()));
    _allowSets.set(allowGenres, set);
  }
  return set;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const fin = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

// Gaussian-ish fit of a track's measured features against the biosonic targets.
// Missing dimensions are skipped; no features at all → neutral 0.5 (the caller
// adds the unknown penalty so measured tracks still win ties).
function _featureFit(features, targets = {}) {
  if (!features) return null;
  const dims = [];

  const bpm = fin(features.bpm);
  const center = fin(targets.bpmCenter);
  if (bpm != null && center != null) {
    const width = Math.max(4, fin(targets.bpmWidth) ?? 20);
    dims.push(Math.exp(-(((bpm - center) / (2 * width)) ** 2)));
  }
  const energy = fin(features.energy);
  const floor = fin(targets.energyFloor);
  const ceiling = fin(targets.energyCeiling);
  if (energy != null && floor != null && ceiling != null) {
    const mid = (floor + ceiling) / 2;
    dims.push(clamp01(1 - Math.abs(energy - mid) * 2));
  }
  const valence = fin(features.valence);
  const vTarget = fin(targets.valenceTarget);
  if (valence != null && vTarget != null) dims.push(clamp01(1 - Math.abs(valence - vTarget)));

  const acoustic = fin(features.acousticness);
  const aBias = fin(targets.acousticnessBias);
  if (acoustic != null && aBias != null && aBias > 0) {
    dims.push(clamp01(1 - Math.abs(acoustic - Math.min(1, 0.5 + aBias))));
  }

  if (!dims.length) return null;
  return dims.reduce((a, b) => a + b, 0) / dims.length;
}

function scoreTrack(track, {
  targets = {},
  maxAffinity = 0,
  allowGenres = [],
  exposure = new Map(),
  targetMoodKey = null,
  now = Date.now(),
} = {}) {
  const W = _resolveWeights();
  const taste = maxAffinity > 0 ? clamp01((fin(track.affinity) ?? 0) / maxAffinity) : 0;

  const fit = _featureFit(track.features, targets);
  const featureDistance = fit ?? 0.5;
  const unknownFeaturePenalty = fit == null ? W.unknown : 0;

  const allow = _allowSet(allowGenres);
  const genres = (track.genres || []).map(g => String(g).toLowerCase().trim());
  const moodGenreFit = !allow.size || !genres.length
    ? 0.5
    : genres.some(g => allow.has(g)) ? 1 : 0.3;

  const serves = exposure.get(track.canonicalKey) ?? [];
  const rawExposure = serves.length
    ? Math.min(2, exposurePenalty({ serves, targetMoodKey, now }))
    : 0;

  const discoveryBonus = track.isDiscovery ? W.discovery : 0;

  const total =
    W.taste * taste +
    W.feature * featureDistance +
    W.genre * moodGenreFit -
    W.exposure * rawExposure +
    discoveryBonus -
    unknownFeaturePenalty;

  return {
    total: Number.isFinite(total) ? total : 0,
    terms: {
      tasteAffinity: taste,
      featureDistance,
      moodGenreFit,
      exposurePenalty: rawExposure,
      discoveryBonus,
      unknownFeaturePenalty,
    },
  };
}

module.exports = { scoreTrack, _resetWeights };
