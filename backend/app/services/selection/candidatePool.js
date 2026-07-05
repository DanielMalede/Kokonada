'use strict';

const { getRedis } = require('../../config/redis');
const { attachCanonicalKeys, canonicalKey } = require('../identity/trackIdentity');

// Identity trust boundary (shadow-audit): tracks from OUR library carry keys
// attached at profile build — fill only the missing ones (regex canonicalization
// is the pool's hottest cost under load). Anything external (discovery candidates,
// Redis-cached partitions) gets a FORCED recompute — forged keys never survive.
function _fillMissingKeys(tracks) {
  for (const track of tracks) {
    if (track && !track.canonicalKey) track.canonicalKey = canonicalKey(track);
  }
  return tracks;
}

// Mood-partitioned candidate pools. The library partition (exclude-genre filtered,
// affinity-capped) is cached per (user, mood) in Redis and invalidated by the
// profile's lastAnalyzed stamp; request-time discovery tracks are appended fresh.
// Canonical dedup happens HERE, at the pool boundary — root causes 2–4 die here.

const POOL_MAX = () => parseInt(process.env.SELECTION_POOL_MAX || '10000', 10);
const POOL_TTL_S = () => parseInt(process.env.SELECTION_POOL_TTL_S || String(12 * 3600), 10);

const _poolKey = (userId, moodKey) => `pool:${userId}:${moodKey ?? 'none'}`;

function _genreExcluded(track, excludeSet) {
  return (track.genres || []).some(g => excludeSet.has(String(g).toLowerCase().trim()));
}

// Materialize a PLAIN track. A Mongoose subdocument (library loaded without .lean())
// spreads to its parent-proxy internals ($__/_doc/$__parent/__parentArray), not its
// real fields — and JSON.stringify over those recurses into the whole owner doc per
// track → 442MB heap OOM. toObject() strips the proxies; plain input just gets copied.
function _plainTrack(t) {
  return typeof t?.toObject === 'function' ? t.toObject() : { ...t };
}

function _partitionLibrary(library, excludeGenres) {
  const excludeSet = new Set((excludeGenres || []).map(g => String(g).toLowerCase().trim()));
  return _fillMissingKeys(
    (library || [])
      .filter(t => t && !_genreExcluded(t, excludeSet))
      .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
      .slice(0, POOL_MAX())
      .map(_plainTrack)
  );
}

async function buildPool({ userId, musicProfile = {}, moodKey = null, excludeGenres = [], discoveryTracks = [] }) {
  const builtFrom = musicProfile.lastAnalyzed ? new Date(musicProfile.lastAnalyzed).getTime() : 0;
  const redis = getRedis();
  const key = _poolKey(userId, moodKey);

  let partition = null;
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Identity is NEVER trusted from cache: recompute canonicalKeys so a
        // tampered/poisoned entry cannot smuggle forged keys past the ledger.
        if (parsed.builtFrom === builtFrom) partition = attachCanonicalKeys(parsed.tracks || []);
      }
    } catch { /* cache miss on any error */ }
  }

  if (!partition) {
    partition = _partitionLibrary(musicProfile.library, excludeGenres);
    if (redis) {
      redis.set(key, JSON.stringify({ builtFrom, tracks: partition }), 'EX', POOL_TTL_S()).catch(() => {});
    }
  }

  // Discovery is external input — forged canonicalKeys are ALWAYS recomputed.
  const discovery = attachCanonicalKeys((discoveryTracks || []).filter(Boolean).map(t => ({ ...t, isDiscovery: true })));

  // Library first: a familiar copy owns the identity; provider duplicates collapse.
  const seen = new Set();
  const pool = [];
  for (const track of [...partition, ...discovery]) {
    const k = track.canonicalKey ?? `${track.provider}:${track.id}`;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    pool.push(track);
  }
  return pool;
}

// Purge EVERY cached pool partition for a user (all moods). Called when the profile's
// provider mix changes (e.g. disconnecting YouTube) so the next generation can't serve
// stale, wrong-provider tracks from a pre-change cache before the rebuild's lastAnalyzed
// stamp would invalidate it. SCAN (non-blocking) to collect this user's keys, then DEL.
// No-op (returns 0) without Redis. Returns the number of keys removed.
async function invalidateUserPools(userId) {
  const redis = getRedis();
  if (!redis || !userId) return 0;
  const pattern = _poolKey(userId, '*');
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    if (batch?.length) keys.push(...batch);
  } while (cursor !== '0');
  if (keys.length) await redis.del(...keys);
  return keys.length;
}

module.exports = { buildPool, invalidateUserPools };
