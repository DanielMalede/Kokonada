'use strict';

// Spotify disconnect erasure (HX-2 M5). Spotify Developer Terms V.8 and Appendix A §5.b/§5.c:
// when a user disconnects, what we derived from their Spotify account is deleted. The in-app
// confirm copy promises "your Spotify connection, the music profile built from it, and the
// Spotify tracks listed in History" — every clause maps to a step below, and the copy must change
// if a step ever stops being delivered.
//
// Scope is ONE user and ONE provider: a YouTube session, a YouTube pool row and every other user
// are untouched. Kokonada's own record of each moment (mood, taps, activity, skips) stays.
//
// Global corpora (TrackCatalog / TrackEmbedding / AudioFeature) are not per-user and refuse Spotify
// Content at their write paths; spotifyLeakMonitor counts them (ADR 0011). Not erased here.

const ServeEvent = require('../../models/ServeEvent');
const MusicProfile = require('../../models/MusicProfile');
const UnclassifiedTrack = require('../../models/UnclassifiedTrack');
const { purgeUserKeys } = require('../../utils/userRedisPurge');
const { purgeProviderData } = require('./providerContentErasure');

// Run every step even when one fails — a partial purge still removes what it can — then fail
// loudly so the caller never reports success over stranded data. Logs are COUNTS only (M10):
// no title, artist, ID, URI, or user reference.
async function purgeSpotifyData(userId) {
  const steps = [
    ['sessions', () => purgeProviderData(userId, 'spotify')],
    ['serveEvents', async () => (await ServeEvent.deleteMany({ userId }))?.deletedCount ?? 0],
    ['profiles', async () => (await MusicProfile.deleteOne({ userId }))?.deletedCount ?? 0],
    ['unclassified', async () => (await UnclassifiedTrack.deleteMany({ userId, 'track.provider': 'spotify' }))?.deletedCount ?? 0],
    ['redisKeys', () => purgeUserKeys(userId)],
  ];

  const settled = await Promise.allSettled(steps.map(([, run]) => run()));
  const counts = {};
  const failed = [];
  settled.forEach((s, i) => {
    const [name] = steps[i];
    if (s.status === 'fulfilled') counts[name] = s.value ?? 0;
    else { counts[name] = 0; failed.push(`${name}:${s.reason?.name || 'Error'}`); }
  });

  console.log(`[spotifyErasure] ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (failed.length) {
    throw new Error(`spotify erasure incomplete — ${failed.length} step(s) failed (${failed.join(', ')})`);
  }
  return counts;
}

module.exports = { purgeSpotifyData };
