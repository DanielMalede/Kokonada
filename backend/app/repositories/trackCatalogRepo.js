// backend/app/repositories/trackCatalogRepo.js
'use strict';

const TrackCatalog = require('../models/TrackCatalog');

// Anonymous track-metadata catalog access. Upsert unions genres ($addToSet) so a track
// re-seen from another library only ever GAINS genre signal; scalar metadata is last-write.
// Provenance (`source`) is stamped via $setOnInsert so it is written ONCE on the first insert and
// never mutated afterward — a first-writer-wins rule: a row is 'global' or 'library' by whichever
// path created it, and a later re-upsert from the other path never downgrades/overwrites it.
async function upsertMany(entries = []) {
  const rows = (entries || []).filter(e => e && e.recordingKey);
  if (!rows.length) return { upserted: 0 };
  const ops = rows.map(e => ({
    updateOne: {
      filter: { recordingKey: e.recordingKey },
      update: {
        $set: {
          ...(e.canonicalKey != null ? { canonicalKey: e.canonicalKey } : {}),
          ...(e.uri != null ? { uri: e.uri } : {}),
          ...(e.title != null ? { title: e.title } : {}),
          ...(e.artist != null ? { artist: e.artist } : {}),
        },
        $setOnInsert: { source: e.source === 'global' ? 'global' : 'library' },
        ...(Array.isArray(e.genres) && e.genres.length
          ? { $addToSet: { genres: { $each: e.genres } } } : {}),
      },
      upsert: true,
    },
  }));
  try {
    await TrackCatalog.bulkWrite(ops, { ordered: false });
  } catch (e) {
    // E11000 = a concurrent upsert already wrote this recordingKey; idempotent self-heal. A
    // non-duplicate error is a real failure and must still throw.
    const writeErrors = e.writeErrors ?? [];
    const onlyDuplicates = e.code === 11000
      || (writeErrors.length > 0 && writeErrors.every(w => (w.code ?? w.err?.code) === 11000));
    if (!onlyDuplicates) throw e;
  }
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

// Cache serve-time-resolved Spotify URIs onto EXISTING catalog entries (translate-once). Targeted
// $set of uri by recordingKey; upsert:false so it only ever UPDATES (the key always came FROM the
// catalog via discovery hydration) and never creates stub docs.
async function updateResolvedUris(pairs = []) {
  const rows = (pairs || []).filter(p => p && typeof p.recordingKey === 'string' && p.recordingKey
    && typeof p.uri === 'string' && p.uri);
  if (!rows.length) return { updated: 0 };
  const ops = rows.map(p => ({ updateOne: { filter: { recordingKey: p.recordingKey }, update: { $set: { uri: p.uri } } } }));
  await TrackCatalog.bulkWrite(ops, { ordered: false });
  return { updated: rows.length };
}

// Event-driven self-heal: a reported playback failure nulls the CACHED resolved uri for a TRANSLATED
// entry so the next hydration re-resolves it. NEVER touches a native spotify:-keyed entry — its uri is
// its identity, not a cache; nulling would force a title/artist re-search that could mis-match. Returns
// { invalidated } — false for a native key, an empty/non-string key, a missing entry, or an already-null uri.
async function invalidateResolvedUri(recordingKey) {
  if (typeof recordingKey !== 'string' || !recordingKey || recordingKey.toLowerCase().startsWith('spotify:')) {
    return { invalidated: false }; // native spotify: key (any casing) is identity, not cache — never null
  }
  const res = await TrackCatalog.updateOne({ recordingKey }, { $set: { uri: null } });
  return { invalidated: (res.modifiedCount ?? 0) > 0 };
}

module.exports = { upsertMany, getMany, updateResolvedUris, invalidateResolvedUri };
