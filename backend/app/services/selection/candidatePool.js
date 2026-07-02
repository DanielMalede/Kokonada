'use strict';

const { getRedis } = require('../../config/redis');
const { attachCanonicalKeys } = require('../identity/trackIdentity');

// Mood-partitioned candidate pools. The library partition (exclude-genre filtered,
// affinity-capped) is cached per (user, mood) in Redis and invalidated by the
// profile's lastAnalyzed stamp; request-time discovery tracks are appended fresh.
// Canonical dedup happens HERE, at the pool boundary — root causes 2–4 die here.

const POOL_MAX = () => parseInt(process.env.SELECTION_POOL_MAX || '500', 10);
const POOL_TTL_S = () => parseInt(process.env.SELECTION_POOL_TTL_S || String(12 * 3600), 10);

const _poolKey = (userId, moodKey) => `pool:${userId}:${moodKey ?? 'none'}`;

function _genreExcluded(track, excludeSet) {
  return (track.genres || []).some(g => excludeSet.has(String(g).toLowerCase().trim()));
}

function _partitionLibrary(library, excludeGenres) {
  const excludeSet = new Set((excludeGenres || []).map(g => String(g).toLowerCase().trim()));
  return attachCanonicalKeys(
    (library || [])
      .filter(t => t && !_genreExcluded(t, excludeSet))
      .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
      .slice(0, POOL_MAX())
      .map(t => ({ ...t }))
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

module.exports = { buildPool };
