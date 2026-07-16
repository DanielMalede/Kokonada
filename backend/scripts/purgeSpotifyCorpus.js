'use strict';

// purgeSpotifyCorpus.js — ONE-TIME, human-gated elimination of Spotify Content from the global
// standing-data caches (Spotify-ToS containment, ADR 0011). It removes rows whose recordingKey/uri
// is `spotify:` OR whose spotifyId is set, from TrackCatalog + TrackEmbedding + AudioFeature, plus
// the `af:spotify:*` Redis feature-cache keys. The (youtube:/mbid:) rows are a legitimate shared
// cache and are left untouched.
//
// SAFETY: --dry-run is the DEFAULT and only reports counts. --apply performs the deletes. This
// script is NOT wired to any automation and MUST be run by a human per the containment runbook.
//
// Usage:
//   node scripts/purgeSpotifyCorpus.js               # dry-run (counts only, no changes)
//   node scripts/purgeSpotifyCorpus.js --apply       # perform the deletes (destructive, irreversible)

// The spotify-row predicate + Mongo selector live in utils/spotifyContent so the purge and the
// standing leak monitor share ONE definition (they must never drift).
const { isSpotifyRow, spotifyRowSelector: spotifySelector } = require('../app/utils/spotifyContent');

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
  const sel = spotifySelector();
  const report = { applied: !!apply, collections: {}, redisAfSpotifyKeys: 0, poolImpact: {} };

  logger.log(apply
    ? '[purgeSpotifyCorpus] APPLY — deleting Spotify Content from the global caches (irreversible)'
    : '[purgeSpotifyCorpus] DRY RUN — counts only, no changes (pass --apply to delete)');

  for (const [name, col] of Object.entries(collections)) {
    const total   = await col.countDocuments({});
    const spotify = await col.countDocuments(sel); // counted BEFORE any delete
    const entry = { total, spotify };

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
      ? `  ${name}: deleted ${entry.deleted}/${spotify} spotify row(s) of ${total} total${sourceStr}`
      : `  ${name}: ${spotify} spotify row(s) of ${total} total would be deleted${sourceStr}`);
  }

  report.redisAfSpotifyKeys = apply ? await deleteRedisAfKeys() : await countRedisAfKeys();
  logger.log(apply
    ? `  Redis af:spotify:*: purged ${report.redisAfSpotifyKeys} key(s)`
    : `  Redis af:spotify:*: ${report.redisAfSpotifyKeys} key(s) would be purged`);

  // Discovery-pool-impact estimate: the catalog IS the discoverable pool, so pctRemoved is how
  // much of discovery this purge trims (surfacing whether removal materially shrinks the pool).
  const cat = report.collections.TrackCatalog || { total: 0, spotify: 0 };
  report.poolImpact = {
    totalCorpus:   cat.total,
    spotifyTagged: cat.spotify,
    pctRemoved:    cat.total ? Number(((cat.spotify / cat.total) * 100).toFixed(1)) : 0,
  };
  logger.log(`  Discovery pool impact: ${report.poolImpact.spotifyTagged}/${report.poolImpact.totalCorpus} catalog rows (${report.poolImpact.pctRemoved}%) are Spotify-tagged`);

  return report;
}

// --- CLI wiring (only runs when executed directly; require() is side-effect-free) -------------

function parseArgs(argv = process.argv.slice(2)) {
  return { apply: argv.includes('--apply') };
}

async function scanRedisAfSpotify(redis, { del = false } = {}) {
  if (!redis) return 0;
  let cursor = '0';
  let count = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'af:spotify:*', 'COUNT', 500);
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
    console.warn('[purgeSpotifyCorpus] WARNING: --apply is DESTRUCTIVE and IRREVERSIBLE. Ensure a backup exists.');
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
      countRedisAfKeys:  () => scanRedisAfSpotify(redis, { del: false }),
      deleteRedisAfKeys: () => scanRedisAfSpotify(redis, { del: true }),
      apply,
      logger: console,
    });
    console.log(apply ? '[purgeSpotifyCorpus] apply complete.' : '[purgeSpotifyCorpus] dry run complete — no changes made.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('[purgeSpotifyCorpus] fatal:', e.message); process.exit(1); });
}

module.exports = { isSpotifyRow, spotifySelector, runPurge, parseArgs, scanRedisAfSpotify };
