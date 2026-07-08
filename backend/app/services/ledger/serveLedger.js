'use strict';

const ServeEvent = require('../../models/ServeEvent');
const { getRedis } = require('../../config/redis');

// The global serve ledger — single source of truth for track exposure.
//   Hot path:  per-user Redis ZSETs (member = canonicalKey, score = servedAt ms)
//              `ledger:{userId}:served` and `ledger:{userId}:mood:{moodKey}`,
//              pruned on write and TTL'd, lazily rebuilt from Mongo on miss.
//   Durable:   ServeEvent rows (TTL 90d) — survive Redis flushes and feed the
//              exposure-decay scorer via getExposure().
// Redis failures never lose data (Mongo writes first) and never throw upward.

const HOUR = 3_600_000;
const HOT_DAYS       = () => parseInt(process.env.LEDGER_HOT_DAYS || '8', 10);
const GLOBAL_HOURS   = () => parseInt(process.env.LEDGER_GLOBAL_EXCLUDE_HOURS || '8', 10);
const MOOD_HOURS     = () => parseInt(process.env.LEDGER_MOOD_EXCLUDE_HOURS || '72', 10);
const EXPOSURE_DAYS  = () => parseInt(process.env.LEDGER_EXPOSURE_DAYS || '30', 10);

const _servedKey = (userId) => `ledger:${userId}:served`;
const _moodHotKey = (userId, moodKey) => `ledger:${userId}:mood:${moodKey}`;

async function recordServes({ userId, sessionId = null, entries = [] }, now = Date.now()) {
  const servedAt = new Date(now);
  // A keyless entry would reject the whole durable batch (required field) and
  // pollute the ZSETs with a shared "null" member — skip them at the boundary.
  entries = entries.filter((e) => e?.canonicalKey);
  const docs = entries.map((e) => ({
    userId,
    canonicalKey: e.canonicalKey,
    moodKey: e.moodKey ?? null,
    bioState: {
      tempoBand: e.bioState?.tempoBand ?? null,
      activity:  e.bioState?.activity ?? null,
    },
    sessionId,
    servedAt,
  }));
  if (!docs.length) return { recorded: 0 };

  await ServeEvent.insertMany(docs, { ordered: false });

  const redis = getRedis();
  if (redis) {
    try {
      const pruneBefore = now - HOT_DAYS() * 24 * HOUR;
      const ttlSeconds = HOT_DAYS() * 24 * 3600;
      const moodKeys = new Set();
      for (const e of entries) {
        await redis.zadd(_servedKey(userId), now, e.canonicalKey);
        if (e.moodKey) {
          await redis.zadd(_moodHotKey(userId, e.moodKey), now, e.canonicalKey);
          moodKeys.add(e.moodKey);
        }
      }
      await redis.zremrangebyscore(_servedKey(userId), '-inf', pruneBefore);
      await redis.expire(_servedKey(userId), ttlSeconds);
      for (const mk of moodKeys) {
        await redis.zremrangebyscore(_moodHotKey(userId, mk), '-inf', pruneBefore);
        await redis.expire(_moodHotKey(userId, mk), ttlSeconds);
      }
    } catch (e) {
      console.error('[serveLedger] redis hot-window write failed:', e.message);
    }
  }
  return { recorded: docs.length };
}

// Shared hot-window read: Redis when available (lazy Mongo rebuild on missing
// key), plain Mongo otherwise.
async function _hotWindow({ userId, key, sinceMs, now, moodKey = null }) {
  const rebuild = async () => ServeEvent.find({
    userId,
    ...(moodKey ? { moodKey } : {}),
    servedAt: { $gte: new Date(now - HOT_DAYS() * 24 * HOUR) },
  }).lean();

  const redis = getRedis();
  if (redis) {
    try {
      if (!(await redis.exists(key))) {
        // Rebuild: answer from the Mongo rows DIRECTLY — never round-trip through
        // Redis writes that might silently fail (OOM eviction, write-dropped
        // replicas) and lie an empty window back. Population is best-effort.
        const rows = await rebuild();
        for (const row of rows) {
          await redis.zadd(key, new Date(row.servedAt).getTime(), row.canonicalKey);
        }
        await redis.expire(key, HOT_DAYS() * 24 * 3600);
        return new Set(
          rows.filter(r => new Date(r.servedAt).getTime() >= sinceMs).map(r => r.canonicalKey)
        );
      }
      return new Set(await redis.zrangebyscore(key, sinceMs, '+inf'));
    } catch (e) {
      console.error('[serveLedger] redis hot-window read failed, degrading to Mongo:', e.message);
    }
  }

  const rows = await rebuild();
  return new Set(
    rows.filter(r => new Date(r.servedAt).getTime() >= sinceMs).map(r => r.canonicalKey)
  );
}

// Tracks served under ANY mood inside the global window — hard-excluded everywhere.
function hardExcluded(userId, now = Date.now()) {
  return _hotWindow({ userId, key: _servedKey(userId), sinceMs: now - GLOBAL_HOURS() * HOUR, now });
}

// Tracks served under THIS mood inside the per-mood window.
function moodExcluded(userId, moodKey, now = Date.now()) {
  return _hotWindow({
    userId,
    key: _moodHotKey(userId, moodKey),
    sinceMs: now - MOOD_HOURS() * HOUR,
    now,
    moodKey,
  });
}

// Durable per-track serve history for the exposure-decay scorer.
async function getExposure(userId, canonicalKeys = [], now = Date.now()) {
  const out = new Map();
  if (!canonicalKeys.length) return out;
  const rows = await ServeEvent.find({
    userId,
    canonicalKey: { $in: canonicalKeys },
    servedAt: { $gte: new Date(now - EXPOSURE_DAYS() * 24 * HOUR) },
  }).lean();
  for (const row of rows) {
    if (!out.has(row.canonicalKey)) out.set(row.canonicalKey, []);
    out.get(row.canonicalKey).push({ moodKey: row.moodKey, servedAt: row.servedAt });
  }
  return out;
}

module.exports = { recordServes, hardExcluded, moodExcluded, getExposure };
