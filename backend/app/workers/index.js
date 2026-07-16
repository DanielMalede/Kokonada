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
  [QUEUES.EMBEDDING_BUILD]: require('./embedding.worker').process,
  [QUEUES.BIOMETRIC_BUFFER]: require('./biometricBuffer.worker').process,
  [QUEUES.RECLASSIFY_UNCLASSIFIED]: require('./reclassify.worker').process,
  [QUEUES.GLOBAL_SEED_INGEST]: require('./globalSeedIngest.worker').process,
  [QUEUES.SESSION_TRIM]: require('./sessionTrim.worker').process,
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

// BullMQ Workers are EventEmitters: an unhandled 'error' (a transient Redis blip)
// CRASHES the process. Attach handlers so a hiccup or a failed job is logged, never
// fatal. Guarded so injected test fakes need no emitter surface. Shared by both the
// standalone worker entrypoint and the in-process launcher.
function attachWorkerHandlers(workers, logger = console) {
  for (const w of workers) {
    if (typeof w.on === 'function') {
      w.on('error', (err) => logger.error(`[worker] error: ${err?.message ?? err}`));
      w.on('failed', (job, err) => logger.error(`[worker] job ${job?.id ?? '?'} failed: ${err?.message ?? err}`));
    }
  }
  return workers;
}

// FREE-TIER DEPLOYMENT: run the queue consumers INSIDE the web service instead of a
// separate (paid) Railway worker service. Opt-in via RUN_WORKERS_IN_PROCESS=true. Same
// process ⇒ ENCRYPTION_KEY / MONGO_URI parity is automatic (no cross-process key
// mismatch). Defaults OFF, so a future DEDICATED worker service (app/worker.js) never
// double-runs. `start` is injectable for tests. Returns the live workers (for shutdown).
function startInProcessWorkers({
  logger = console,
  enabled = process.env.RUN_WORKERS_IN_PROCESS === 'true',
  start = startWorkers,
} = {}) {
  if (!enabled) return [];
  if (!process.env.REDIS_URL) {
    logger.warn('[worker] RUN_WORKERS_IN_PROCESS is set but REDIS_URL is missing — no in-process workers started');
    return [];
  }
  const workers = start();
  attachWorkerHandlers(workers, logger);
  logger.log(`[worker] in-process mode: consuming ${workers.length} queue(s): ${Object.values(QUEUES).join(', ')}`);
  return workers;
}

module.exports = { startWorkers, DEFAULT_PROCESSORS, attachWorkerHandlers, startInProcessWorkers };
