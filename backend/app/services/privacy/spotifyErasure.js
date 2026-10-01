'use strict';

// Spotify disconnect erasure (HX-2 M5/M6). Spotify Developer Terms V.8 and Appendix A §5.b/§5.c:
// when a user disconnects, what we derived from their Spotify account is deleted within 5 days.
// The in-app confirm copy promises "your Spotify connection, the music profile built from it, and
// the Spotify tracks listed in History" — every clause maps to a step below, and the copy must
// change if a step ever stops being delivered.
//
// Scope is ONE user and ONE provider: a YouTube session, a YouTube pool row and every other user
// are untouched. Kokonada's own record of each moment (mood, taps, activity, skips) stays.
//
// Global corpora (TrackCatalog / TrackEmbedding / AudioFeature) are not per-user and refuse Spotify
// Content at their write paths; spotifyLeakMonitor counts them (ADR 0011). Not erased here.

const User = require('../../models/User');
const PlaylistSession = require('../../models/PlaylistSession');
const ServeEvent = require('../../models/ServeEvent');
const MusicProfile = require('../../models/MusicProfile');
const UnclassifiedTrack = require('../../models/UnclassifiedTrack');
const { getRedis } = require('../../config/redis');
const { patternsFor } = require('../../utils/userRedisPurge');
const { purgeProviderData, HOLDS_PROVIDER_CONTENT } = require('./providerContentErasure');

const SWEEP_BATCH = () => Number(process.env.SPOTIFY_ERASURE_SWEEP_BATCH) || 200;

// The user-scoped Redis keys (ledger windows, candidate pools, live buffers — the namespaces
// registered in userRedisPurge), deleted STRICTLY. The shared purgeUserKeys is best-effort by
// design and swallows errors, which here would report a finished erasure while an 8-day ledger
// window of track keys outlived the 5-day promise. A Redis that is configured but unusable is a
// failed step; a deployment with no Redis has nothing to purge.
async function purgeUserKeysStrict(userId) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('refusing a Redis purge without a user id');
  const redis = getRedis();
  if (!redis) {
    if (process.env.REDIS_URL) throw new Error('Redis is configured but unavailable');
    return 0;
  }
  let deleted = 0;
  for (const pattern of patternsFor(id)) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length) deleted += await redis.del(...keys);
    } while (cursor !== '0');
  }
  return deleted;
}

// Run every step even when one fails — a partial purge still removes what it can — then fail
// loudly so the caller never reports success over stranded data. Only a FULL purge closes the
// owed-erasure record (and drops the session playlist ID a pre-HX-2 disconnect left behind); a
// user who reconnected in the meantime is not touched by that write. Logs are COUNTS only (M10):
// no title, artist, ID, URI, or user reference.
// `profile`: 'whole' (the in-app Disconnect — the copy and the declarations say the profile goes,
// YouTube entries included) or 'spotify-derived' (the daily sweep — a profile the user has since
// built from YouTube alone holds nothing of Spotify's and is kept; M2). A profile counts as
// Spotify-derived while it has a Spotify library row or Spotify artist IDs.
const SPOTIFY_DERIVED_PROFILE = Object.freeze({ $or: [{ 'library.provider': 'spotify' }, { 'knownArtistIds.0': { $exists: true } }] });

async function purgeSpotifyData(userId, { profile = 'whole' } = {}) {
  const profileFilter = profile === 'spotify-derived' ? { userId, ...SPOTIFY_DERIVED_PROFILE } : { userId };
  const steps = [
    ['sessions', () => purgeProviderData(userId, 'spotify')],
    ['serveEvents', async () => (await ServeEvent.deleteMany({ userId }))?.deletedCount ?? 0],
    ['profiles', async () => (await MusicProfile.deleteOne(profileFilter))?.deletedCount ?? 0],
    ['unclassified', async () => (await UnclassifiedTrack.deleteMany({ userId, 'track.provider': 'spotify' }))?.deletedCount ?? 0],
    ['redisKeys', () => purgeUserKeysStrict(userId)],
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
  await User.updateOne(
    { _id: userId, spotifyToken: null },
    { $set: { spotifySessionPlaylistId: null, spotifyErasurePendingAt: null } },
  );
  return counts;
}

// Users who owe a Spotify erasure: (1) a disconnect whose purge did not finish (the record), and
// (2) anyone no longer linked to Spotify who still holds Spotify-derived rows — a disconnect made
// before HX-2, or a write that landed after the purge.
async function _usersOwingErasure(limit) {
  const owed = await User.find({ spotifyErasurePendingAt: { $ne: null } }).select('_id').limit(limit).lean();
  const holders = [
    ...await PlaylistSession.distinct('userId', { musicProvider: 'spotify', ...HOLDS_PROVIDER_CONTENT }),
    ...await MusicProfile.distinct('userId', { 'library.provider': 'spotify' }),
    ...await UnclassifiedTrack.distinct('userId', { 'track.provider': 'spotify' }),
  ];
  const unlinked = await User.find({
    spotifyToken: null,
    $or: [{ _id: { $in: holders } }, { spotifySessionPlaylistId: { $ne: null } }],
  }).select('_id').limit(limit).lean();
  return [...new Set([...owed, ...unlinked].map((u) => String(u._id)))].slice(0, limit);
}

// The M6 retry, run daily by sessionTrim: every owed erasure is finished within days, with no user
// action. A user who RECONNECTED before the run keeps the new link's data — only the stale record
// is cleared (anything left from before is still bounded by the 29-day clocks). One user's failure
// never stops the rest; it stays owed and is retried on the next run.
async function sweepOwedSpotifyErasures() {
  let erased = 0;
  let failed = 0;
  for (const id of await _usersOwingErasure(SWEEP_BATCH())) {
    const user = await User.findById(id).select('spotifyToken spotifyErasurePendingAt').lean();
    if (!user) continue;
    if (user.spotifyToken?.blob) {
      if (user.spotifyErasurePendingAt) await User.updateOne({ _id: id }, { $set: { spotifyErasurePendingAt: null } });
      continue;
    }
    try {
      await purgeSpotifyData(id, { profile: 'spotify-derived' });
      erased += 1;
    } catch {
      failed += 1; // purgeSpotifyData already logged which steps failed, by name
    }
  }
  return { count: erased, failed };
}

module.exports = { purgeSpotifyData, sweepOwedSpotifyErasures };
