'use strict';

// GDPR erasure for user-scoped Redis state. Mongo deletion is the durable part
// of the cascade; these keys would self-expire anyway (ledger 8d, pool 12h,
// baseline 6h) but right-to-erasure means the encrypted baseline blob and the
// behavioral ledger windows go NOW, not at TTL. Best-effort by design: a Redis
// outage must not block the Mongo erasure, and TTLs guarantee eventual cleanup.

const { getRedis } = require('../config/redis');

function patternsFor(userId) {
  return [
    `ledger:${userId}:*`,   // serve-ledger hot windows (global + per-mood)
    `pool:${userId}:*`,     // candidate-pool partitions
    `bio:baseline:${userId}`, // AAD-bound encrypted baseline blob
  ];
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

module.exports = { purgeUserKeys };
