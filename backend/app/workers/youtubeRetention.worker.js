'use strict';

const MusicProfile = require('../models/MusicProfile');
const User = require('../models/User');
const musicProfileService = require('../services/musicProfileService');

// YouTube ToS compliance (T3.5): stored YouTube library data may not be retained beyond 30 days
// without a refresh. This scheduled worker enforces that — for each profile carrying
// youtube_music library rows whose last rebuild predates the window:
//   • CONNECTED user  → refresh via buildProfile (re-fetches from the API, resets lastAnalyzed).
//   • DISCONNECTED / refresh-failed → PURGE the youtube_music rows.
// Spotify library rows and the global mbid discovery corpus (separate collections) are never
// touched. Mirrors the reclassify repeatable-worker pattern.

const YOUTUBE_TTL_DAYS = () => Number(process.env.YOUTUBE_DATA_TTL_DAYS) || 30;
const BATCH = () => Number(process.env.YOUTUBE_RETENTION_BATCH) || 200;

// Strip the youtube_music rows from a profile's library, recompute the taste footprint from
// what remains (Spotify rows), and persist. Returns the number of rows removed.
async function _purge(profile) {
  const library = profile.library || [];
  const kept = library.filter((t) => t.provider !== 'youtube_music');
  const removed = library.length - kept.length;
  if (!removed) return 0;
  const fp = musicProfileService.recomputeFootprint(kept);
  await MusicProfile.updateOne(
    { userId: profile.userId },
    { $set: { library: kept, topGenres: fp.topGenres, topArtists: fp.topArtists, genreSet: fp.genreSet } },
  );
  return removed;
}

async function processJob() {
  const cutoff = new Date(Date.now() - YOUTUBE_TTL_DAYS() * 24 * 3600 * 1000);
  const profiles = await MusicProfile.find({
    'library.provider': 'youtube_music',
    $or: [{ lastAnalyzed: { $lt: cutoff } }, { lastAnalyzed: null }],
  }).limit(BATCH());

  let refreshed = 0, purged = 0, rowsPurged = 0;
  for (const profile of profiles) {
    const user = await User.findById(profile.userId);
    const connected = !!user?.youtubeMusicToken?.blob;
    if (connected) {
      try {
        await musicProfileService.buildProfile(profile.userId, user); // re-fetch → resets lastAnalyzed
        refreshed += 1;
        continue;
      } catch (e) {
        // Refresh failed (expired token, API error) → purge so stale YouTube data never lingers.
        console.warn(`[youtubeRetention] refresh failed user=${profile.userId}: ${e.message}`);
      }
    }
    const removed = await _purge(profile);
    if (removed) { purged += 1; rowsPurged += removed; }
  }
  return { refreshed, purged, rowsPurged };
}

module.exports = { process: processJob, _purge };
