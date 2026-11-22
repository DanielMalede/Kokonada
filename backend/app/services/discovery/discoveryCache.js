'use strict';

// BE-231 RA-1 — the heart-rate branch's Spotify discovery candidates, cached per user.
//
// A run that a sustained heart-rate change triggers used to send Spotify a discovery request under
// the user's token, so the request's timing (and its fixed shape) told Spotify when the heart rate
// moved. The owner ruled on 2026-11-22: a per-user cache, and decoupling the discovery request alone
// closes RA-1. So the heart-rate branch only READS this key, and only user-driven events write it:
// opening a live session and the emotion branch's own runs (sockets/biometricHandler.js). A miss is
// an empty list, and the familiar ladder fills the playlist.
//
// What is stored: the tagged, taste-filtered Spotify candidates, reduced to what the pipeline reads
// from one — the track id and URI, its name, its artists' ids and names, and the genre tags the mixer
// matched it on. No album, artwork, preview, popularity or market data. Nothing health-derived: the
// requests that fill it carry no health value (BE-231's fence), and the heart rate never chooses
// what is kept. The window is short on purpose (Spotify's developer terms: cache content only as long
// as the service needs it), and it is a constant with no env override.
//
// Erasure: the key is registered in utils/userRedisPurge.js USER_KEY_NAMESPACES, so account
// deletion, a health-data withdrawal, Spotify disconnect and the orphan sweep remove it.

const { getRedis } = require('../../config/redis');

const DISCOVERY_CACHE_TTL_S = 6 * 3600;
// The handler over-fetches 60 candidates (DISCOVERY_FETCH_LIMIT); room for a little more, never a dump.
const DISCOVERY_CACHE_MAX = 100;
const KEY_PREFIX = 'disc:bio:';
// The same refusal as the registry purges: an id holding a SCAN glob character, or none, is not a user.
const GLOB_CHARACTER = /[*?[\]\\]/;

function _id(userId) {
  const id = userId == null ? '' : String(userId).trim();
  if (!id || GLOB_CHARACTER.test(id)) return null;
  return id;
}

function discoveryCacheKey(userId) {
  return `${KEY_PREFIX}${userId}`;
}

const _str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
const _strings = (list) => (Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v.length > 0) : []);

// One candidate, reduced to the fields kept. A non-Spotify or id-less candidate is dropped: only the
// Spotify closure fills this cache, and only a Spotify track id can be played from it.
function _project(t) {
  if (!t || typeof t !== 'object') return null;
  const provider = t.provider == null ? 'spotify' : t.provider;
  const id = _str(t.id);
  if (provider !== 'spotify' || !id) return null;
  const artists = (Array.isArray(t.artists) ? t.artists : [])
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({ id: _str(a.id), name: _str(a.name) }));
  return {
    id,
    uri: _str(t.uri),
    name: _str(t.name),
    artists,
    provider: 'spotify',
    artistIds: _strings(t.artistIds),
    genres: _strings(t.genres),
  };
}

function _projectAll(list) {
  return (Array.isArray(list) ? list : []).map(_project).filter(Boolean).slice(0, DISCOVERY_CACHE_MAX);
}

/**
 * Replace the user's cached candidates. Called only from user-driven paths. An empty list leaves
 * what is cached in place. Never throws: answers whether it wrote.
 */
async function writeDiscoveryCandidates(userId, tracks) {
  const id = _id(userId);
  if (!id) return false;
  const kept = _projectAll(tracks);
  if (kept.length === 0) return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(discoveryCacheKey(id), JSON.stringify(kept), 'EX', DISCOVERY_CACHE_TTL_S);
    return true;
  } catch {
    return false;
  }
}

/**
 * The user's cached candidates, re-projected on the way out; [] on a miss, no Redis, a Redis error
 * or a value that does not parse. Never throws and never asks Spotify.
 */
async function readDiscoveryCandidates(userId) {
  const id = _id(userId);
  if (!id) return [];
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get(discoveryCacheKey(id));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? _projectAll(parsed) : [];
  } catch {
    return [];
  }
}

module.exports = {
  discoveryCacheKey,
  writeDiscoveryCandidates,
  readDiscoveryCandidates,
  DISCOVERY_CACHE_TTL_S,
  DISCOVERY_CACHE_MAX,
  KEY_PREFIX,
};
