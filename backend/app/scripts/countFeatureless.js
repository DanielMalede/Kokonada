'use strict';

const MusicProfile = require('../models/MusicProfile');
const AudioFeature = require('../models/AudioFeature');
const { recordingKeyOf } = require('../services/features/featureProvider');

// READ-ONLY verifier for the hydration backfill (a safe companion to classifyAndHydrate.js,
// which WRITES). For one user, reports how many library tracks still lack an AudioFeature doc
// — i.e. `missing` — WITHOUT purging, hydrating, or touching Redis. Zero writes.
//
// It keys each library track with the SAME recordingKeyOf() production uses, then does a
// single Mongo read of the AudioFeature store. A track is "featureless" iff it has no doc
// (matches classifyAndHydrate's "truly featureless": upgrade candidates already have an
// llm doc, so they are not counted). Caveat: the current library may still contain non-music
// tracks a real classify pass would PURGE, so this count is a conservative upper bound —
// `missing=0` here is a definitive "backfill complete"; `missing>0` may include purgeable rows.
async function countForUser(userId) {
  const profile = await MusicProfile.findOne({ userId }).lean();
  const library = profile?.library ?? [];

  // Dedupe by recordingKey exactly as featureService._prep does; drop unkeyable tracks.
  const keys = [];
  const seen = new Set();
  let unkeyable = 0;
  for (const track of library) {
    const key = recordingKeyOf(track);
    if (!key) { unkeyable++; continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  // Single read of the feature store — projection only, .lean(), no cache write-through.
  const rows = keys.length
    ? await AudioFeature.find({ recordingKey: { $in: keys } }, { recordingKey: 1, source: 1 }).lean()
    : [];
  const bySource = { api: 0, llm: 0, other: 0 };
  const found = new Set();
  for (const r of rows) {
    found.add(r.recordingKey);
    if (r.source === 'api') bySource.api++;
    else if (r.source === 'llm') bySource.llm++;
    else bySource.other++;
  }
  const missingKeys = keys.filter((k) => !found.has(k));

  return {
    libraryTotal: library.length,
    uniqueKeyed: keys.length,
    unkeyable,
    withFeatures: found.size,
    measuredApi: bySource.api,
    llmEstimated: bySource.llm,
    otherSource: bySource.other,
    missing: missingKeys.length,
    missingSample: missingKeys.slice(0, 10),
  };
}

// CLI: node app/scripts/countFeatureless.js <userId>  (run via `railway run` against prod).
if (require.main === module) {
  const userId = process.argv[2];
  if (!userId) {
    console.error('usage: node app/scripts/countFeatureless.js <userId>');
    process.exit(1);
  }
  const mongoose = require('mongoose');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const res = await countForUser(userId);
    console.log(
      `libraryTotal=${res.libraryTotal} uniqueKeyed=${res.uniqueKeyed} unkeyable=${res.unkeyable} ` +
      `withFeatures=${res.withFeatures} (api=${res.measuredApi} llm=${res.llmEstimated} other=${res.otherSource}) ` +
      `missing=${res.missing}`
    );
    if (res.missing) console.log('missingSample=', res.missingSample);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { countForUser };
