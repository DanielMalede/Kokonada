'use strict';

const { spotifyRowSelector } = require('../../utils/spotifyContent');

// Standing Spotify-ToS leak monitor (ADR 0011). NON-DESTRUCTIVE: it only COUNTS the
// spotify:-keyed rows still present in the global caches (TrackCatalog / TrackEmbedding /
// AudioFeature) and alerts if any exist. Post-containment + post-purge this must read zero;
// a non-zero total means a write path regressed or the purge hasn't run — surfaced via a
// logged warning and an ok=false result (which a health route / cron can act on). It never
// deletes — remediation is the human-gated purge script, not an automatic delete.
async function checkSpotifyLeak({ collections, logger = console } = {}) {
  const sel = spotifyRowSelector();
  const counts = {};
  for (const [name, col] of Object.entries(collections || {})) {
    counts[name] = await col.countDocuments(sel);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const ok = total === 0;

  if (!ok) {
    logger.warn?.(`[spotifyLeakMonitor] ALERT: ${total} Spotify-keyed row(s) present in global caches ${JSON.stringify(counts)} — run scripts/purgeSpotifyCorpus.js`);
  } else {
    logger.info?.('[spotifyLeakMonitor] ok: no Spotify Content in global caches');
  }
  return { ok, total, counts };
}

// Short-TTL memoization for the (unauthenticated) /health/spotify-leak route: without it, a
// scraper/uptime poller could force 3 full collection scans on every hit. A few-second cache
// makes repeated hits cheap while keeping the signal fresh enough to alert on. `now` is injected
// for deterministic tests.
let _cache = { ts: 0, result: null };
async function checkSpotifyLeakCached({ collections, logger = console, ttlMs = 10_000, now = Date.now } = {}) {
  const t = now();
  if (_cache.result && (t - _cache.ts) < ttlMs) return _cache.result;
  const result = await checkSpotifyLeak({ collections, logger });
  _cache = { ts: t, result };
  return result;
}
function _resetCache() { _cache = { ts: 0, result: null }; }

// Lazily bind the real Mongo models so requiring this module has no side effects (and tests
// inject fakes). Kept separate from checkSpotifyLeak so the pure check stays Mongo-free.
function defaultCollections() {
  return {
    TrackCatalog:   require('../../models/TrackCatalog'),
    TrackEmbedding: require('../../models/TrackEmbedding'),
    AudioFeature:   require('../../models/AudioFeature'),
  };
}

module.exports = { checkSpotifyLeak, checkSpotifyLeakCached, _resetCache, defaultCollections };
