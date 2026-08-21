'use strict';

const { cosine } = require('./embedding');
const embeddingSpace = require('./embeddingSpace');

// In-memory VectorIndex with real write→read semantics and brute-force cosine
// queryNear — behavioral parity for tests and local (non-Atlas) development.
//
// W4-014: the fake models BOTH spaces, including the omit-on-missing rule. Almost every
// discovery/pipeline suite runs on this fake, so a fake that quietly ignored `version` would
// green-light exactly the half-flipped cutover the real adapter would fail on — the fake would
// stop being evidence.
function fakeVectorIndex() {
  const store = new Map(); // recordingKey → { vector, vectorV2, canonicalKey }
  const vecOf = (hit, version) => hit?.[embeddingSpace.spaceFor(version).path];
  const isVector = (v) => Array.isArray(v) && v.length > 0;

  return {
    store,
    async upsertMany(docs = []) {
      for (const doc of docs) {
        const prev = store.get(doc.recordingKey);
        store.set(doc.recordingKey, {
          vector: doc.vector,
          // Same non-destructive rule as the Mongo adapter: a v1-only write never erases a v2
          // vector an earlier dual-write left behind.
          vectorV2: isVector(doc.vectorV2) ? doc.vectorV2 : prev?.vectorV2,
          canonicalKey: doc.canonicalKey ?? null,
        });
      }
      return { upserted: docs.length };
    },
    async getMany(recordingKeys = [], { version } = {}) {
      const out = new Map();
      for (const key of recordingKeys) {
        const vec = vecOf(store.get(key), version);
        if (isVector(vec)) out.set(key, vec);
      }
      return out;
    },
    async queryNear(vector, { k = 50, version } = {}) {
      return [...store.entries()]
        .filter(([, hit]) => isVector(vecOf(hit, version)))
        .map(([recordingKey, hit]) => ({ recordingKey, canonicalKey: hit.canonicalKey, score: cosine(vector, vecOf(hit, version)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}

module.exports = { fakeVectorIndex };
