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
//
// The refresh floor (resilience RA-1, round 2): no socket event is rate limited, so a Live toggle or
// reconnect loop would start one refresh per edge — a User read, a MusicProfile read and two or more
// Spotify requests on the app-wide budget, whose 429 disables discovery for every user for an hour.
// So the value also records when the user's cache was last refreshed or last tried (`refreshedAt`),
// and the session-open refresh claims the floor (claimDiscoveryRefresh) before any Mongo or Spotify
// work: one attempt per user per DISCOVERY_REFRESH_FLOOR_MS, whatever its outcome, across sockets and
// processes, and erased with the candidates because it is the same key. The value is
// `{ refreshedAt, writtenAt, tracks }`: `writtenAt` is when the candidates were fetched, so an attempt
// that keeps them never gives them more than their 6 hours.

const { getRedis } = require('../../config/redis');

const DISCOVERY_CACHE_TTL_S = 6 * 3600;
// The handler over-fetches 60 candidates (DISCOVERY_FETCH_LIMIT); room for a little more, never a dump.
const DISCOVERY_CACHE_MAX = 100;
// 30 minutes. The refresh asks for the user's first two top genres, which move only when the taste
// profile is rebuilt, so a refresh inside half an hour of the last one returns the same candidates;
// it bounds a toggle or reconnect loop to two refreshes an hour per user (48 a day at worst, where the
// emotion runs already send one per playlist), and it is a twelfth of the 6-hour window, so a user who
// opens sessions through the day keeps a warm cache. A constant, no env override.
const DISCOVERY_REFRESH_FLOOR_MS = 30 * 60 * 1000;
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

const _time = (v) => (Number.isFinite(v) ? v : null);

// What a stored value holds. A list is the shape written before the floor existed: its candidates are
// read, and it records no refresh time and no write time.
function _parse(raw) {
  if (!raw) return { refreshedAt: null, writtenAt: null, tracks: [] };
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { refreshedAt: null, writtenAt: null, tracks: _projectAll(parsed) };
  if (!parsed || typeof parsed !== 'object') return { refreshedAt: null, writtenAt: null, tracks: [] };
  return {
    refreshedAt: _time(parsed.refreshedAt),
    writtenAt:   _time(parsed.writtenAt),
    tracks:      _projectAll(parsed.tracks),
  };
}

/**
 * Replace the user's cached candidates. Called only from user-driven paths. An empty list leaves
 * what is cached in place. A write is a refresh: it starts the floor. Never throws: answers whether
 * it wrote.
 */
async function writeDiscoveryCandidates(userId, tracks) {
  const id = _id(userId);
  if (!id) return false;
  const kept = _projectAll(tracks);
  if (kept.length === 0) return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    const now = Date.now();
    const value = JSON.stringify({ refreshedAt: now, writtenAt: now, tracks: kept });
    await redis.set(discoveryCacheKey(id), value, 'EX', DISCOVERY_CACHE_TTL_S);
    return true;
  } catch {
    return false;
  }
}

/**
 * May the session-open refresh run for this user now? True once per DISCOVERY_REFRESH_FLOOR_MS: the
 * claim is recorded before the caller does any work, so an attempt that fails or comes back empty
 * still holds the floor. Candidates already cached are kept with the lifetime they had left; ones
 * with less than the floor left are dropped, so the record lives the whole floor. Fails closed: no
 * Redis, a Redis error or an id that is not a user's answers false. Never throws.
 */
async function claimDiscoveryRefresh(userId) {
  const id = _id(userId);
  if (!id) return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    const key = discoveryCacheKey(id);
    const now = Date.now();
    let prior;
    try { prior = _parse(await redis.get(key)); } catch (e) { if (e instanceof SyntaxError) prior = _parse(null); else throw e; }
    if (prior.refreshedAt != null && now - prior.refreshedAt < DISCOVERY_REFRESH_FLOOR_MS) return false;
    const leftMs = prior.writtenAt == null ? 0 : prior.writtenAt + DISCOVERY_CACHE_TTL_S * 1000 - now;
    const keep = prior.tracks.length > 0 && leftMs >= DISCOVERY_REFRESH_FLOOR_MS;
    const value = JSON.stringify({ refreshedAt: now, writtenAt: keep ? prior.writtenAt : null, tracks: keep ? prior.tracks : [] });
    await redis.set(key, value, 'EX', Math.ceil((keep ? leftMs : DISCOVERY_REFRESH_FLOOR_MS) / 1000));
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
    return _parse(await redis.get(discoveryCacheKey(id))).tracks;
  } catch {
    return [];
  }
}

module.exports = {
  discoveryCacheKey,
  writeDiscoveryCandidates,
  readDiscoveryCandidates,
  claimDiscoveryRefresh,
  DISCOVERY_CACHE_TTL_S,
  DISCOVERY_REFRESH_FLOOR_MS,
  DISCOVERY_CACHE_MAX,
  KEY_PREFIX,
};
