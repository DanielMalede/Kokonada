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
function featuresOf(doc) {
  return doc
    ? { bpm: doc.bpm, energy: doc.energy, valence: doc.valence, acousticness: doc.acousticness, danceability: doc.danceability }
    : null;
}

module.exports = { FEATURE_RANGES, clampFeatures, recordingKeyOf, featuresOf, spotifyIdOf };
