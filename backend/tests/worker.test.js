'use strict';

process.env.NODE_ENV = 'test';

// The worker entrypoint is dependency-injectable so the process wiring can be
// unit-tested without booting real BullMQ workers, Mongo, or signal handlers.
const { runWorker, makeShutdown } = require('../app/worker');

function silentLogger() {
  return { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
}

describe('runWorker (worker entrypoint)', () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
  const ORIGINAL_ENC_KEY = process.env.ENCRYPTION_KEY;
  const VALID_KEY = 'a'.repeat(64);

  beforeEach(() => { process.env.ENCRYPTION_KEY = VALID_KEY; });

  afterEach(() => {
    if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    if (ORIGINAL_ENC_KEY === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = ORIGINAL_ENC_KEY;
    // runWorker registers real SIGTERM/SIGINT handlers on the success path —
    // strip them so they don't leak across tests / into the runner.
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('with REDIS_URL set: connects Mongo, starts workers, and holds them', async () => {
    process.env.REDIS_URL = 'redis://example:6379';
    const connectDB = jest.fn().mockResolvedValue();
    const w1 = { close: jest.fn().mockResolvedValue() };
    const w2 = { close: jest.fn().mockResolvedValue() };
    const startWorkers = jest.fn().mockReturnValue([w1, w2]);
    const onFatal = jest.fn();

    const { workers } = await runWorker({ connectDB, startWorkers, onFatal, logger: silentLogger() });

    expect(connectDB).toHaveBeenCalledTimes(1);
    expect(startWorkers).toHaveBeenCalledTimes(1);
    expect(workers).toEqual([w1, w2]);
    expect(onFatal).not.toHaveBeenCalled();
  });

  it('without a valid ENCRYPTION_KEY: fires the fatal hook and never connects Mongo (no silent NaN baselines)', async () => {
    process.env.REDIS_URL = 'redis://example:6379';
    delete process.env.ENCRYPTION_KEY;
    const connectDB = jest.fn().mockResolvedValue();
    const startWorkers = jest.fn().mockReturnValue([]);
    const onFatal = jest.fn();
    const logger = silentLogger();

    await runWorker({ connectDB, startWorkers, onFatal, logger });

    expect(onFatal).toHaveBeenCalledWith(1);
    expect(connectDB).not.toHaveBeenCalled();
    expect(startWorkers).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/ENCRYPTION_KEY/));
  });

  it('attaches error + failed handlers to each worker so a transient failure is logged, not fatal', async () => {
    process.env.REDIS_URL = 'redis://example:6379';
    const mk = () => ({ close: jest.fn().mockResolvedValue(), on: jest.fn() });
    const w1 = mk();
    const w2 = mk();
    await runWorker({
      connectDB: jest.fn().mockResolvedValue(),
      startWorkers: jest.fn().mockReturnValue([w1, w2]),
      onFatal: jest.fn(), exit: jest.fn(), logger: silentLogger(),
    });
    for (const w of [w1, w2]) {
      const events = w.on.mock.calls.map((c) => c[0]);
      expect(events).toEqual(expect.arrayContaining(['error', 'failed']));
    }
  });

  it('without REDIS_URL: fires the fatal hook and does NOT connect Mongo or start workers', async () => {
    delete process.env.REDIS_URL;
    const connectDB = jest.fn().mockResolvedValue();
    const startWorkers = jest.fn().mockReturnValue([]);
    const onFatal = jest.fn();
    const logger = silentLogger();

    await runWorker({ connectDB, startWorkers, onFatal, logger });

    expect(onFatal).toHaveBeenCalledWith(1);
    expect(connectDB).not.toHaveBeenCalled();
    expect(startWorkers).not.toHaveBeenCalled();
    // The failure must be loud, not silent.
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/REDIS_URL/));
  });

  it('registers a shutdown handler that closes every worker on SIGTERM', async () => {
    process.env.REDIS_URL = 'redis://example:6379';
    const w1 = { close: jest.fn().mockResolvedValue() };
    const w2 = { close: jest.fn().mockResolvedValue() };
    const { shutdown } = await runWorker({
      connectDB: jest.fn().mockResolvedValue(),
      startWorkers: jest.fn().mockReturnValue([w1, w2]),
      exit: jest.fn(),
      onFatal: jest.fn(),
      logger: silentLogger(),
    });

    await shutdown('SIGTERM');

    expect(w1.close).toHaveBeenCalledTimes(1);
    expect(w2.close).toHaveBeenCalledTimes(1);
  });
});

describe('makeShutdown', () => {
  it('closes every worker exactly once and exits 0 — even if invoked twice (idempotent)', async () => {
    const w1 = { close: jest.fn().mockResolvedValue() };
    const w2 = { close: jest.fn().mockResolvedValue() };
    const exit = jest.fn();
    const shutdown = makeShutdown([w1, w2], { exit, logger: silentLogger() });

    await shutdown('SIGTERM');
    await shutdown('SIGINT');

    expect(w1.close).toHaveBeenCalledTimes(1);
    expect(w2.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
