'use strict';

const User = require('../models/User');
const MusicProfile = require('../models/MusicProfile');
const musicPurge = require('../services/musicPurge');
const featureService = require('../services/features/featureService');

// Maintenance runner (replaces the deleted temp _hydrateDriver.js): for one user, PURGE the
// non-music from the library (hard delete; undecidable → pool), then hydrate audio-features
// for the surviving music tracks. Prints `purged=N pooled=N hydrated=N missing=N`; re-run
// until missing=0. Thin orchestration over unit-tested services.
async function runForUser(userId) {
  let youtubeToken = null;
  try {
    const user = await User.findById(userId);
    youtubeToken = user?.getToken?.('youtubeMusicToken')?.accessToken ?? null;
  } catch { youtubeToken = null; }

  const { purged, pooled } = await musicPurge.purgeNonMusic(userId, { youtubeToken, useLLM: true });

  const profile = await MusicProfile.findOne({ userId }).lean();
  const library = profile?.library ?? [];
  const summary = await featureService.hydrate(library);
  const hydrated = summary?.hydrated ?? 0;
  const missing = Math.max(0, (summary?.targeted ?? 0) - hydrated);

  return { purged, pooled, hydrated, missing };
}

// CLI: node app/scripts/classifyAndHydrate.js <userId>  (run via `railway run` against prod).
if (require.main === module) {
  const userId = process.argv[2];
  if (!userId) {
    console.error('usage: node app/scripts/classifyAndHydrate.js <userId>');
    process.exit(1);
  }
  const mongoose = require('mongoose');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const res = await runForUser(userId);
    console.log(`purged=${res.purged} pooled=${res.pooled} hydrated=${res.hydrated} missing=${res.missing}`);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { runForUser };
