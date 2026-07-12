// backend/app/scripts/backfillDiscoveryCorpus.js
'use strict';

// One-time backfill: embed every existing MusicProfile library into the discovery corpus.
// Resumable + fault-tolerant by construction (idempotent upserts; a bad profile is logged,
// not fatal). Runs OFF the serving path. Deps injected for testing; defaults hit real infra.
const corpusIngest = require('../services/discovery/corpusIngest');

// Default throttle: empty-string and negative both fall back to the safe 250ms so a bulk run
// can never accidentally disable pacing and flood the queue/Groq (undefined/non-numeric too).
function _throttleDefault() {
  const raw = process.env.BACKFILL_THROTTLE_MS;
  const n = Number(raw);
  return (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0) ? 250 : n;
}

async function _defaultCursor() {
  const MusicProfile = require('../models/MusicProfile');
  const cursor = MusicProfile.find({}, { library: 1 }).lean().cursor();
  return cursor; // async-iterable
}

// throttleMs paces the embedding enqueue rate so a bulk one-time run does not flood the
// queue (smoothing downstream Groq load in the worker). Injectable sleep keeps tests fast.
async function runBackfill({
  ingest = corpusIngest.ingestLibrary,
  cursorFactory = _defaultCursor,
  throttleMs = _throttleDefault(),
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
} = {}) {
  let profiles = 0, tracks = 0;
  const cursor = await cursorFactory();
  for await (const p of cursor) {
    profiles++;
    const lib = Array.isArray(p?.library) ? p.library : [];
    if (!lib.length) continue;
    try { const r = await ingest(lib); tracks += r?.catalogued ?? 0; }
    catch (e) { console.warn(`[backfill] profile skipped: ${e.message}`); }
    if (throttleMs > 0) await sleep(throttleMs);
  }
  console.warn(`[backfill] done profiles=${profiles} tracks=${tracks}`);
  return { profiles, tracks };
}

// CLI entrypoint: `node app/scripts/backfillDiscoveryCorpus.js` (after DB connect in the caller).
if (require.main === module) {
  require('../config/db')().then(runBackfill).then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runBackfill };
