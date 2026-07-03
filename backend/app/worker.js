'use strict';

// Standalone BullMQ worker process. The web dyno (app/index.js) must NEVER run
// workers — Railway runs this as a SEPARATE service (`npm run worker`). Without a
// consumer process the three queues are produced-to but never drained.
//
// override:true mirrors app/index.js so a local .env wins over inherited shell
// vars; in real deployments there is no .env file and platform env vars still win.
require('dotenv').config({ override: true });

const connectDB = require('./config/db');
const { startWorkers } = require('./workers');
const { QUEUES } = require('./queues/definitions');

// Build a single-shot, idempotent shutdown handler bound to the live workers.
// Injectable exit/logger keep it unit-testable without killing the test runner.
function makeShutdown(workers, { logger = console, exit = (code) => process.exit(code) } = {}) {
  let closing = false;
  return async function shutdown(signal) {
    if (closing) return; // a second SIGTERM/SIGINT must not double-close
    closing = true;
    logger.log(`[worker] ${signal} received — closing ${workers.length} worker(s)...`);
    try {
      await Promise.all(workers.map((w) => w.close()));
      logger.log('[worker] all workers closed cleanly');
    } catch (err) {
      logger.error(`[worker] error during shutdown: ${err.message}`);
    }
    exit(0);
  };
}

// Deps are injected so the process wiring is exercised in tests without booting
// real Mongo/BullMQ. Returns { workers, shutdown } on success; on a missing
// REDIS_URL it fails LOUDLY via onFatal (default: exit non-zero) so a
// misconfigured Railway worker service crashes instead of idling silently.
async function runWorker({
  connectDB: connect = connectDB,
  startWorkers: start = startWorkers,
  onFatal = (code) => process.exit(code),
  exit = (code) => process.exit(code),
  logger = console,
} = {}) {
  if (!process.env.REDIS_URL) {
    logger.error(
      '[worker] FATAL: REDIS_URL is not set — no workers started. This process ' +
        'exists only to consume BullMQ queues and is useless without Redis. ' +
        'Set REDIS_URL on the worker service. Exiting non-zero.'
    );
    return onFatal(1);
  }

  await connect();

  const workers = start();
  logger.log(
    `[worker] consuming ${workers.length} queue(s): ${Object.values(QUEUES).join(', ')}`
  );

  const shutdown = makeShutdown(workers, { logger, exit });
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { workers, shutdown };
}

// Only auto-run when invoked directly (`node app/worker.js`), never on require.
if (require.main === module) {
  runWorker().catch((err) => {
    console.error('[worker] fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { runWorker, makeShutdown };
