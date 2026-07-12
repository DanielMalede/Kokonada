// backend/app/scripts/backfillDiscoveryCorpus.js
'use strict';

// Load env FIRST — before ANY internal module require (corpusIngest, config/db, models, queues) —
// so nothing can evaluate against an undefined process.env (the "MONGO_URI undefined" bootstrap
// failure). The `.env` path is pinned to the backend/ root via __dirname so it resolves correctly
// no matter the caller's cwd. Guarded against the jest worker so unit tests stay hermetic (they
// never run the CLI and manage their own env).
if (!process.env.JEST_WORKER_ID) {
  const path = require('path');
  require('dotenv').config({ override: true, path: path.resolve(__dirname, '../../.env') });
}

// One-time backfill: embed every existing MusicProfile library into the discovery corpus.
// Resumable + fault-tolerant by construction (idempotent upserts; a bad profile is logged, not
// fatal). Option B: keys already in the corpus are skipped (zero wasted Groq). Runs OFF the
// serving path. Deps injected for testing; defaults hit real infra.
const corpusIngest = require('../services/discovery/corpusIngest');

// Default throttle: empty-string and negative both fall back to the safe 250ms so a bulk run
// can never accidentally disable pacing and flood the queue/Groq (undefined/non-numeric too).
function _throttleDefault() {
  const raw = process.env.BACKFILL_THROTTLE_MS;
  const n = Number(raw);
  return (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0) ? 250 : n;
}

// Fail-fast bootstrap check: refuse to start with a clear message rather than loop through 5
// useless MongoDB connection retries when the connection string never resolved.
function assertBootEnv() {
  if (!process.env.MONGO_URI) {
    throw new Error('Bootstrapping failed: MONGO_URI environment variable is missing from the environment or .env file');
  }
}

async function _defaultCursor() {
  const MusicProfile = require('../models/MusicProfile');
  const cursor = MusicProfile.find({}, { library: 1 }).lean().cursor();
  return cursor; // async-iterable
}

// throttleMs paces the embedding enqueue rate so a bulk one-time run does not flood the queue
// (smoothing downstream Groq load in the worker). Injectable sleep keeps tests fast.
async function runBackfill({
  ingest = corpusIngest.backfillLibrary,
  cursorFactory = _defaultCursor,
  throttleMs = _throttleDefault(),
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
} = {}) {
  // catalogued = every valid library track (upserted); embedded = the NEW keys enqueued for
  // embedding; skipped = catalogued − embedded, i.e. keys already in the corpus that Option B
  // (getExistingEmbeddingKeys → vectorIndex.getMany) skipped so we waste zero Groq spend.
  let profiles = 0, catalogued = 0, embedded = 0;
  const cursor = await cursorFactory();
  for await (const p of cursor) {
    profiles++;
    const lib = Array.isArray(p?.library) ? p.library : [];
    if (!lib.length) continue;
    try {
      const r = await ingest(lib);
      const c = r?.catalogued ?? 0, e = r?.enqueued ?? 0;
      catalogued += c; embedded += e;
      console.log(`[backfill] profile ${profiles}: embedding ${e} new, skipped ${c - e} existing `
        + `(running total: embedding ${embedded}, skipped ${catalogued - embedded})`);
    } catch (err) { console.warn(`[backfill] profile ${profiles} skipped: ${err.message}`); }
    if (throttleMs > 0) await sleep(throttleMs);
  }
  const skipped = catalogued - embedded;
  console.log(`[backfill] done — profiles=${profiles} catalogued=${catalogued}. `
    + `Skipped ${skipped} existing tracks, Embedding ${embedded} new tracks.`);
  return { profiles, catalogued, embedded, skipped };
}

// CLI entrypoint: `node app/scripts/backfillDiscoveryCorpus.js` (env already loaded at the top).
// Fail fast on a missing MONGO_URI, then connect + run.
if (require.main === module) {
  try {
    assertBootEnv();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  require('../config/db')().then(runBackfill).then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runBackfill, assertBootEnv };
