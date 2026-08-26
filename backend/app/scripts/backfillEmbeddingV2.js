// backend/app/scripts/backfillEmbeddingV2.js
'use strict';

// Load env FIRST — before ANY internal module require — mirrors backfillDiscoveryCorpus.js.
if (!process.env.JEST_WORKER_ID) {
  const path = require('path');
  require('dotenv').config({ override: true, path: path.resolve(__dirname, '../../.env') });
}

// W4-014 · one-time migration: give every existing TrackEmbedding row a `vectorV2`.
//
// WHY THIS RE-ENQUEUES INSTEAD OF COMPUTING VECTORS ITSELF
// The obvious shape for a backfill is to read the features, read the genres, call
// `buildVectorV2` and write the rows directly. That would create a SECOND place that builds a
// stored vector — with its own copy of the `spotify:`/`youtube:` ToS gate, its own genre lookup
// and its own model tag — and a second place is a second thing to drift. The repo already made
// this call once, for the same reason, in `reembedCorpus.js`: re-enqueue every key through
// EMBEDDING_BUILD and let the ONE writer write. That worker now dual-writes behind
// `EMBEDDING_V2_WRITE`, so re-running it over the corpus IS the v2 backfill, and a vector built
// by the backfill is byte-identical to one built by ingestion because it was built by the same
// code path.
//
// ON THE IDF TABLE
// The worker resolves it via `idfStats.peek()`, which caches for 6h, so a long run recomputes
// the table a few times rather than once. That is acceptable and it is a deliberate trade against
// the duplicate-writer above: document frequencies over a near-static catalogue move by O(1/N)
// between refreshes, the genre block is L2-normalised per vector so a uniform weight shift is
// divided straight back out, and what survives is far below the scale at which cosine
// discriminates. Re-running the backfill is idempotent, so any row built against a stale table
// can simply be rebuilt.
//
// RESUMABILITY IS THE FILTER, not a bookkeeping table: the cursor selects rows that have no
// `vectorV2`, so a killed run resumes exactly where it stopped with no state to keep, and a
// completed run scans to zero.
const { enqueue } = require('../queues/queue');
const { QUEUES } = require('../queues/definitions');
const embeddingSpace = require('../services/vector/embeddingSpace');

// Same footgun-clamp class as reembedCorpus.js: blank/negative/non-numeric all fall back to a
// safe default rather than silently disabling pacing.
function _throttleDefault() {
  const raw = process.env.EMBEDDING_V2_BACKFILL_THROTTLE_MS;
  const n = Number(raw);
  return (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0) ? 250 : n;
}
function _batchSizeDefault() {
  const raw = process.env.EMBEDDING_V2_BACKFILL_BATCH_SIZE;
  const n = Number(raw);
  return (raw === undefined || raw === '' || !Number.isFinite(n) || n <= 0) ? 200 : Math.floor(n);
}

/** The resume filter. Exported so the test pins the actual query, not a description of it. */
function _cursorFilter() {
  return { [embeddingSpace.V2.path]: { $exists: false } };
}

function assertBootEnv() {
  if (!process.env.MONGO_URI) {
    throw new Error('Bootstrapping failed: MONGO_URI environment variable is missing from the environment or .env file');
  }
}

async function _defaultCursor() {
  const TrackEmbedding = require('../models/TrackEmbedding');
  return TrackEmbedding.find(_cursorFilter(), { recordingKey: 1 }).lean().cursor();
}

async function runBackfillV2({
  cursorFactory = _defaultCursor,
  batchSize = _batchSizeDefault(),
  throttleMs = _throttleDefault(),
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
  enqueueFn = enqueue,
  requireWriteFlag = true,
} = {}) {
  // Fail FAST rather than fail quietly. Without EMBEDDING_V2_WRITE the worker writes only v1, so
  // the whole corpus would be re-embedded, every row would still have no `vectorV2`, and the run
  // would report a confident "done" having accomplished nothing — the operator would discover it
  // only when the v2 index stayed empty.
  if (requireWriteFlag && !embeddingSpace.writeV2Enabled()) {
    throw new Error('EMBEDDING_V2_WRITE is not enabled — the worker would re-embed the corpus and write no v2 vector. Refusing to run.');
  }

  let scanned = 0, enqueued = 0, batches = 0;
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    const size = batch.length;
    try {
      await enqueueFn(QUEUES.EMBEDDING_BUILD, { recordingKeys: batch });
      enqueued += size;
      batches++;
      console.log(`[embedding-v2-backfill] batch ${batches}: enqueued ${size} (running total: ${enqueued}/${scanned})`);
    } catch (err) {
      console.warn(`[embedding-v2-backfill] a batch of ${size} failed to enqueue: ${err.message}`);
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

  console.log(`[embedding-v2-backfill] done — scanned=${scanned} enqueued=${enqueued} batches=${batches}`);
  return { scanned, enqueued, batches };
}

// CLI entrypoint: `EMBEDDING_V2_WRITE=true node app/scripts/backfillEmbeddingV2.js`
if (require.main === module) {
  try {
    assertBootEnv();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  require('../config/db')().then(() => runBackfillV2()).then(() => process.exit(0))
    .catch(e => { console.error(e.message ?? e); process.exit(1); });
}

module.exports = { runBackfillV2, assertBootEnv, _cursorFilter };
