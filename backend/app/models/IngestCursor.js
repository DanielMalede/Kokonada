// backend/app/models/IngestCursor.js
'use strict';
const mongoose = require('mongoose');

// Durable rotation cursor for background ingestion jobs (e.g. the global seed pipeline). Anonymous
// and non-user — a single named counter, no userId/PII — so it is safe under ADR-0008. One row per
// job name; `offset` marks where the next batch resumes so successive scheduled runs advance through
// the seed set instead of re-fetching the same seeds every time.
const ingestCursorSchema = new mongoose.Schema({
  name:   { type: String, required: true, unique: true },
  offset: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('IngestCursor', ingestCursorSchema);
