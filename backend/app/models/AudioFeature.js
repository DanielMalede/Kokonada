const mongoose = require('mongoose');

// Permanent per-RECORDING audio-feature cache (never refetched). Keyed by
// recordingKey (spotify:<trackId> / youtube:<videoId>) — NOT the song-level
// canonicalKey: a live and a studio recording share a canonicalKey for the
// serve ledger but sound completely different, so features must never merge
// across recordings (shadow-audit F3 boundary ruling).
const audioFeatureSchema = new mongoose.Schema({
  recordingKey: { type: String, required: true, unique: true },
  // Song-level grouping for ledger/analytics joins — deliberately non-unique.
  canonicalKey: { type: String, default: null, index: true },
  spotifyId:    { type: String, default: null },
  isrc:         { type: String, default: null },

  bpm:          { type: Number, default: null, min: 0,   max: 300 },
  energy:       { type: Number, default: null, min: 0,   max: 1 },
  valence:      { type: Number, default: null, min: 0,   max: 1 },
  acousticness: { type: Number, default: null, min: 0,   max: 1 },
  danceability: { type: Number, default: null, min: 0,   max: 1 },
  loudness:     { type: Number, default: null, min: -60, max: 5 },

  // 'api' = measured (ReccoBeats, confidence 1.0); 'llm' = estimated (capped ≤0.7).
  // An 'llm' record may be upgraded to 'api' later, never the reverse.
  source:       { type: String, enum: ['api', 'llm'], required: true },
  confidence:   { type: Number, required: true, min: 0, max: 1 },

  // Semantic tags written by the async enrichment worker (Phase 7 critics).
  vibeTags:     { type: [String], default: [] },
  fetchedAt:    { type: Date, default: Date.now },
}, {
  timestamps: true,
});

audioFeatureSchema.index({ spotifyId: 1 }, { sparse: true });
// Re-hydration scans: find low-confidence LLM estimates to upgrade when possible.
audioFeatureSchema.index({ source: 1, confidence: 1 });

module.exports = mongoose.model('AudioFeature', audioFeatureSchema);
