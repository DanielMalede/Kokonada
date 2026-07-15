// backend/app/scripts/reembedCorpus.js
'use strict';

// Load env FIRST — before ANY internal module require — mirrors backfillDiscoveryCorpus.js.
if (!process.env.JEST_WORKER_ID) {
  const path = require('path');
  require('dotenv').config({ override: true, path: path.resolve(__dirname, '../../.env') });
}

// One-time migration: re-embed EVERY existing TrackEmbedding row so already-ingested tracks
// (both legacy spotify:/youtube: and the Wave-1 mbid: AcousticBrainz slice) retroactively lose
// the genre-bag dilution the embedding.worker.js fix eliminates going forward — that worker now
// always builds a genre-free vector, so simply re-running EMBEDDING_BUILD for every existing key
// is sufficient; no genresByKey needs threading through here. Resumable-by-nature (idempotent
// upserts keyed by recordingKey); a bad batch is logged, not fatal. Deps injected for testing.
const { enqueue } = require('../queues/queue');
const { QUEUES } = require('../queues/definitions');

// Same footgun-clamp class as backfillDiscoveryCorpus.js's throttle: blank/negative/non-numeric
// all fall back to a safe default rather than silently disabling pacing.
function _throttleDefault() {
  const raw = process.env.REEMBED_THROTTLE_MS;
  const n = Number(raw);
  return (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0) ? 250 : n;
}
function _batchSizeDefault() {
  const raw = process.env.REEMBED_BATCH_SIZE;
  const n = Number(raw);
  return (raw === undefined || raw === '' || !Number.isFinite(n) || n <= 0) ? 200 : Math.floor(n);
}

function assertBootEnv() {
  if (!process.env.MONGO_URI) {
    throw new Error('Bootstrapping failed: MONGO_URI environment variable is missing from the environment or .env file');
  }
}

async function _defaultCursor() {
  const TrackEmbedding = require('../models/TrackEmbedding');
  return TrackEmbedding.find({}, { recordingKey: 1 }).lean().cursor();
}

async function runReembed({
  cursorFactory = _defaultCursor,
  batchSize = _batchSizeDefault(),
  throttleMs = _throttleDefault(),
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
  enqueueFn = enqueue,
} = {}) {
  let scanned = 0, enqueued = 0, batches = 0;
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    const size = batch.length;
    try {
      await enqueueFn(QUEUES.EMBEDDING_BUILD, { recordingKeys: batch });
      enqueued += size;
      batches++;
      console.log(`[reembed] batch ${batches}: enqueued ${size} (running total: ${enqueued}/${scanned})`);
    } catch (err) {
      console.warn(`[reembed] a batch of ${size} failed to enqueue: ${err.message}`);
    }
    batch = [];
    if (throttleMs > 0) await sleep(throttleMs); // paces regardless of success/failure
  };

  const cursor = await cursorFactory();
  for await (const row of cursor) {
    const key = row?.recordingKey;
    if (!key) continue;
    scanned++;
    batch.push(key);
    if (batch.length >= batchSize) await flush();
  }
  await flush(); // final partial batch

  console.log(`[reembed] done — scanned=${scanned} enqueued=${enqueued} batches=${batches}`);
  return { scanned, enqueued, batches };
}

// CLI entrypoint: `node app/scripts/reembedCorpus.js` (env already loaded at the top).
if (require.main === module) {
  try {
    assertBootEnv();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  require('../config/db')().then(runReembed).then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runReembed, assertBootEnv };
