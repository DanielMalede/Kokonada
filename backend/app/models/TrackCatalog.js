// backend/app/models/TrackCatalog.js
const mongoose = require('mongoose');

// Anonymous global track-metadata catalog: hydrates $vectorSearch hits into playable
// discovery candidates and supplies genres to the embedding. ZERO-KNOWLEDGE — keyed only
// by track identity (recordingKey/canonicalKey); it stores NO userId/profileId and no
// user→track linkage. A track-identity catalog, never a preference graph. Like the other
// global feature caches, it is intentionally outside user erasure (cf. ADR 0008).
const trackCatalogSchema = new mongoose.Schema({
  recordingKey: { type: String, required: true, unique: true },
  canonicalKey: { type: String, default: null, index: true },
  uri:          { type: String, default: null },
  title:        { type: String, default: null },
  artist:       { type: String, default: null },
  genres:       { type: [String], default: [] },
}, { timestamps: { createdAt: false, updatedAt: 'updatedAt' } });

module.exports = mongoose.model('TrackCatalog', trackCatalogSchema);
