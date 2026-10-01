'use strict';

const orchestrator = require('../services/generation/orchestrator');
const shadowBufferRepo = require('../repositories/shadowBufferRepo');
const MusicProfile = require('../models/MusicProfile');
const { withoutYoutube } = require('../services/musicProfileService');

// Part 3 shadow worker: precompiles a live-biometric playlist buffer for a (user, band)
// on a confirmed HR transition, so flipping to Live mode plays instantly. Reuses generateV2
// against the CACHED AudioFeature store — NO live hydration in the hot path (Groq only touches
// the emotion/critic prompt). CRITICAL (§3.5): precompiling records NO serves — serves are
// recorded only when a buffer is actually PLAYED, so unplayed buffers never pollute the
// exposure ledger and re-trigger the saturation Part 1 fixed.
async function process(job) {
  const { userId, bioMoodKey, moodKey = null, provider = null, heartRate = null, activity = null } = job?.data ?? {};
  if (!userId || !bioMoodKey) return { skipped: 'missing-key' };

  // DEC-122 / DEC-040: the same YouTube-free view generation reads (musicProfileService.withoutYoutube).
  const profile = withoutYoutube(await MusicProfile.findOne({ userId }).lean());

  const playlist = await orchestrator.generateV2({
    userId,
    musicProfile: profile ?? {},
    moodKey,
    provider,
    live: { heartRate, activity },
  });

  const stored = await shadowBufferRepo.setBuffer(userId, bioMoodKey, {
    tracks: playlist.merged,
    targets: playlist.targets,
    builtAt: Date.now(),
  });
  return { stored, bioMoodKey, tracks: playlist.merged.length };
}

module.exports = { process };
