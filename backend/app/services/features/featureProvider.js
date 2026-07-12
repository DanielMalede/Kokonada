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

module.exports = { FEATURE_RANGES, clampFeatures, recordingKeyOf, spotifyIdOf };
