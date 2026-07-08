'use strict';

const { getRedis } = require('../config/redis');

// Redis store for precompiled live-biometric playlists (Part 3). A buffer is a
// ready-to-play playlist keyed by (user, synthetic bio-mood band). Flipping to Live
// mode reads the current band's buffer and plays instantly. Everything degrades to a
// cold miss without Redis — the toggle then falls back to a one-time live generation.

const TTL_S = () => parseInt(process.env.SHADOW_BUFFER_TTL_S || '1800', 10); // 30 min
const _key = (userId, bioMoodKey) => `buffer:${userId}:${bioMoodKey}`;

async function setBuffer(userId, bioMoodKey, playlist) {
  const redis = getRedis();
  if (!redis || !userId || !bioMoodKey) return false;
  try {
    await redis.set(_key(userId, bioMoodKey), JSON.stringify(playlist), 'EX', TTL_S());
    return true;
  } catch {
    return false; // a buffer is an enhancement — a store failure never breaks generation
  }
}

async function getBuffer(userId, bioMoodKey) {
  const redis = getRedis();
  if (!redis || !userId || !bioMoodKey) return null;
  try {
    const raw = await redis.get(_key(userId, bioMoodKey));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // cold miss on any error (down Redis, corrupt blob) → live fallback
  }
}

module.exports = { setBuffer, getBuffer, _key };
