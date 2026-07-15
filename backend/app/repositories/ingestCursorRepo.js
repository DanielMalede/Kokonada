// backend/app/repositories/ingestCursorRepo.js
'use strict';

const IngestCursor = require('../models/IngestCursor');

// Durable named offset for resumable background ingestion. Best-effort: a DB hiccup degrades to
// offset 0 / a no-op rather than throwing into the (enhancement) ingestion run.
async function getOffset(name) {
  try {
    const cur = await IngestCursor.findOne({ name }).lean();
    return Number.isFinite(cur?.offset) ? cur.offset : 0;
  } catch { return 0; }
}

async function setOffset(name, offset) {
  try {
    await IngestCursor.updateOne({ name }, { $set: { offset } }, { upsert: true });
    return true;
  } catch { return false; }
}

module.exports = { getOffset, setOffset };
