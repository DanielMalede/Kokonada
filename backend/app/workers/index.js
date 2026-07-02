'use strict';

const { Worker } = require('bullmq');
const { QUEUE_NAMES } = require('../queues/definitions');
const { createConnection } = require('../config/redis');

// Processor registry — filled by later phases (feature hydration, embeddings,
// state-vector recompute). Injectable so tests and the worker entrypoint can
// pass their own map.
const DEFAULT_PROCESSORS = {};

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
