'use strict';

const TrackEmbedding = require('../../models/TrackEmbedding');
const embeddingSpace = require('./embeddingSpace');

// Mongo-backed VectorIndex adapter. getMany/upsertMany work on any MongoDB;
// queryNear needs Atlas $vectorSearch and degrades to [] elsewhere — vector
// search is an ENHANCEMENT (MMR falls back to feature distance), never a
// dependency the hot path can die on. queryNear returns RAW cosine ([-1,1]) in
// its `score`, matching fakeVectorIndex so DISCOVERY_MIN_COSINE is meaningful.
//
// W4-014: the adapter serves TWO spaces off the same documents — v1 on `vector` and v2 on
// `vectorV2`. It never decides WHICH; `embeddingSpace` does, so the query vector and the index
// path are always chosen by the same resolver (see that module's header for why that matters).

// Atlas cosine vectorSearchScore is normalized to (1+cos)/2; expose RAW cosine so
// queryNear's contract matches fakeVectorIndex and DISCOVERY_MIN_COSINE is meaningful.
function rawCosineFromAtlasScore(s) { return 2 * Number(s) - 1; }

// One-shot observability: queryNear's catch degrades to [] for BOTH "no matches" and
// "index misconfigured/missing" — so a wrong numDimensions/name/path would silently
// turn vector search off with zero signal. Warn ONCE (not per-call, to avoid log spam
// on a deliberately non-Atlas deployment) so the operator can tell them apart. (QA4)
let _warnedVectorSearch = false;
function _resetWarnings() { _warnedVectorSearch = false; }

const isVector = (v) => Array.isArray(v) && v.length > 0;

async function upsertMany(docs = []) {
  if (!docs.length) return { upserted: 0 };
  const v2 = embeddingSpace.V2;
  await TrackEmbedding.bulkWrite(
    docs.map(doc => {
      const $set = {
        recordingKey: doc.recordingKey,
        canonicalKey: doc.canonicalKey ?? null,
        vector: doc.vector,
        dim: doc.vector.length,
        model: doc.model ?? 'v1-deterministic',
        builtAt: new Date(),
      };
      // The v2 triple is written ONLY when a real v2 vector came in. Two consequences, both
      // deliberate: `buildVectorV2` returns null for a track with no evidence at all and a null
      // must never be stored; and a v1-only write (flag off, or a job that ran on an older
      // deployment) must never $unset a v2 vector an earlier dual-write already placed — the
      // dark path can be turned on and off without destroying the backfill.
      if (isVector(doc.vectorV2)) {
        $set[v2.path] = doc.vectorV2;
        $set[v2.dimPath] = doc.vectorV2.length; // derived here, never trusted from the caller
        $set[v2.modelPath] = doc.modelV2 ?? v2.model;
      }
      return { updateOne: { filter: { recordingKey: doc.recordingKey }, update: { $set }, upsert: true } };
    }),
    { ordered: false }
  );
  return { upserted: docs.length };
}

/**
 * @param {string[]} recordingKeys
 * @param {{version?: string}} [opts] which space to read; defaults to v1.
 *
 * A row that has no vector in the REQUESTED space is OMITTED rather than falling back to the
 * other one. MMR reads a missing embedding as "use feature distance", which is honest; handing
 * it a 70-dim v1 vector to compare against a 135-dim v2 one would not be.
 */
async function getMany(recordingKeys = [], { version } = {}) {
  const out = new Map();
  if (!recordingKeys.length) return out;
  const space = embeddingSpace.spaceFor(version);
  const rows = await TrackEmbedding.find({ recordingKey: { $in: recordingKeys } }).lean();
  for (const row of rows) {
    const vec = row[space.path];
    if (!isVector(vec)) continue;
    out.set(row.recordingKey, vec);
  }
  return out;
}

async function queryNear(vector, { k = 50, filter = {}, version } = {}) {
  const space = embeddingSpace.spaceFor(version);
  const indexName = embeddingSpace.indexNameFor(space.version);
  try {
    const rows = await TrackEmbedding.aggregate([
      {
        $vectorSearch: {
          index: indexName,
          path: space.path,
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
          `feature-distance only. Check the Atlas index "${indexName}" ` +
          `(${space.path}/${space.dim}-dim/cosine) exists and is READY. Cause: ${e?.message ?? e}`
      );
    }
    return [];
  }
}

module.exports = { upsertMany, getMany, queryNear, rawCosineFromAtlasScore, _resetWarnings };
