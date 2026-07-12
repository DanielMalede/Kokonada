'use strict';

const TrackEmbedding = require('../../models/TrackEmbedding');

// Mongo-backed VectorIndex adapter. getMany/upsertMany work on any MongoDB;
// queryNear needs Atlas $vectorSearch and degrades to [] elsewhere — vector
// search is an ENHANCEMENT (MMR falls back to feature distance), never a
// dependency the hot path can die on. queryNear returns RAW cosine ([-1,1]) in
// its `score`, matching fakeVectorIndex so DISCOVERY_MIN_COSINE is meaningful.

const VECTOR_SEARCH_INDEX = () => process.env.ATLAS_VECTOR_INDEX || 'track_embedding_index';

// Atlas cosine vectorSearchScore is normalized to (1+cos)/2; expose RAW cosine so
// queryNear's contract matches fakeVectorIndex and DISCOVERY_MIN_COSINE is meaningful.
function rawCosineFromAtlasScore(s) { return 2 * Number(s) - 1; }

// One-shot observability: queryNear's catch degrades to [] for BOTH "no matches" and
// "index misconfigured/missing" — so a wrong numDimensions/name/path would silently
// turn vector search off with zero signal. Warn ONCE (not per-call, to avoid log spam
// on a deliberately non-Atlas deployment) so the operator can tell them apart. (QA4)
let _warnedVectorSearch = false;

async function upsertMany(docs = []) {
  if (!docs.length) return { upserted: 0 };
  await TrackEmbedding.bulkWrite(
    docs.map(doc => ({
      updateOne: {
        filter: { recordingKey: doc.recordingKey },
        update: {
          $set: {
            recordingKey: doc.recordingKey,
            canonicalKey: doc.canonicalKey ?? null,
            vector: doc.vector,
            dim: doc.vector.length,
            model: doc.model ?? 'v1-deterministic',
            builtAt: new Date(),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return { upserted: docs.length };
}

async function getMany(recordingKeys = []) {
  const out = new Map();
  if (!recordingKeys.length) return out;
  const rows = await TrackEmbedding.find({ recordingKey: { $in: recordingKeys } }).lean();
  for (const row of rows) out.set(row.recordingKey, row.vector);
  return out;
}

async function queryNear(vector, { k = 50, filter = {} } = {}) {
  try {
    const rows = await TrackEmbedding.aggregate([
      {
        $vectorSearch: {
          index: VECTOR_SEARCH_INDEX(),
          path: 'vector',
          queryVector: vector,
          numCandidates: k * 10,
          limit: k,
          ...(Object.keys(filter).length ? { filter } : {}),
        },
      },
      { $project: { recordingKey: 1, canonicalKey: 1, score: { $meta: 'vectorSearchScore' } } },
    ]);
    return rows.map(r => ({ recordingKey: r.recordingKey, canonicalKey: r.canonicalKey, score: rawCosineFromAtlasScore(r.score) }));
  } catch (e) {
    // $vectorSearch unavailable (local Mongo, jest) or index missing → enhancement off.
    if (!_warnedVectorSearch) {
      _warnedVectorSearch = true;
      console.warn(
        `[vectorIndex] $vectorSearch failed once — vector search is OFF, MMR is on ` +
          `feature-distance only. Check the Atlas index "${VECTOR_SEARCH_INDEX()}" ` +
          `(vector/70-dim/cosine) exists and is READY. Cause: ${e?.message ?? e}`
      );
    }
    return [];
  }
}

module.exports = { upsertMany, getMany, queryNear, rawCosineFromAtlasScore };
