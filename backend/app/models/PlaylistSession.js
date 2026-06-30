const mongoose = require('mongoose');
const { encryptedString, encryptedNumber } = require('./encryptedField');

// A single AI-generated playlist session.
const emotionTapSchema = new mongoose.Schema({
  x: { type: Number, required: true, min: -1, max: 1 }, // normalized emotion space
  y: { type: Number, required: true, min: -1, max: 1 },
}, { _id: false });

const playlistSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Emotion input (multi-tap: 2-3 points)
  emotionTaps:   { type: [emotionTapSchema], required: true, validate: v => v.length >= 1 && v.length <= 3 },
  // User free-text — the most re-identifying field; encrypted at rest. (audit F3)
  contextPrompt: encryptedString({ default: '' }),

  // Biometric snapshot at session creation (no raw logs — just summary values).
  // heartRate is special-category health data — encrypted at rest. (audit F3)
  biometricSnapshot: {
    heartRate: encryptedNumber({ default: null }),
    activity:  { type: String, default: null },
  },

  // Resolved mood preset for this generation (focus/calm/intense/…), null on the HR
  // branch. Drives the per-mood "Affinity Trap Breaker": detecting a repeated mood and
  // blacklisting tracks already served under that same mood. Indexed below.
  moodKey: { type: String, default: null },

  // AI-derived music parameters
  targetBpm:    { type: Number, default: null },
  targetGenres: { type: [String], default: [] },
  targetValence:{ type: Number, default: null, min: 0, max: 1 },
  targetEnergy: { type: Number, default: null, min: 0, max: 1 },

  // Playlist output
  musicProvider: { type: String, enum: ['spotify', 'youtube'], required: true },
  externalPlaylistId: { type: String, default: null },
  trackIds: { type: [String], default: [] },

  // Feedback signals
  skipCount:    { type: Number, default: 0 },
  recalibrated: { type: Boolean, default: false },

  // Redis cache key used to avoid redundant LLM calls
  llmCacheKey: { type: String, default: null },

  // Fallback flag: true if AI timed out and a static playlist was used
  isFallback: { type: Boolean, default: false },
}, {
  timestamps: true,
  toJSON:   { getters: true },
  toObject: { getters: true },
});

playlistSessionSchema.index({ userId: 1, createdAt: -1 });
// Per-mood repeat detection + 24h blacklist query (find by user+mood within a window).
playlistSessionSchema.index({ userId: 1, moodKey: 1, createdAt: -1 });
playlistSessionSchema.index({ llmCacheKey: 1 });

module.exports = mongoose.model('PlaylistSession', playlistSessionSchema);
