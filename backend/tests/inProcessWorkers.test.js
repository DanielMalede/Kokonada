'use strict';

process.env.NODE_ENV = 'test';

// Free-tier deployment: the BullMQ consumers run INSIDE the web service (one Railway
// service, no paid worker service) when RUN_WORKERS_IN_PROCESS=true. These tests pin
// the launcher's flag/REDIS gating and the shared error-handler attachment.

const { startInProcessWorkers, attachWorkerHandlers } = require('../app/workers');

const logger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('startInProcessWorkers', () => {
  const OLD_REDIS = process.env.REDIS_URL;
  const OLD_FLAG = process.env.RUN_WORKERS_IN_PROCESS;
  afterEach(() => {
    if (OLD_REDIS === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = OLD_REDIS;
    if (OLD_FLAG === undefined) delete process.env.RUN_WORKERS_IN_PROCESS; else process.env.RUN_WORKERS_IN_PROCESS = OLD_FLAG;
  });

  it('is a no-op when the flag is off (default dedicated-worker mode)', () => {
    const start = jest.fn();
    expect(startInProcessWorkers({ enabled: false, start, logger: logger() })).toEqual([]);
    expect(start).not.toHaveBeenCalled();
  });

  it('warns and starts nothing when enabled but REDIS_URL is missing', () => {
    delete process.env.REDIS_URL;
    const start = jest.fn();
    const lg = logger();
    expect(startInProcessWorkers({ enabled: true, start, logger: lg })).toEqual([]);
    expect(start).not.toHaveBeenCalled();
    expect(lg.warn).toHaveBeenCalledWith(expect.stringMatching(/REDIS_URL/));
  });

  it('starts workers + attaches error/failed handlers when enabled and REDIS_URL present', () => {
    process.env.REDIS_URL = 'redis://x:6379';
    const w = { on: jest.fn() };
    const start = jest.fn().mockReturnValue([w]);
    const workers = startInProcessWorkers({ enabled: true, start, logger: logger() });
    expect(workers).toEqual([w]);
    expect(w.on.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['error', 'failed']));
  });

  it('reads the RUN_WORKERS_IN_PROCESS env flag by default', () => {
    process.env.REDIS_URL = 'redis://x:6379';
    const start = jest.fn().mockReturnValue([]);
    process.env.RUN_WORKERS_IN_PROCESS = 'false';
    expect(startInProcessWorkers({ start, logger: logger() })).toEqual([]);
    expect(start).not.toHaveBeenCalled();
    process.env.RUN_WORKERS_IN_PROCESS = 'true';
    startInProcessWorkers({ start, logger: logger() });
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('attachWorkerHandlers', () => {
  it('attaches error + failed to each worker that supports .on', () => {
    const w1 = { on: jest.fn() };
    const w2 = { on: jest.fn() };
    attachWorkerHandlers([w1, w2], logger());
    for (const w of [w1, w2]) {
      expect(w.on.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['error', 'failed']));
    }
  });

  it('skips fakes without .on and never throws', () => {
    expect(() => attachWorkerHandlers([{}, null].filter(Boolean), logger())).not.toThrow();
  });

  it('the attached error handler LOGS a transient failure instead of crashing', () => {
    const w = { on: jest.fn() };
    const lg = logger();
    attachWorkerHandlers([w], lg);
    const errHandler = w.on.mock.calls.find((c) => c[0] === 'error')[1];
    expect(() => errHandler(new Error('redis blip'))).not.toThrow();
    expect(lg.error).toHaveBeenCalledWith(expect.stringMatching(/redis blip/));
  });
});
