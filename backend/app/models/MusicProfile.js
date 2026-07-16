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

  // Top artists ranked by listening frequency
  topArtists: { type: [String], default: [] },

  // The user's full genre footprint (every genre across top artists + library),
  // used to filter discovery tracks against real taste. Broader than topGenres.
  genreSet: { type: [String], default: [] },

  // Spotify artist IDs the user actually listens to — used so discovery only
  // surfaces *new* artists (true novelty) rather than ones already in the library.
  knownArtistIds: { type: [String], default: [] },

  // Compact per-track library used by the 70/30 playlist mixer.
  // Capped at 10 000 entries to stay well within the 16 MB document limit.
  // tempo/energy/etc. are retained for backward-compat but are now always null:
  // Spotify's /audio-features endpoint is dead for new apps (Nov 2024).
  library: {
    type: [{
      id:           { type: String, required: true },
      provider:     { type: String, enum: ['spotify', 'youtube_music'], required: true },
      // Cross-provider identity: ISRC when Spotify supplies it, plus the derived
      // canonical key (isrc:… or at:artist|title) the variance engine dedupes on.
      isrc:         { type: String, default: null },
      canonicalKey: { type: String, default: null },
      name:         { type: String, default: null },
      uri:          { type: String, default: null },
      tempo:        { type: Number, default: null },
      energy:       { type: Number, default: null },
      valence:      { type: Number, default: null },
      acousticness: { type: Number, default: null },
      danceability: { type: Number, default: null },
      genres:       { type: [String], default: [] },
      artist:       { type: String, default: null },
      artistIds:    { type: [String], default: [] },
      popularity:   { type: Number, default: null },
      // Weighted listening affinity (top tracks > saved > recently-played …),
      // used to rank familiar-track selection in the mixer.
      affinity:     { type: Number, default: 0 },
    }],
    default: [],
  },

  // Biometric baselines DELETED (T3.3): restingHeartRate + hrZones were plaintext
  // special-category health data. They live encrypted on MedicalProfile — the single
  // source of truth — and were never even written here. Readers now source resting HR
  // from MedicalProfile (see sockets/biometricHandler.js, services/geminiEngine.js).

  lastAnalyzed: { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MusicProfile', musicProfileSchema);
