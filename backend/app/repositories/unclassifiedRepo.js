'use strict';

const UnclassifiedTrack = require('../models/UnclassifiedTrack');

// The unclassified pool: tracks that could not be adjudicated (Groq outage) and wait for the
// periodic reclassify worker. Never deleted here without a verdict; never placed in `library`.

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

module.exports = { addMany, dueBatch, remove, reschedule };
