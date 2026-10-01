'use strict';

// GDPR erasure for user-scoped Redis state. Mongo deletion is the durable part
// of the cascade; these keys would self-expire anyway (ledger 8d, pool 12h,
// buffer 30m, baseline 24h — baselines.js CACHE_TTL_S; its 6h is only the freshness
// window — affect 2h) but right-to-erasure means the encrypted baseline blob,
// the precompiled live buffers and the behavioral ledger windows go NOW, not at TTL.
// purgeUserKeys is best-effort by design: a Redis outage must not block the Mongo
// erasure, and TTLs guarantee eventual cleanup. purgeUserKeysStrict is the variant for
// an erasure that must report whether it finished.

const { getRedis } = require('../config/redis');

// Registry of every USER-SCOPED Redis namespace. Each entry maps a userId to the
// SCAN MATCH pattern covering all keys that namespace writes for that user. Erasure
// iterates this registry, so a NEW user-scoped namespace is impossible to silently
// miss — register its builder here and erasure (plus the GDPR export audit) covers it.
//
// Deliberately ABSENT — GLOBAL, cross-user caches carrying no userId (ADR 0008): the
// AudioFeature cache (`af:<recordingKey>`), the LLM cache (`gemini:<model>:<hash>`) and the
// token denylist (`revoked:jti:<jti>`, self-expiring revocation records). Purging any
// of these on a single user's erasure would evict every other user's rows.
const USER_KEY_NAMESPACES = Object.freeze([
  { name: 'serve-ledger',   pattern: (id) => `ledger:${id}:*` },   // serve-ledger hot windows (global + per-mood)
  { name: 'candidate-pool', pattern: (id) => `pool:${id}:*` },     // candidate-pool partitions
  { name: 'live-buffer',    pattern: (id) => `buffer:${id}:*` },   // precompiled live-biometric playlists
  { name: 'bio-baseline',   pattern: (id) => `bio:baseline:${id}` }, // AAD-bound encrypted baseline blob
  // W4-006 (§0.4 S5): the carried affect posterior — an AAD-bound encrypted HMM state whose
  // `label` is an INFERRED emotional/physiological state. Self-expires in 2 h, but right-to-
  // erasure means an inference about a person goes when they ask, not when a TTL gets round to it.
  { name: 'bio-affect',     pattern: (id) => `bio:affect:${id}` },
]);

function patternsFor(userId) {
  return USER_KEY_NAMESPACES.map((ns) => ns.pattern(userId));
}

async function purgeUserKeys(userId) {
  const redis = getRedis();
  const id = typeof userId === 'string' ? userId : String(userId || '');
  if (!redis || !id.trim()) return 0;

  let deleted = 0;
  try {
    for (const pattern of patternsFor(id)) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) deleted += await redis.del(...keys);
      } while (cursor !== '0');
    }
  } catch {
    /* best-effort — TTLs finish the job */
  }
  return deleted;
}

// The same registry, deleted STRICTLY (HX-2 M6; shared since BE-016). purgeUserKeys swallows errors,
// which would let an erasure report itself finished while an 8-day ledger window outlived its promise.
// A Redis that is configured but unusable is a failed step; a deployment with no Redis has nothing to
// purge. Callers: spotifyErasure.purgeSpotifyData and sessionHealthErasure.
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

module.exports = { purgeUserKeys, purgeUserKeysStrict, patternsFor, USER_KEY_NAMESPACES };
