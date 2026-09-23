'use strict';

const mongoAdapter = require('./mongoAtlasVectorAdapter');

// The VectorIndex port. Default adapter is Mongo/Atlas; tests and local dev
// inject the in-memory fake via use(). Swapping to Qdrant later = one adapter.
let _adapter = null;

function use(adapter) { _adapter = adapter; }
const _a = () => _adapter ?? mongoAdapter;

// `opts` (W4-014: `{version}`) is forwarded verbatim — the port stays a pass-through and never
// decides which embedding space is live; `embeddingSpace` does, at the call site.
const upsertMany = (docs)                => _a().upsertMany(docs);
const getMany    = (recordingKeys, opts) => _a().getMany(recordingKeys, opts);
const queryNear  = (vector, opts)        => _a().queryNear(vector, opts);

module.exports = { use, upsertMany, getMany, queryNear };
