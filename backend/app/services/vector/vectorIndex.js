'use strict';

const mongoAdapter = require('./mongoAtlasVectorAdapter');

// The VectorIndex port. Default adapter is Mongo/Atlas; tests and local dev
// inject the in-memory fake via use(). Swapping to Qdrant later = one adapter.
let _adapter = null;

function use(adapter) { _adapter = adapter; }
const _a = () => _adapter ?? mongoAdapter;

const upsertMany = (docs)          => _a().upsertMany(docs);
const getMany    = (recordingKeys) => _a().getMany(recordingKeys);
const queryNear  = (vector, opts)  => _a().queryNear(vector, opts);

module.exports = { use, upsertMany, getMany, queryNear };
