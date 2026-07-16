'use strict';

const MusicProfile = require('../models/MusicProfile');
const User = require('../models/User');
const musicProfileService = require('../services/musicProfileService');

// YouTube ToS compliance (T3.5): stored YouTube library data may not be retained beyond 30 days
// without a refresh. For each profile carrying youtube_music library rows whose last rebuild
// predates the window:
//   • CONNECTED user → refresh via buildProfile (re-fetches from the API, resets lastAnalyzed).
//   • DISCONNECTED   → PURGE the youtube_music rows.
// Refresh-failure handling (H1) — never wipe a still-connected library on a rate-limit blip:
//   • TERMINAL failure (revoked / invalid_grant → the connection is unusable) → purge now.
//   • TRANSIENT failure (429 / 5xx / network) → retry with exponential backoff + jitter; if it
//     still fails, DEFER to the next run (keep the data) UNTIL the hard compliance ceiling
//     (TTL + grace), past which we must purge to honor the 30-day ToS.
// Spotify library rows and the global mbid discovery corpus (separate collections) are never
// touched. Mirrors the reclassify repeatable-worker pattern.

const YOUTUBE_TTL_DAYS   = () => Number(process.env.YOUTUBE_DATA_TTL_DAYS) || 30;       // compliance target / selection
const YOUTUBE_GRACE_DAYS = () => Number(process.env.YOUTUBE_REFRESH_GRACE_DAYS) || 7;   // transient-recovery grace past TTL
const REFRESH_RETRIES    = () => Math.max(1, Number(process.env.YOUTUBE_REFRESH_RETRIES) || 3);
const BASE_BACKOFF_MS    = () => { const n = Number(process.env.YOUTUBE_REFRESH_BACKOFF_MS); return Number.isFinite(n) ? n : 1000; };
const BATCH = () => Number(process.env.YOUTUBE_RETENTION_BATCH) || 200;

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function _backoffMs(attempt) {
  const base = BASE_BACKOFF_MS() * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * (BASE_BACKOFF_MS() || 1));
  return base + jitter;
}

// TERMINAL = the OAuth grant is permanently unusable (revoked / expired / invalid_client /
// forbidden) — refresh can never succeed, so treat the user as disconnected. Everything else
// (429, 5xx, network, unknown) is TRANSIENT: retry-worthy, never a reason to wipe on its own.
function _isTerminalRefresh(err) {
  const status = err?.response?.status ?? err?.status;
  const blob = `${JSON.stringify(err?.response?.data ?? '')} ${err?.code ?? ''} ${err?.message ?? ''}`;
  if (/invalid_grant|invalid_token|unauthorized_client|invalid_client|token has been expired or revoked|access_denied|deleted_client/i.test(blob)) {
    return true;
  }
  return status === 401 || status === 403;
}

// Refresh with bounded retries + backoff/jitter. Bails out immediately on a terminal failure.
async function _refreshWithRetry(userId, user) {
  const attempts = REFRESH_RETRIES();
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { await musicProfileService.buildProfile(userId, user); return { ok: true }; }
    catch (err) {
      lastErr = err;
      if (_isTerminalRefresh(err)) return { ok: false, terminal: true, err };
      if (i < attempts - 1) await _sleep(_backoffMs(i));
    }
  }
  return { ok: false, terminal: false, err: lastErr };
}

// Strip the youtube_music rows from a profile's library, recompute the taste footprint from what
// remains (Spotify rows), and persist. Returns the number of rows removed.
async function _purge(profile) {
  const library = profile.library || [];
  const kept = library.filter((t) => t.provider !== 'youtube_music');
  const removed = library.length - kept.length;
  if (!removed) return 0;
  const fp = musicProfileService.recomputeFootprint(kept);
  await MusicProfile.updateOne(
    { userId: profile.userId },
    { $set: { library: kept, topGenres: fp.topGenres, topArtists: fp.topArtists, genreSet: fp.genreSet } },
  );
  return removed;
}

async function processJob() {
  const cutoff = new Date(Date.now() - YOUTUBE_TTL_DAYS() * 24 * 3600 * 1000);
  const hardCutoff = new Date(Date.now() - (YOUTUBE_TTL_DAYS() + YOUTUBE_GRACE_DAYS()) * 24 * 3600 * 1000);
  const profiles = await MusicProfile.find({
    'library.provider': 'youtube_music',
    $or: [{ lastAnalyzed: { $lt: cutoff } }, { lastAnalyzed: null }],
  }).limit(BATCH());

  let refreshed = 0, purged = 0, rowsPurged = 0, deferred = 0;
  for (const profile of profiles) {
    const user = await User.findById(profile.userId);
    const connected = !!user?.youtubeMusicToken?.blob;

    if (connected) {
      const r = await _refreshWithRetry(profile.userId, user);
      if (r.ok) { refreshed += 1; continue; }

      const pastHardDeadline = !profile.lastAnalyzed || new Date(profile.lastAnalyzed) < hardCutoff;
      if (!r.terminal && !pastHardDeadline) {
        // Transient failure, still inside the grace window → keep the data, retry next run.
        console.warn(`[youtubeRetention] transient refresh failure user=${profile.userId} — deferring: ${r.err?.message}`);
        deferred += 1;
        continue;
      }
      console.warn(`[youtubeRetention] purging user=${profile.userId} reason=${r.terminal ? 'terminal' : 'ttl-exceeded'}: ${r.err?.message}`);
    }

    const removed = await _purge(profile);
    if (removed) { purged += 1; rowsPurged += removed; }
  }
  return { refreshed, purged, rowsPurged, deferred };
}

module.exports = { process: processJob, _purge, _isTerminalRefresh };
