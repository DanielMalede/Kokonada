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
  // Provenance ONLY — how a row entered the anonymous corpus, NOT who owns it. 'library' = seeded
  // from a user's MusicProfile.library (the original bootstrap); 'global' = fetched by the global
  // seed-ingestion pipeline. A non-user enum, safe under ADR-0008 (still zero userId/PII); it exists
  // to manage/refresh/roll back global seeds and to weight discovery, never to link a track to a user.
  source:       { type: String, enum: ['library', 'global'], default: 'library', index: true },
}, { timestamps: { createdAt: false, updatedAt: 'updatedAt' } });

module.exports = mongoose.model('TrackCatalog', trackCatalogSchema);
