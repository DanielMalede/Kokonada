'use strict';

// purgeYoutubeCorpus.js — ONE-TIME, human-gated elimination of YouTube Content from the global
// standing-data caches (YouTube-ToS containment). It removes rows whose recordingKey/uri is
// `youtube:` from TrackCatalog + TrackEmbedding + AudioFeature, plus the `af:youtube:*` Redis
// feature-cache keys. spotify: rows are handled by scripts/purgeSpotifyCorpus.js; the (mbid:) CC0
// rows are a legitimate shared cache and are left untouched.
//
// DUAL-PURPOSE CAUTION: AudioFeature is also read by the RUNTIME resolver to serve a user's OWN
// youtube tracks. This purge is the containment remediation for the CROSS-USER discovery corpus —
// run it deliberately per the containment runbook, not on a schedule.
//
// SAFETY: --dry-run is the DEFAULT and only reports counts. --apply performs the deletes. This
// script is NOT wired to any automation and MUST be run by a human per the containment runbook.
//
// Usage:
//   node scripts/purgeYoutubeCorpus.js               # dry-run (counts only, no changes)
//   node scripts/purgeYoutubeCorpus.js --apply       # perform the deletes (destructive, irreversible)

// The youtube-row predicate + Mongo selector live in utils/youtubeContent so the purge and the
// standing leak monitor share ONE definition (they must never drift). The runPurge core is
// duplicated (not shared) from purgeSpotifyCorpus.js so the already-reviewed Spotify script is
// never touched by this change.
const { isYoutubeRow, youtubeRowSelector: youtubeSelector } = require('../app/utils/youtubeContent');

// --- pure, testable core ---------------------------------------------------

// Runs the count/report (and, when apply=true, the deletes) over injected collections so it is
// testable without a real Mongo/Redis. `collections` maps a display name → a Mongo-model-like
// object exposing countDocuments(query) and deleteMany(query). Returns a structured report.
async function runPurge({
  collections = {},
  countRedisAfKeys = async () => 0,
  deleteRedisAfKeys = async () => 0,
  apply = false,
  logger = console,
} = {}) {
  const sel = youtubeSelector();
  const report = { applied: !!apply, collections: {}, redisAfYoutubeKeys: 0, poolImpact: {} };

  logger.log(apply
    ? '[purgeYoutubeCorpus] APPLY — deleting YouTube Content from the global caches (irreversible)'
    : '[purgeYoutubeCorpus] DRY RUN — counts only, no changes (pass --apply to delete)');

  for (const [name, col] of Object.entries(collections)) {
    const total   = await col.countDocuments({});
    const youtube = await col.countDocuments(sel); // counted BEFORE any delete
    const entry = { total, youtube };

    // Provenance breakdown for the catalog (the only cache carrying a source enum).
    if (name === 'TrackCatalog') {
      entry.bySource = {
        library: await col.countDocuments({ $and: [sel, { source: 'library' }] }),
        global:  await col.countDocuments({ $and: [sel, { source: 'global' }] }),
      };
    }

    if (apply) {
      entry.deleted = (await col.deleteMany(sel)).deletedCount ?? 0;
    }

    report.collections[name] = entry;
    const sourceStr = entry.bySource ? ` (library=${entry.bySource.library}, global=${entry.bySource.global})` : '';
    logger.log(apply
      ? `  ${name}: deleted ${entry.deleted}/${youtube} youtube row(s) of ${total} total${sourceStr}`
      : `  ${name}: ${youtube} youtube row(s) of ${total} total would be deleted${sourceStr}`);
  }

  report.redisAfYoutubeKeys = apply ? await deleteRedisAfKeys() : await countRedisAfKeys();
  logger.log(apply
    ? `  Redis af:youtube:*: purged ${report.redisAfYoutubeKeys} key(s)`
    : `  Redis af:youtube:*: ${report.redisAfYoutubeKeys} key(s) would be purged`);

  // Discovery-pool-impact estimate: the catalog IS the discoverable pool, so pctRemoved is how
  // much of discovery this purge trims (surfacing whether removal materially shrinks the pool).
  const cat = report.collections.TrackCatalog || { total: 0, youtube: 0 };
  report.poolImpact = {
    totalCorpus:   cat.total,
    youtubeTagged: cat.youtube,
    pctRemoved:    cat.total ? Number(((cat.youtube / cat.total) * 100).toFixed(1)) : 0,
  };
  logger.log(`  Discovery pool impact: ${report.poolImpact.youtubeTagged}/${report.poolImpact.totalCorpus} catalog rows (${report.poolImpact.pctRemoved}%) are YouTube-tagged`);

  return report;
}

// --- CLI wiring (only runs when executed directly; require() is side-effect-free) -------------

function parseArgs(argv = process.argv.slice(2)) {
  return { apply: argv.includes('--apply') };
}

async function scanRedisAfYoutube(redis, { del = false } = {}) {
  if (!redis) return 0;
  let cursor = '0';
  let count = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'af:youtube:*', 'COUNT', 500);
    cursor = next;
    if (keys.length) count += del ? await redis.del(...keys) : keys.length;
  } while (cursor !== '0');
  return count;
}

async function main() {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
  const mongoose = require('mongoose');
  const { connectRedis, getRedis } = require('../app/config/redis');
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) { console.error('Error: MONGO_URI is not set'); process.exit(1); }

  const { apply } = parseArgs();
  if (apply) {
    console.warn('[purgeYoutubeCorpus] WARNING: --apply is DESTRUCTIVE and IRREVERSIBLE. Ensure a backup exists.');
  }

  await mongoose.connect(MONGO_URI);
  await connectRedis().catch(() => {});
  const redis = getRedis();
  try {
    const collections = {
      TrackCatalog:   require('../app/models/TrackCatalog'),
      TrackEmbedding: require('../app/models/TrackEmbedding'),
      AudioFeature:   require('../app/models/AudioFeature'),
    };
    await runPurge({
      collections,
      countRedisAfKeys:  () => scanRedisAfYoutube(redis, { del: false }),
      deleteRedisAfKeys: () => scanRedisAfYoutube(redis, { del: true }),
      apply,
      logger: console,
    });
    console.log(apply ? '[purgeYoutubeCorpus] apply complete.' : '[purgeYoutubeCorpus] dry run complete — no changes made.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('[purgeYoutubeCorpus] fatal:', e.message); process.exit(1); });
}

module.exports = { isYoutubeRow, youtubeSelector, runPurge, parseArgs, scanRedisAfYoutube };
