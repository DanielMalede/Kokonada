'use strict';

// Deterministic v1 track embedding: 6 normalized audio-feature dims + a 64-dim
// hashed genre bag, L2-normalized. Cheap (zero LLM), stable, and good enough
// for MMR similarity; a text-embedding v2 slots in behind the same VectorIndex.

const { measured } = require('../features/featureProvider');
const { toLog2 } = require('../selection/tempo');
const idfStats = require('./idfStats');

const GENRE_DIMS = 64;
const DIM = 6 + GENRE_DIMS;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
// measured() (not Number.isFinite(Number(x))) — Number(null) is 0, and 0 is finite, so the
// naive guard read an unmeasured dim as "measured as zero" instead of falling back to the
// neutral fill below.
const fin = (x, fallback) => {
  const m = measured(x);
  return m === null ? fallback : m;
};

function _fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function buildVector(features, genres = []) {
  const f = features || {};
  const vec = new Array(DIM).fill(0);
  // Missing feature dims sit at the neutral midpoint so featureless tracks
  // still embed (genre bag carries them) without faking extremes.
  vec[0] = clamp01(fin(f.bpm, 130) / 260);
  vec[1] = clamp01(fin(f.energy, 0.5));
  vec[2] = clamp01(fin(f.valence, 0.5));
  vec[3] = clamp01(fin(f.acousticness, 0.5));
  vec[4] = clamp01(fin(f.danceability, 0.5));
  vec[5] = clamp01((fin(f.loudness, -27.5) + 60) / 65);

  for (const genre of genres || []) {
    const g = String(genre).toLowerCase().trim();
    if (!g) continue;
    vec[6 + (_fnv1a(g) % GENRE_DIMS)] += 1;
  }

  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map(x => x / norm);
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // inputs are L2-normalized
}

// ===========================================================================
// v2 — `v2-deterministic` (W4-014 · B3 · §M.16). Closes D19's three defects.
// ===========================================================================
//
// v1 has three structural problems, all of them consequences of ONE choice: it puts the audio
// dims and the genre bag in a single vector and L2-normalises the whole thing jointly.
//
//   (a) TAG-COUNT CRUSH. The joint norm grows with the number of genre tags, so a track's audio
//       signal SHRINKS as it gains genres. Two identical recordings, one tagged once and one
//       tagged twelve times, disagree about their own energy. (Measured in the pins: v1's energy
//       dim loses >25% of its magnitude between 1 and 12 tags.) `embedding.worker.js` has been
//       working around this since PR #139 by writing `buildVector(doc, [])` — always genre-free —
//       which fixes the crush by DELETING the genre signal. v2 keeps the signal instead.
//   (b) UNWEIGHTED BAG. Every tag contributes 1.0, so `pop` and `norwegian black metal` move a
//       vector equally. Fixed by IDF weighting (see `idfStats.js`).
//   (c) LINEAR BPM. `bpm/260` makes 87 and 174 — the SAME groove, half/double-time — maximally
//       distant. W4-007 already fixed this for scoring/MMR with the octave fold in
//       `selection/tempo.js`; the stored geometry still disagreed with it. Fixed below.
//
// THE FIX FOR (a): TWO BLOCKS, NORMALISED SEPARATELY, THEN COMPOSED.
// `[AUDIO_WEIGHT·â ; GENRE_WEIGHT·ĝ]` with each hat an independent unit vector. The audio half
// is then IDENTICAL regardless of tag count — the crush is not mitigated, it is structurally
// impossible. A genre-less track's genre block is EXACTLY zero, so `cosine` between two
// genre-less tracks reduces to their bare audio cosine: v2 is a strict superset of what the
// corpus (~98% genre-less) can express today, and re-introducing genres cannot regress it.
// 0.8/0.6 (§M.16) are a 1.0-norm pair (0.8² + 0.6² = 1) chosen so audio outweighs genre ~1.78:1
// in the dot product — genre reranks within a feature neighbourhood, it never overrides it,
// which is the same posture `discoveryVectorService`'s clamped genre-Jaccard weight takes.
//
// THE FIX FOR (c): THE TEMPO CIRCLE. `[sin(2π·log₂ bpm), cos(2π·log₂ bpm)]`. An octave is
// exactly +1 in log₂, hence exactly one full turn — so 87 and 174 bpm land on the SAME point,
// and the octave equivalence W4-007 computes at scoring time is now baked into the stored
// geometry. `toLog2` is imported from `selection/tempo.js` rather than re-derived, because that
// module exists precisely so the octave arithmetic has one home (its own header names this
// call site). The pair also contributes a CONSTANT 1.0 to the raw block norm (sin²+cos² = 1),
// so tempo's share of the audio block does not drift with the value.
//
// CENTRED DIMS — why v2 maps [0,1] to [-1,1] where v1 did not.
// Not cosmetic, and not a free choice: it is forced by the tempo pair. sin/cos are already
// centred, and their "no evidence" point is the circle's centre (0,0). A block that mixed
// centred and uncentred dims would have two different zeros and no coherent origin, so the L2
// normalisation would mean nothing. Centring gives the whole block ONE zero — and that zero is
// what lets an unmeasured dim ABSTAIN by sitting at the origin, contributing nothing to any dot
// product, instead of masquerading as a measurement (the W4-D21 defect class: v1 read an absent
// loudness as a measured value). It also fixes a measured pathology: v1 vectors live in the
// all-positive orthant, where every pair scores ~0.99 (prod evidence,
// `docs/plans/mbid-representation-recalibration-vs-genre-seam.md`) and `DISCOVERY_MIN_COSINE` is
// nearly inert. Centred, cosine spans [-1,1] and discriminates.
// CONSEQUENCE FOR THE READ CUTOVER: `DISCOVERY_MIN_COSINE` is calibrated against v1's compressed
// scale and MUST be re-tuned before `EMBEDDING_V2_READ` is switched on. Recorded in ADR-0014.
const AUDIO_DIMS = 7;
const GENRE_DIMS_V2 = 128;
const DIM_V2 = AUDIO_DIMS + GENRE_DIMS_V2;
const AUDIO_WEIGHT = 0.8;
const GENRE_WEIGHT = 0.6;
const MODEL_V2 = 'v2-deterministic';

const TWO_PI = 2 * Math.PI;

// Centred, clamped projection of a bounded feature into [-1, 1]; null (ABSTAIN) when the value
// is not a measurement. `measured()` — not Number(x) — is the trust boundary: Number(null) is 0
// and 0 is finite, which is exactly how an unknown dim became a confident extreme in v1.
function _centered(x, min, max) {
  const m = measured(x);
  if (m === null) return null;
  const unit = Math.min(1, Math.max(0, (m - min) / (max - min)));
  return 2 * unit - 1;
}

function _l2normalizeInto(out, offset, raw, scale) {
  let ss = 0;
  for (const x of raw) ss += x * x;
  if (!(ss > 0)) return false; // all-zero block stays exactly zero — no evidence, no direction
  const inv = scale / Math.sqrt(ss);
  for (let i = 0; i < raw.length; i++) out[offset + i] = raw[i] * inv;
  return true;
}

/**
 * Deterministic v2 track embedding: a 7-dim audio block and a 128-dim IDF-weighted genre block,
 * L2-normalised INDEPENDENTLY and composed as `[0.8·audio ; 0.6·genre]`.
 *
 * PURE — no clock, no I/O, no env. The IDF table is a PARAMETER (§0.4 S9); resolve it with
 * `idfStats.peek()` at the call site so a backfill can hand the same blob to every vector.
 *
 * @param {object}        features        `{bpm, energy, valence, acousticness, danceability, loudness}`
 * @param {string[]}      [genres]        genre tags; deduped case-insensitively
 * @param {{idf?: object}} [opts]         `idf` = an `idfStats` blob; absent/empty → genre block is zero
 * @returns {number[]|null} a DIM_V2 vector, or **null when there is no evidence at all** — an
 *          unmeasured, untagged track ABSTAINS rather than embedding to a confident direction
 *          (the `tempoKernel` house pattern). Callers must not store a null.
 */
function buildVectorV2(features, genres = [], { idf = null } = {}) {
  const f = features || {};
  const out = new Array(DIM_V2).fill(0);

  // --- audio block -------------------------------------------------------
  // Ranges mirror featureProvider.FEATURE_RANGES so a value clamped on write and a value
  // clamped here cannot disagree; loudness keeps v1's (x+60)/65 mapping, which is the space
  // `acousticBrainzFeatures` already re-maps its relative loudness into.
  const audio = [
    _centered(f.energy, 0, 1),
    _centered(f.valence, 0, 1),
    _centered(f.acousticness, 0, 1),
    _centered(f.danceability, 0, 1),
    _centered(f.loudness, -60, 5),
    null, // sin(2π·log₂ bpm)
    null, // cos(2π·log₂ bpm)
  ];
  // toLog2 abstains (null) for anything that is not a strictly positive finite tempo — log₂ of
  // 0 is -Infinity and of a negative is NaN, so the domain guard IS the S8 numerical guard.
  const l2 = toLog2(f.bpm);
  if (l2 !== null) {
    const theta = TWO_PI * l2;
    audio[5] = Math.sin(theta);
    audio[6] = Math.cos(theta);
  }
  const audioRaw = audio.map(x => (x === null ? 0 : x));
  const hasAudio = _l2normalizeInto(out, 0, audioRaw, AUDIO_WEIGHT);

  // --- genre block -------------------------------------------------------
  // §M.16: v[FNV(g) mod 128] += w_g, then L2-normalise the block. Deduped first, because a
  // genre is a property a document either has or lacks — listing it twice is not twice the
  // evidence, and with hashing it would silently double that bin.
  const genreRaw = new Array(GENRE_DIMS_V2).fill(0);
  const seen = new Set();
  for (const genre of genres || []) {
    const g = idfStats.normalizeGenre(genre);
    if (!g || seen.has(g)) continue;
    seen.add(g);
    const w = idfStats.weight(g, idf);
    if (!(w > 0)) continue; // no stats (or a zero weight) → contributes nothing, never a NaN
    genreRaw[_fnv1a(g) % GENRE_DIMS_V2] += w;
  }
  const hasGenre = _l2normalizeInto(out, AUDIO_DIMS, genreRaw, GENRE_WEIGHT);
  if (!hasAudio && !hasGenre) return null;

  // Final unit normalisation. When BOTH blocks are present this is a no-op by construction
  // (0.8² + 0.6² = 1), so the composition weights are untouched. It only bites when a block is
  // EMPTY — and that is precisely the case the mission calls out: a genre-less track composes to
  // norm 0.8, and without this step the raw dot between two genre-less tracks would be scaled by
  // 0.64, i.e. NOT "unchanged vs audio-only". Worse, it would be a systematic penalty: a
  // genre-less track (norm 0.8) and a genre-tagged one (norm 1.0) would have incomparable dot
  // products in a corpus that is ~98% genre-less, so annotation coverage would masquerade as
  // relevance. Renormalising makes every stored vector a unit vector — which is also what
  // `cosine()`'s "inputs are L2-normalized" contract and the Atlas cosine index assume.
  let ss = 0;
  for (const x of out) ss += x * x;
  const inv = 1 / Math.sqrt(ss);
  if (inv !== 1) for (let i = 0; i < DIM_V2; i++) out[i] *= inv;
  return out;
}

module.exports = {
  buildVector, cosine, DIM,
  buildVectorV2, DIM_V2, AUDIO_DIMS, GENRE_DIMS_V2, AUDIO_WEIGHT, GENRE_WEIGHT, MODEL_V2,
};
