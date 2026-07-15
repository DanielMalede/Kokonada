// backend/app/workers/globalSeedIngest.worker.js
'use strict';

const { readBatch } = require('../services/discovery/acousticBrainzDump');
const globalIngest = require('../services/discovery/globalIngest');
const cursorRepo = require('../repositories/ingestCursorRepo');

// Consumes the recurring GLOBAL_SEED_INGEST job: read the NEXT bounded batch of CC0 AcousticBrainz
// records from the normalized dump (resuming at the durable cursor), ingest them into the
// provider-agnostic corpus, then advance the cursor. DARK by default: both the schedule (index.js /
// worker.js) and this worker require GLOBAL_SEED_INGEST_ENABLED=true, and a configured dump path.
// Never throws (enhancement contract) — a failure is logged and the job completes.

const CURSOR = 'global-seed';
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const enabled = () => process.env.GLOBAL_SEED_INGEST_ENABLED === 'true';

async function processJob() {
  try {
    if (!enabled()) return { skipped: 'disabled' };
    const path = process.env.GLOBAL_AB_DUMP_PATH;
    if (!path) return { skipped: 'no-dump-path' };

    const limit = num(process.env.GLOBAL_SEED_BATCH, 200);
    const offset = await cursorRepo.getOffset(CURSOR);
    const { records, nextOffset, done } = await readBatch({ path, offset, limit });
    const res = await globalIngest.runOnce({ records });
    // HOLD the cursor on a caught ingest failure (ok:false) so this batch is retried next run rather
    // than silently skipped. Only a clean run advances (or wraps to 0 at EOF to re-scan fresh dumps).
    if (res.ok === false) return { ...res, offset, held: true };
    const advanced = done ? 0 : nextOffset;
    await cursorRepo.setOffset(CURSOR, advanced);
    return { ...res, offset, nextOffset: advanced, done };
  } catch (e) {
    console.warn(`[globalSeedIngest] job skipped: ${e?.message ?? e}`);
    return { skipped: 'error' };
  }
}

module.exports = { process: processJob };
