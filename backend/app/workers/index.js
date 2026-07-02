'use strict';

const { Worker } = require('bullmq');
const { QUEUES, QUEUE_NAMES } = require('../queues/definitions');
const { createConnection } = require('../config/redis');

// Processor registry — grown phase by phase (embeddings and state-vector
// recompute land later). Injectable so tests and the worker entrypoint can
// pass their own map.
const DEFAULT_PROCESSORS = {
  [QUEUES.FEATURE_HYDRATION]: require('./featureHydration.worker').process,
  [QUEUES.STATE_VECTOR_RECOMPUTE]: require('./stateVector.worker').process,
};

function startWorkers(processors = DEFAULT_PROCESSORS) {
  for (const queueName of Object.keys(processors)) {
    if (!QUEUE_NAMES.has(queueName)) {
      throw new Error(`unknown queue "${queueName}"`);
    }
  }
  if (!process.env.REDIS_URL) return [];
  return Object.entries(processors).map(
    ([queueName, processor]) =>
      new Worker(queueName, processor, { connection: createConnection() })
  );
}

module.exports = { startWorkers, DEFAULT_PROCESSORS };
