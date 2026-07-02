const mongoose = require('mongoose');

// Per-recording embedding vectors powering MMR similarity and (on Atlas)
// $vectorSearch. v1 vectors are deterministic (features + hashed genre bag);
// a text-embedding v2 can replace them per-recording without a migration —
// `dim`/`model` describe what is stored.
//
// Atlas Vector Search index (created in Atlas UI/API, not by mongoose):
//   { "fields": [{ "type": "vector", "path": "vector", "numDimensions": 70,
//                  "similarity": "cosine" }] }
const trackEmbeddingSchema = new mongoose.Schema({
  recordingKey: { type: String, required: true, unique: true },
  canonicalKey: { type: String, default: null, index: true },
  vector:       { type: [Number], required: true },
  dim:          { type: Number, required: true },
  model:        { type: String, default: 'v1-deterministic' },
  builtAt:      { type: Date, default: Date.now },
}, {
  timestamps: false,
});

module.exports = mongoose.model('TrackEmbedding', trackEmbeddingSchema);
