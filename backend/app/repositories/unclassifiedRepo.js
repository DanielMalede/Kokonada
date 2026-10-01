'use strict';

const UnclassifiedTrack = require('../models/UnclassifiedTrack');

// The unclassified pool: tracks that could not be adjudicated (Groq outage) and wait for the
// periodic reclassify worker. Never deleted here without a verdict — except by the provider-content
// clock (expireCreatedBefore, HX-2) — and never placed in `library`.

// Idempotently pool tracks — one row per (userId, track.id). An existing row is left untouched
// so its backoff schedule survives a re-pool. Returns the number of tracks written.
async function addMany(userId, tracks, reason = null, now = Date.now()) {
  const at = new Date(now);
  const ops = (tracks || [])
    .filter((t) => t && t.id)
    .map((t) => ({
      updateOne: {
        filter: { userId, 'track.id': t.id },
        update: { $setOnInsert: { userId, track: t, reason, attempts: 0, createdAt: at, nextAttemptAt: at } },
        upsert: true,
      },
    }));
  if (!ops.length) return 0;
  await UnclassifiedTrack.bulkWrite(ops, { ordered: false });
  return ops.length;
}

// Rows whose next attempt is due (nextAttemptAt <= now), oldest first, bounded.
function dueBatch(limit, now = Date.now()) {
  return UnclassifiedTrack.find({ nextAttemptAt: { $lte: new Date(now) } })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .lean();
}

function remove(_id) {
  return UnclassifiedTrack.deleteOne({ _id });
}

// Defer a row that still couldn't be adjudicated (Groq still down): bump attempts + push out
// the next attempt. Never a delete — deletion only ever follows a positive non-music verdict.
function reschedule(_id, attempts, nextAttemptAt) {
  return UnclassifiedTrack.updateOne(
    { _id },
    { $set: { attempts, nextAttemptAt, lastAttemptAt: new Date() } },
  );
}

// HX-2 retention. A row written before `createdAt` existed has no clock at all. Stamp it with its
// TRUE insert time — the ObjectId's timestamp — never "now", which would grant it a fresh window.
// The pipeline update is safe here and ONLY here: UnclassifiedTrack has no encrypted field for a
// setter to miss, and this file imports no encrypted model (wave4.aadUpdateBinding W4-D76).
async function backfillCreatedAt() {
  const res = await UnclassifiedTrack.updateMany(
    { $or: [{ createdAt: { $exists: false } }, { createdAt: null }] },
    [{ $set: { createdAt: { $toDate: '$_id' } } }],
    { updatePipeline: true },
  );
  return res?.modifiedCount ?? 0;
}

// Pooled rows older than the provider-content cutoff are deleted, verdict or not: the row carries
// a provider's track payload, which may not outlive its window waiting for a classifier.
async function expireCreatedBefore(cutoff) {
  const res = await UnclassifiedTrack.deleteMany({ createdAt: { $lt: cutoff } });
  return res?.deletedCount ?? 0;
}

module.exports = { addMany, dueBatch, remove, reschedule, backfillCreatedAt, expireCreatedBefore };
