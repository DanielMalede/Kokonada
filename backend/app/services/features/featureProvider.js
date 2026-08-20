'use strict';

// FeatureProvider port. An adapter implements:
//   supports(track) → boolean
//   getFeatures(tracks) → Promise<[{ track, recordingKey, features|null, source, confidence }]>
// Adapters NEVER throw out of getFeatures — a failed lookup is features:null.
// The shared helpers below are the store's trust boundary: every feature value,
// measured or LLM-estimated, passes through clampFeatures before persistence.

const FEATURE_RANGES = Object.freeze({
  bpm:          [30, 260],
  energy:       [0, 1],
  valence:      [0, 1],
  acousticness: [0, 1],
  danceability: [0, 1],
  loudness:     [-60, 5],
});

// Only whitelisted fields survive; numeric strings coerce; NaN/Infinity/junk → null;
// finite values clamp into their legal window. Returns null when nothing usable remains.
function clampFeatures(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  let usable = false;
  for (const [field, [min, max]] of Object.entries(FEATURE_RANGES)) {
    const num = Number(raw[field]);
    if (raw[field] == null || !Number.isFinite(num)) {
      out[field] = null;
    } else {
      out[field] = Math.min(max, Math.max(min, num));
      usable = true;
    }
  }
  return usable ? out : null;
}

// The ONE predicate for "is this feature value a measurement?" — the read-side twin of
// clampFeatures, which is the write-side trust boundary.
//
// `Number(null)`, `Number('')`, `Number(false)` and `Number([])` are all 0, and 0 is finite,
// so the idiom this replaces (`Number.isFinite(Number(x)) ? Number(x) : null`) could not tell
// "not measured" from "measured as zero". Every unmeasured AudioFeature dim is stored as
// `null` by schema default — the adapters deliberately leave dims they cannot measure null
// rather than fabricating them — so that coercion turned an unknown tempo into a tempo of
// 0 bpm. `biosonicBand` then dropped the track for being outside every possible band, and
// the band is un-relaxable: a track with energy measured but tempo missing was excluded
// where a track with NO features at all passed. (W4-007; same coercion class as W4-D15,
// whose fix `translate`, `baselineEngine` and `chronobiology` already carry.)
//
// A value counts as measured only if it is a finite number, or a non-blank string that
// parses to one (numeric strings arrive from JSON payloads and are real data).
function measured(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function spotifyIdOf(track) {
  if (!track) return null;
  if (track.provider === 'spotify' && track.id) return track.id;
  if (typeof track.uri === 'string' && track.uri.startsWith('spotify:track:')) {
    return track.uri.slice('spotify:track:'.length) || null;
  }
  return track.spotifyId ?? null;
}

// Per-recording identity: features are keyed by the concrete recording, never the
// song-level canonicalKey (live vs studio must not share features — audit F3).
function recordingKeyOf(track) {
  if (typeof track?.recordingKey === 'string' && track.recordingKey) return track.recordingKey;
  const spotifyId = spotifyIdOf(track);
  if (spotifyId) return `spotify:${spotifyId}`;
  if (track?.id && String(track?.provider ?? '').startsWith('youtube')) return `youtube:${track.id}`;
  if (track?.id && track?.provider) return `${track.provider}:${track.id}`;
  return null;
}

// The ONE slim feature projection the selection pipeline and the band post-filter judge a
// track on. Discovery and the pipeline MUST build candidate features through this single
// helper so they agree on which tracks are in-band (no divergent projection — resilience
// audit M1). null for an absent doc, matching withinBand's featureless-passes semantics.
//
// W4-007 (D18): the projection now carries the doc's measurement PROVENANCE alongside the
// values. The store has always recorded `source` + `confidence` — a ReccoBeats measurement
// and an LLM's guess from genre tags alone are not the same evidence — and the selection
// path has always thrown that away at exactly this line, so the scorer treated a 0.3-
// confidence hallucination and a measured value as interchangeable. Provenance travels WITH
// the values because they are one fact about one recording; a parallel side-channel would
// drift the moment a consumer forgot to thread it through.
//
// Deliberately still NOT here: `loudness` (no target constrains it and no consumer judges
// it), `vibeTags`, and every identity/audit field. This stays the narrow contract it is.
function featuresOf(doc) {
  return doc
    ? {
        bpm: doc.bpm, energy: doc.energy, valence: doc.valence,
        acousticness: doc.acousticness, danceability: doc.danceability,
        source: doc.source, confidence: doc.confidence,
      }
    : null;
}

module.exports = { FEATURE_RANGES, clampFeatures, recordingKeyOf, featuresOf, spotifyIdOf, measured };
