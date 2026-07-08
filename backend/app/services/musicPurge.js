'use strict';

const MusicProfile = require('../models/MusicProfile');
const musicClassifier = require('./musicClassifier');
const unclassifiedRepo = require('../repositories/unclassifiedRepo');
const { recomputeFootprint } = require('./musicProfileService');

// Retroactive purge: classify a user's youtube_music library entries and PERMANENTLY remove
// the non-music (hard delete, no audit — §D2). The undecidable (Groq outage) move to the
// unclassified pool for the periodic worker (§D4). The taste footprint is recomputed from the
// survivors (which still include every Spotify track — those always pass through as music).
async function purgeNonMusic(userId, { youtubeToken = null, useLLM = true } = {}) {
  const empty = { scanned: 0, purged: 0, pooled: 0, kept: 0 };

  const profile = await MusicProfile.findOne({ userId }).lean();
  const library = profile?.library ?? [];
  if (!library.length) return empty;

  const { music, nonMusic, unclassified } =
    await musicClassifier.classifyTracks(library, { youtubeToken, useLLM });

  if (unclassified.length) await unclassifiedRepo.addMany(userId, unclassified, 'purge');

  const footprint = recomputeFootprint(music);
  await MusicProfile.updateOne(
    { userId },
    { $set: {
      library:    music,
      topGenres:  footprint.topGenres,
      topArtists: footprint.topArtists,
      genreSet:   footprint.genreSet,
    } },
  );

  return { scanned: library.length, purged: nonMusic.length, pooled: unclassified.length, kept: music.length };
}

module.exports = { purgeNonMusic };
