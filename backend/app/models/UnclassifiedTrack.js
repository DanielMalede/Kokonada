const mongoose = require('mongoose');
const { UNCLASSIFIED_TTL_SECONDS } = require('../config/retention');

// Tracks awaiting a music/non-music verdict because Groq was unavailable when they were
// classified (safety floor, §D4). A periodic worker (reclassify.worker) re-evaluates due
// rows and either PROMOTES them into the user's music profile or HARD-DELETES them — they
// never sit in `library` unverified. One row per (userId, track.id).
const unclassifiedTrackSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The full MusicProfile.library entry payload, kept verbatim so promotion is a copy.
  track:         { type: mongoose.Schema.Types.Mixed, required: true },
  reason:        { type: String, default: null },   // 'ingest' | 'purge'
  attempts:      { type: Number, default: 0 },
  createdAt:     { type: Date, default: Date.now },
  lastAttemptAt: { type: Date, default: null },
  // When the reclassify worker should next try this row (backoff on repeated outage).
  nextAttemptAt: { type: Date, default: Date.now },
});

unclassifiedTrackSchema.index({ userId: 1, 'track.id': 1 }, { unique: true });
unclassifiedTrackSchema.index({ nextAttemptAt: 1 });
// HX-2 M3: provider track payloads never outlive 29 days waiting for a verdict. The daily sessionTrim
// job deletes them first and backfills createdAt on legacy rows; this TTL is the backstop.
unclassifiedTrackSchema.index({ createdAt: 1 }, { expireAfterSeconds: UNCLASSIFIED_TTL_SECONDS });

module.exports = mongoose.model('UnclassifiedTrack', unclassifiedTrackSchema);
