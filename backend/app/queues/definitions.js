'use strict';

const QUEUES = Object.freeze({
  FEATURE_HYDRATION: 'feature-hydration',
  EMBEDDING_BUILD: 'embedding-build',
  STATE_VECTOR_RECOMPUTE: 'state-vector-recompute',
});

const QUEUE_NAMES = new Set(Object.values(QUEUES));

module.exports = { QUEUES, QUEUE_NAMES };
