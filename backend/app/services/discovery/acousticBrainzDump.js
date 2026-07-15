// backend/app/services/discovery/acousticBrainzDump.js
'use strict';

const fs = require('fs');
const readline = require('readline');

// Read a bounded batch of AcousticBrainz records from a normalized NDJSON dump (one merged
// low-level+high-level record per line — the shape acousticBrainzFeatures.mapRecord expects). The
// raw CC0 tarball is pre-processed into NDJSON by the (deferred) data-prep step; this reader consumes
// it resumably via a line offset. Wave-1 skips to `offset` by counting lines (O(offset) — acceptable
// for a bounded PoC; Wave 2 swaps in byte-offset seeking). Never throws: a missing/unreadable file or
// a malformed line degrades gracefully so the ingestion run is unaffected.
async function readBatch({ path, offset = 0, limit = 200 } = {}) {
  const records = [];
  if (!path || !fs.existsSync(path) || limit <= 0) return { records, nextOffset: offset, done: true };

  let line = -1;
  let consumed = 0;
  let rl;
  try {
    rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
    for await (const raw of rl) {
      line++;
      if (line < offset) continue;         // skip already-processed lines
      if (consumed >= limit) break;         // batch full — more remain
      consumed++;                           // count EVERY consumed line (incl. blank/malformed) so resume is stable
      const s = raw.trim();
      if (!s) continue;
      try { records.push(JSON.parse(s)); } catch { /* malformed line skipped, still counted */ }
    }
  } catch { /* stream error → return what we have; caller degrades */ }
  finally { if (rl) rl.close(); }

  return { records, nextOffset: offset + consumed, done: consumed < limit };
}

module.exports = { readBatch };
