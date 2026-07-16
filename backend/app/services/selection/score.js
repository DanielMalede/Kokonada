'use strict';

const { exposurePenalty } = require('../ledger/exposureScore');

// Weighted candidate scoring. Every term ∈ [0,1] (exposure capped at 2 before
// weighting); weights are env-tunable now and become bandit-sampled posteriors
// with the T7 feedback loop.
//
// Spotify-ToS containment guard (ADR 0011): the T7 bandit posteriors that will replace these
// static env weights MUST NEVER be fit on Spotify-derived signals (Spotify Content, its
// audio features, or engagement measured against Spotify recordings). Fitting a model on
// Spotify Content would recreate the prohibited "derived functionality / ML ingestion" the
// containment removed. Today this scorer reads only static env weights + non-Spotify corpus
// features, so there is nothing to change here yet — this note pins the constraint for T7.

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
    rotation:  parseFloat(process.env.SCORE_W_ROTATION ?? '0'), // proven-rotation boost is intent-only by default
  });
}

// Activity-driven profile: the user tapped an explicit exertion (Run/Workout), so the
// BIOSONIC TARGET must dominate the ranking — otherwise raw affinity + a stale-mood genre
// allow-list bury the very tracks that match the requested energy/tempo (the "lullaby at a
// workout" bug). featureFit becomes the largest weight; taste drops; the stale-mood genre
// term is neutralized (its allow-list came from a wheel tap the user didn't make).
let _intentWeights = null;
function _resolveIntentWeights() {
  return (_intentWeights ??= {
    taste:     parseFloat(process.env.SCORE_INTENT_W_TASTE ?? '0.10'),
    feature:   parseFloat(process.env.SCORE_INTENT_W_FEATURE ?? '0.60'),
    genre:     parseFloat(process.env.SCORE_INTENT_W_GENRE ?? '0'),
    exposure:  parseFloat(process.env.SCORE_INTENT_W_EXPOSURE ?? '0.40'),
    discovery: parseFloat(process.env.SCORE_INTENT_W_DISCOVERY ?? '0.10'),
    unknown:   parseFloat(process.env.SCORE_INTENT_W_UNKNOWN ?? '0.05'),
    // Proven RHYTHMIC rotation boost: lift tracks the user actually plays (heavy rotation) that
    // ALSO fit the requested band. Post-gate (the band already guarantees energy/tempo), so it
    // can never reintroduce a wrong track — it only reorders the survivors toward personal proof.
    rotation:  parseFloat(process.env.SCORE_INTENT_W_ROTATION ?? '0.40'),
  });
}
// Affinity percentile below which a track earns NO rotation boost (only genuine heavy rotation,
// not the long tail). Memoized like the weights — read once, not per-scored-track.
let _rotationFloor = null;
function _resolveRotationFloor() {
  return (_rotationFloor ??= parseFloat(process.env.SCORE_ROTATION_FLOOR ?? '0.5'));
}
function _resetWeights() { _weights = null; _intentWeights = null; _rotationFloor = null; }

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
  const W = targets.activityDriven ? _resolveIntentWeights() : _resolveWeights();
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

  // Proven rhythmic rotation: proven ∈ [0,1] rewards only above-floor affinity (heavy rotation,
  // not the tail); ×danceability makes it a RHYTHMIC boost; ×featureDistance scopes it to tracks
  // that fit the band (a proven-but-off-target track can't hijack the ranking). Weight is 0 in
  // mood mode, so this whole term vanishes there.
  let provenRotation = 0;
  if (W.rotation > 0 && maxAffinity > 0) {
    const floor = _resolveRotationFloor();
    const proven = clamp01(((fin(track.affinity) ?? 0) / maxAffinity - floor) / Math.max(1e-6, 1 - floor));
    const dance = fin(track.features?.danceability);
    const rhythmic = dance != null ? clamp01(dance) : 0.6;
    provenRotation = proven * rhythmic * featureDistance;
  }

  const total =
    W.taste * taste +
    W.feature * featureDistance +
    W.genre * moodGenreFit -
    W.exposure * rawExposure +
    W.rotation * provenRotation +
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
      provenRotation,
    },
  };
}

module.exports = { scoreTrack, _resetWeights };
