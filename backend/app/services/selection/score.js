'use strict';

const { exposurePenalty } = require('../ledger/exposureScore');
const { measured } = require('../features/featureProvider');
const { tempoKernel } = require('./tempo');

// Weighted candidate scoring.
//
// ── v2 (Wave-4 W4-007, closes D18) ────────────────────────────────────────────────────────
// Four things were structurally wrong with v1 and are fixed here:
//
//  1. UN-NORMALISED TOTALS. The mood weights summed to 0.95 and the intent weights to 1.20,
//     so the same number meant different things in the two modes and the exposure penalty
//     (a flat 0.40, outside both sums) bit ~26% harder under intent than under mood purely
//     as an artefact of the arithmetic. v2 normalises each mode to Σw = 1 (§M.9), which makes
//     `total` a comparable, bounded quantity: [−w_exposure·2, 1].
//
//  2. MIXED KERNELS. A squared-exponential on tempo, a linear tent on energy, another on
//     valence, another on acousticness — each with its own implicit, undocumented notion of
//     "how far is far". v2 is Gaussian everywhere with an EXPLICIT sigma per dim, and the
//     energy sigma is finally the band's own half-width rather than a constant: a wide band
//     should forgive what a narrow one punishes, and v1's midpoint-only tent could not.
//
//  3. ONE MEASURED DIM COULD SCORE 1.0. v1 averaged over the dims that happened to be
//     present, so a track with nothing but a tempo — dead on the centre — scored a perfect
//     feature fit and outranked a fully measured track that was merely very good. v2 gives
//     every dim the TARGET constrains a place in the average: a measured dim enters at its
//     source confidence, a missing one enters as the neutral prior 0.5 at MISSING_MASS. The
//     unknown-feature penalty is subsumed by that mechanism rather than bolted on as a flat
//     subtraction — a featureless track lands exactly at the prior, which is where "we know
//     nothing about this track" belongs: below a measured match, above a measured mismatch.
//
//  4. SOURCE CONFIDENCE WAS STORED AND DISCARDED. AudioFeature has always recorded whether a
//     value was measured (ReccoBeats), derived from CC0 mood models (AcousticBrainz) or
//     guessed by an LLM from genre tags alone — and the scorer treated all three as fact.
//     v2 weighs each dim by that provenance, so a low-confidence estimate is pulled toward
//     the prior instead of being taken as evidence either for or against a track.
//
// Tempo additionally moves to the shared octave-folded metric (`./tempo`, §M.10): half/double
// time is a known beat-tracker artefact, so 87 and 174 bpm are the same groove — EXCEPT
// against a step cadence, where footfall has no octave and the fold is charged.
//
// S11 escape hatch: `WAVE4_SCORING_V2_DISABLED` restores the entire pre-W4-007 selection
// behaviour (this scorer, MMR's similarity, and biosonicBand's null handling) with no revert
// and no restart — read per call.
//
// Spotify-ToS containment guard (ADR 0011 / 0012): the bandit posteriors that will replace
// these static env weights (W4-013) MUST NEVER be fit on Spotify-derived signals — not
// Spotify Content, not its audio features, not engagement measured against Spotify
// recordings. Fitting a model on Spotify Content would recreate the prohibited "derived
// functionality / ML ingestion" the containment removed. Today this scorer reads only static
// env weights + non-Spotify corpus features, so there is nothing to change here yet — this
// note pins the constraint for the learning tasks.

const legacyScoring = () => Boolean(process.env.WAVE4_SCORING_V2_DISABLED);

// Per-dim measurement confidence by provenance (§M.9). These are the tiers the store already
// writes: 'api' is a real measurement, 'acousticbrainz' is a CC0 analysis whose energy/
// valence/acousticness come from mood models rather than direct measurement, and 'llm' is an
// estimate from genre tags alone (capped well below 1 at the adapter).
const SOURCE_CONFIDENCE = Object.freeze({ api: 1, acousticbrainz: 0.85, llm: 0.7 });
// Weight a dim carries when the target constrains it but the track has no value for it. Not
// zero: "unmeasured" is a real state that must dilute confidence in the fit without deciding
// it. Not one: a prior is not evidence.
const MISSING_MASS = 0.3;
const MISSING_PRIOR = 0.5;

// Relative importance of each feature dim WITHIN the feature term, renormalised over the dims
// the target actually constrains. Tempo and energy carry the entrainment contract (they are
// what the biosonic band itself gates on), valence carries the mood, acousticness is a
// texture bias applied only when translate asks for one.
const DIM_WEIGHTS = Object.freeze({ bpm: 0.35, energy: 0.30, valence: 0.20, acousticness: 0.15 });

// Explicit sigmas (§M.9). Valence and acousticness are unit-interval perceptual dims where a
// quarter of the scale is a real difference. The energy sigma is derived per-call from the
// band half-width. The tempo sigma lives in ./tempo because it is in octaves, not bpm.
// Resolved once at load (the ./tempo convention) rather than per call: the scorer runs
// hundreds of times per generation and a misconfigured value must not become a NaN sigma.
const _sigma = (envVar, fallback) => {
  const v = parseFloat(process.env[envVar] ?? String(fallback));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const SIGMA_VALENCE = _sigma('SCORE_SIGMA_VALENCE', 0.25);
const SIGMA_ACOUSTIC = _sigma('SCORE_SIGMA_ACOUSTICNESS', 0.25);
// Floor for the energy sigma: a zero-width band (floor === ceiling) must not divide by zero,
// and a hair-width band must not turn the kernel into a step function.
const MIN_SIGMA_ENERGY = 0.05;

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

// v2: the same env weights, renormalised so the scoring terms sum to 1 (§M.9). Exposure is
// deliberately OUTSIDE the sum — it is a subtractive penalty on top of a [0,1] preference
// score, not one of the competing preferences.
const _SCORING_TERMS = ['taste', 'feature', 'genre', 'discovery', 'rotation'];
function _normalizeWeights(raw) {
  // A negative or NaN env weight is a misconfiguration, not an instruction to invert a term.
  const safe = {};
  let sum = 0;
  for (const key of _SCORING_TERMS) {
    const w = Number(raw[key]);
    safe[key] = Number.isFinite(w) && w > 0 ? w : 0;
    sum += safe[key];
  }
  // Every weight zeroed: fall back to feature-only rather than dividing by zero. The biosonic
  // target is the one term that must never stop working.
  if (!(sum > 0)) return { taste: 0, feature: 1, genre: 0, discovery: 0, rotation: 0, exposure: 0 };
  for (const key of _SCORING_TERMS) safe[key] /= sum;
  const exp = Number(raw.exposure);
  safe.exposure = Number.isFinite(exp) && exp > 0 ? exp : 0;
  return safe;
}
let _weightsV2 = null;
let _intentWeightsV2 = null;
const _resolveWeightsV2 = () => (_weightsV2 ??= _normalizeWeights(_resolveWeights()));
const _resolveIntentWeightsV2 = () => (_intentWeightsV2 ??= _normalizeWeights(_resolveIntentWeights()));

// Affinity percentile below which a track earns NO rotation boost (only genuine heavy rotation,
// not the long tail). Memoized like the weights — read once, not per-scored-track.
let _rotationFloor = null;
function _resolveRotationFloor() {
  return (_rotationFloor ??= parseFloat(process.env.SCORE_ROTATION_FLOOR ?? '0.5'));
}
function _resetWeights() {
  _weights = null; _intentWeights = null; _rotationFloor = null;
  _weightsV2 = null; _intentWeightsV2 = null;
}

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
// v1's numeric guard, kept verbatim for the legacy path. It cannot distinguish "absent" from
// "zero" (`Number(null) === 0`); v2 reads through `measured` instead.
const fin = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const gauss = (x, mu, sigma) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2);

// ── v1 feature fit (legacy path) ──────────────────────────────────────────────────────────
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

// ── v2 feature fit ────────────────────────────────────────────────────────────────────────

// How much this track's measurements are worth, per §M.9's source tiers. The per-doc
// `confidence` wins when present: it is the finer fact (the LLM adapter records its own
// per-estimate confidence, capped below the tier). Absent both, assume a measurement — a
// hand-built or legacy feature row is not evidence of low quality.
function _dimConfidence(features) {
  const explicit = measured(features?.confidence);
  if (explicit != null) return clamp01(explicit);
  const tier = SOURCE_CONFIDENCE[features?.source];
  return tier != null ? tier : 1;
}

/**
 * Confidence-weighted fit of a track against the dims the TARGET constrains.
 *
 * A dim the target says nothing about (e.g. acousticness when there is no acoustic bias) is
 * excluded outright — that is not missing data, it is an absence of preference, and counting
 * it as missing would dilute every track's mass identically for no information.
 *
 * @returns {{fit: number, mass: number}} fit ∈ [0,1] (the confidence-weighted mean, priors
 *          included), mass ∈ [0,1] (how much of that mean rests on real measurements).
 */
function _featureFitV2(features, targets = {}) {
  const conf = _dimConfidence(features);
  const dims = [];

  const center = measured(targets.bpmCenter);
  if (center != null && center > 0) {
    dims.push(['bpm', tempoKernel(features?.bpm, center, { cadenceLocked: targets.cadenceLocked === true })]);
  }

  const floor = measured(targets.energyFloor);
  const ceiling = measured(targets.energyCeiling);
  if (floor != null && ceiling != null) {
    const energy = measured(features?.energy);
    const mid = (floor + ceiling) / 2;
    // Sigma IS the band half-width (§M.9) — the fit finally knows how wide the request was.
    const sigma = Math.max(MIN_SIGMA_ENERGY, Math.abs(ceiling - floor) / 2);
    dims.push(['energy', energy == null ? null : gauss(energy, mid, sigma)]);
  }

  const vTarget = measured(targets.valenceTarget);
  if (vTarget != null) {
    const valence = measured(features?.valence);
    dims.push(['valence', valence == null ? null : gauss(valence, vTarget, SIGMA_VALENCE)]);
  }

  const aBias = measured(targets.acousticnessBias);
  if (aBias != null && aBias > 0) {
    const acoustic = measured(features?.acousticness);
    const mu = Math.min(1, 0.5 + aBias);
    dims.push(['acousticness', acoustic == null ? null : gauss(acoustic, mu, SIGMA_ACOUSTIC)]);
  }

  // The target constrains nothing (a bare manual tap with no biosonic reading): every track
  // fits equally well and we are certain of that, so the term carries no ranking signal
  // rather than penalising the whole pool.
  if (!dims.length) return { fit: MISSING_PRIOR, mass: 1 };

  let weightSum = 0;
  for (const [dim] of dims) weightSum += DIM_WEIGHTS[dim];

  // Each dim assigns MASS to its evidence and the remainder to ignorance, and ignorance
  // resolves to the neutral prior:  k_eff = m·k + (1−m)·0.5.
  //
  // This is the part that has to be a mixture rather than the literal product `w·c·k`. Under
  // a product, confidence is a one-way discount: it can only ever pull a track DOWN, so a
  // 0.3-confidence guess that a track is terrible condemns it exactly as hard as a measured
  // fact would (both land at ~0), while a 0.3-confidence guess that it is perfect is heavily
  // penalised. That is the wrong epistemics — low confidence means "we do not know", and not
  // knowing has to pull toward the middle in BOTH directions. A product also cancels
  // algebraically whenever every dim carries the same per-doc confidence, which is the
  // ordinary case: `Σωck / Σωc` reduces to `Σωk / Σω` and the provenance silently stops
  // mattering at all.
  //
  // A MISSING dim is the same object with its evidence set to the prior itself, so it lands
  // at 0.5 by construction; its MISSING_MASS shows up in the reported mass, which is where
  // "how much of this fit rests on measurement" honestly belongs.
  let fit = 0;
  let mass = 0;
  for (const [dim, kernel] of dims) {
    const w = DIM_WEIGHTS[dim] / weightSum;
    const present = kernel != null && Number.isFinite(kernel);
    const m = present ? conf : MISSING_MASS;
    const k = present ? clamp01(kernel) : MISSING_PRIOR;
    fit += w * (m * k + (1 - m) * MISSING_PRIOR);
    mass += w * m;
  }
  return { fit: clamp01(fit), mass: clamp01(mass) };
}

function scoreTrack(track, {
  targets = {},
  maxAffinity = 0,
  allowGenres = [],
  exposure = new Map(),
  targetMoodKey = null,
  now = Date.now(),
} = {}) {
  const legacy = legacyScoring();
  const intent = Boolean(targets.activityDriven);
  const W = legacy
    ? (intent ? _resolveIntentWeights() : _resolveWeights())
    : (intent ? _resolveIntentWeightsV2() : _resolveWeightsV2());

  const taste = maxAffinity > 0 ? clamp01((fin(track.affinity) ?? 0) / maxAffinity) : 0;

  // featureDistance is the fit; featureMass is how much of it rests on measurements.
  let featureDistance;
  let featureMass;
  let unknownFeaturePenalty;
  if (legacy) {
    const fit = _featureFit(track.features, targets);
    featureDistance = fit ?? 0.5;
    featureMass = null;
    unknownFeaturePenalty = fit == null ? W.unknown : 0;
  } else {
    const { fit, mass } = _featureFitV2(track.features, targets);
    featureDistance = fit;
    featureMass = mass;
    // DIAGNOSTIC ONLY in v2 — NOT subtracted from the total. It reports the share of the
    // feature term that rests on priors rather than measurements, which is what the flat v1
    // penalty was trying to approximate. The demotion itself is already structural: an
    // unmeasured dim enters the mean at 0.5 instead of at its (unknown) true fit.
    unknownFeaturePenalty = W.feature * (1 - mass) * fit;
  }

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
    const dance = legacy ? fin(track.features?.danceability) : measured(track.features?.danceability);
    const rhythmic = dance != null ? clamp01(dance) : 0.6;
    provenRotation = proven * rhythmic * featureDistance;
  }

  const total = legacy
    ? (
      W.taste * taste +
      W.feature * featureDistance +
      W.genre * moodGenreFit -
      W.exposure * rawExposure +
      W.rotation * provenRotation +
      discoveryBonus -
      unknownFeaturePenalty
    )
    : (
      // §M.9: Σ_d w_d·k_d over terms whose weights sum to 1, minus the exposure penalty.
      // Every k here is already in [0,1], so the total is bounded by [−w_exposure·2, 1].
      W.taste * taste +
      W.feature * featureDistance +
      W.genre * moodGenreFit +
      W.rotation * provenRotation +
      discoveryBonus -
      W.exposure * rawExposure
    );

  return {
    total: Number.isFinite(total) ? total : 0,
    terms: {
      tasteAffinity: taste,
      featureDistance,
      featureMass,
      moodGenreFit,
      exposurePenalty: rawExposure,
      discoveryBonus,
      unknownFeaturePenalty,
      provenRotation,
      scoringVersion: legacy ? 'v1' : 'v2',
    },
  };
}

module.exports = {
  scoreTrack, _resetWeights, _featureFitV2,
  SOURCE_CONFIDENCE, MISSING_MASS, MISSING_PRIOR, DIM_WEIGHTS,
};
