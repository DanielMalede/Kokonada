const mongoose = require('mongoose');

// Per-recording embedding vectors powering MMR similarity and (on Atlas)
// $vectorSearch. v1 vectors are deterministic (features + hashed genre bag);
// a text-embedding v2 can replace them per-recording without a migration —
// `dim`/`model` describe what is stored.
//
// Atlas Vector Search index (created in Atlas UI/API, not by mongoose):
//   { "fields": [{ "type": "vector", "path": "vector", "numDimensions": 70,
//                  "similarity": "cosine" }] }
//
// W4-014 · v2 lives as a SECOND PATH ON THIS SAME DOCUMENT, not a second collection and not a
// second row. Atlas `numDimensions` is immutable per index, so the 135-dim v2 geometry needs its
// own index — but keeping it on this doc means `recordingKey` stays unique, a track's two
// representations can never drift apart into separate rows, and the read cutover is an
// index+path switch with nothing to migrate:
//   { "fields": [{ "type": "vector", "path": "vectorV2", "numDimensions": 135,
//                  "similarity": "cosine" }] }   // index `track_embedding_index_v2` (H13)
// The v2 fields are deliberately WITHOUT defaults: absent means "never built", which is what the
// backfill's resume filter (`vectorV2: {$exists:false}`) reads and what `getMany({version:'v2'})`
// treats as "no embedding". A `default: []` would make never-built indistinguishable from
// built-empty and would silently mark the whole corpus as done.
const trackEmbeddingSchema = new mongoose.Schema({
  recordingKey: { type: String, required: true, unique: true },
  canonicalKey: { type: String, default: null, index: true },
  vector:       { type: [Number], required: true },
  dim:          { type: Number, required: true },
  model:        { type: String, default: 'v1-deterministic' },
  vectorV2:     { type: [Number], default: undefined },
  dimV2:        { type: Number, default: undefined },
  modelV2:      { type: String, default: undefined },
  builtAt:      { type: Date, default: Date.now },
}, {
  timestamps: false,
});

module.exports = mongoose.model('TrackEmbedding', trackEmbeddingSchema);
