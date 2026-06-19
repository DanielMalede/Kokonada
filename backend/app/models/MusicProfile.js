const mongoose = require('mongoose');

// Baseline musical DNA derived from listening history analysis.
// One document per user, upserted on each re-analysis.
const musicProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Spotify/YouTube audio feature baselines (0-1 scale)
  acousticness:  { type: Number, default: null, min: 0, max: 1 },
  danceability:  { type: Number, default: null, min: 0, max: 1 },
  energy:        { type: Number, default: null, min: 0, max: 1 },
  valence:       { type: Number, default: null, min: 0, max: 1 },
  instrumentalness: { type: Number, default: null, min: 0, max: 1 },

  // Tempo baseline in BPM
  tempoBaseline: { type: Number, default: null },

  // Top genres extracted from history (ordered by frequency)
  topGenres: { type: [String], default: [] },

  // Biometric baselines
  restingHeartRate: { type: Number, default: null }, // bpm
  hrZones: {
    zone1: { min: Number, max: Number }, // easy
    zone2: { min: Number, max: Number }, // fat burn
    zone3: { min: Number, max: Number }, // aerobic
    zone4: { min: Number, max: Number }, // anaerobic
    zone5: { min: Number, max: Number }, // max
  },

  lastAnalyzed: { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MusicProfile', musicProfileSchema);
