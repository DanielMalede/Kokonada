const mongoose = require('mongoose');
const { SERVE_EVENT_TTL_SECONDS } = require('../config/retention');

// Durable serve ledger: one row per (user, track, generation). The Redis ZSET
// hot windows are rebuilt from this collection on cache miss. A row names a provider
// recording, so it is provider track data (HX-2): the daily sessionTrim job deletes it
// at 29 days and the TTL index below (30 days) is the backstop. Changing this TTL on an
// existing deployment needs a collMod — Mongoose will not alter an existing index's
// options (see TTL_INDEX_RUNBOOKS in scripts/verifyProdRunbooks.js).
//
// bioState deliberately stores only COARSE bands (tempo band + activity class),
// never raw heart rate — vitals live encrypted in BiometricLog; the ledger only
// needs enough context for mood-proximity scoring (zero-knowledge posture).
const serveEventSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  canonicalKey: { type: String, required: true },
  moodKey:      { type: String, default: null }, // preset (focus/…) or synthetic bio:<band>:<activity>
  bioState: {
    tempoBand: { type: String, default: null },  // resting | active | peak
    activity:  { type: String, default: null },
  },
  sessionId:    { type: String, default: null },
  servedAt:     { type: Date, required: true },
}, {
  timestamps: false,
});

serveEventSchema.index({ userId: 1, servedAt: -1 });
serveEventSchema.index({ userId: 1, canonicalKey: 1, servedAt: -1 });
serveEventSchema.index({ servedAt: 1 }, { expireAfterSeconds: SERVE_EVENT_TTL_SECONDS });

module.exports = mongoose.model('ServeEvent', serveEventSchema);
