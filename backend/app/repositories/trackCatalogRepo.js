// backend/app/repositories/trackCatalogRepo.js
'use strict';

const TrackCatalog = require('../models/TrackCatalog');

// Anonymous track-metadata catalog access. Upsert unions genres ($addToSet) so a track
// re-seen from another library only ever GAINS genre signal; scalar metadata is last-write.
async function upsertMany(entries = []) {
  const rows = (entries || []).filter(e => e && e.recordingKey);
  if (!rows.length) return { upserted: 0 };
  await TrackCatalog.bulkWrite(
    rows.map(e => ({
      updateOne: {
        filter: { recordingKey: e.recordingKey },
        update: {
          $set: {
            ...(e.canonicalKey != null ? { canonicalKey: e.canonicalKey } : {}),
            ...(e.uri != null ? { uri: e.uri } : {}),
            ...(e.title != null ? { title: e.title } : {}),
            ...(e.artist != null ? { artist: e.artist } : {}),
          },
          ...(Array.isArray(e.genres) && e.genres.length
            ? { $addToSet: { genres: { $each: e.genres } } } : {}),
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return { upserted: rows.length };
}

async function getMany(recordingKeys = []) {
  const out = new Map();
  if (!recordingKeys.length) return out;
  const rows = await TrackCatalog.find({ recordingKey: { $in: recordingKeys } }).lean();
  for (const r of rows) {
    out.set(r.recordingKey, {
      recordingKey: r.recordingKey, canonicalKey: r.canonicalKey ?? null,
      uri: r.uri ?? null, title: r.title ?? null, artist: r.artist ?? null, genres: r.genres ?? [],
    });
  }
  return out;
}

module.exports = { upsertMany, getMany };
