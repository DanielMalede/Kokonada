'use strict';

const { cosine } = require('./embedding');

// In-memory VectorIndex with real write→read semantics and brute-force cosine
// queryNear — behavioral parity for tests and local (non-Atlas) development.
function fakeVectorIndex() {
  const store = new Map(); // recordingKey → { vector, canonicalKey }
  return {
    store,
    async upsertMany(docs = []) {
      for (const doc of docs) store.set(doc.recordingKey, { vector: doc.vector, canonicalKey: doc.canonicalKey ?? null });
      return { upserted: docs.length };
    },
    async getMany(recordingKeys = []) {
      const out = new Map();
      for (const key of recordingKeys) {
        const hit = store.get(key);
        if (hit) out.set(key, hit.vector);
      }
      return out;
    },
    async queryNear(vector, { k = 50 } = {}) {
      return [...store.entries()]
        .map(([recordingKey, { vector: v, canonicalKey }]) => ({ recordingKey, canonicalKey, score: cosine(vector, v) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}

module.exports = { fakeVectorIndex };
