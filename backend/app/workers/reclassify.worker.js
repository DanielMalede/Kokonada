'use strict';

const MusicProfile = require('../models/MusicProfile');
const User = require('../models/User');
const musicClassifier = require('../services/musicClassifier');
const unclassifiedRepo = require('../repositories/unclassifiedRepo');
const { recomputeFootprint } = require('../services/musicProfileService');

// Periodic drain of the unclassified pool (§D4). For each DUE row, re-run classification (now
// that Groq may be back): a music verdict PROMOTES the track into the owner's library; a
// non-music verdict HARD-DELETES the pool row; a still-undecidable row is rescheduled with
// exponential backoff — never deleted without a positive verdict.

const RECLASSIFY_BATCH = Number(process.env.RECLASSIFY_BATCH) || 200;
const LIBRARY_CAP = 10_000;
const BASE_BACKOFF_MS = 30 * 60 * 1000;      // 30 min
const MAX_BACKOFF_MS  = 24 * 60 * 60 * 1000; // 24 h

function _backoffMs(attempts) {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)), MAX_BACKOFF_MS);
}

async function _youtubeToken(userId) {
  try {
    const user = await User.findById(userId);
    return user?.getToken?.('youtubeMusicToken')?.accessToken ?? null;
  } catch { return null; }
}

// Append newly-confirmed music tracks to the user's library (dedup by canonicalKey) and
// recompute the taste footprint from the merged set.
async function _promote(userId, tracks) {
  const profile = await MusicProfile.findOne({ userId }).lean();
  const library = profile?.library ?? [];
  const seen = new Set(library.map((t) => t.canonicalKey).filter(Boolean));
  const additions = tracks.filter((t) => !t.canonicalKey || !seen.has(t.canonicalKey));
  if (!additions.length) return;
  const merged = [...library, ...additions].slice(0, LIBRARY_CAP);
  const fp = recomputeFootprint(merged);
  await MusicProfile.updateOne(
    { userId },
    { $set: { library: merged, topGenres: fp.topGenres, topArtists: fp.topArtists, genreSet: fp.genreSet } },
  );
}

async function processJob(job) {
  const limit = job?.data?.limit ?? RECLASSIFY_BATCH;
  const rows = await unclassifiedRepo.dueBatch(limit);
  if (!rows.length) return { promoted: 0, deleted: 0, deferred: 0 };

  const byUser = new Map();
  for (const r of rows) {
    const uid = String(r.userId);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(r);
  }

  let promoted = 0, deleted = 0, deferred = 0;
  for (const [userId, userRows] of byUser) {
    const youtubeToken = await _youtubeToken(userId);
    const { music, nonMusic } = await musicClassifier.classifyTracks(
      userRows.map((r) => r.track),
      { youtubeToken, useLLM: true },
    );
    const musicIds = new Set(music.map((t) => t.id));
    const nonIds   = new Set(nonMusic.map((t) => t.id));

    if (music.length) await _promote(userId, music);

    for (const r of userRows) {
      const id = r.track?.id;
      if (musicIds.has(id))      { await unclassifiedRepo.remove(r._id); promoted++; }
      else if (nonIds.has(id))   { await unclassifiedRepo.remove(r._id); deleted++; }
      else {
        const attempts = (r.attempts ?? 0) + 1;
        await unclassifiedRepo.reschedule(r._id, attempts, new Date(Date.now() + _backoffMs(attempts)));
        deferred++;
      }
    }
  }
  return { promoted, deleted, deferred };
}

module.exports = { process: processJob };
