'use strict';

process.env.NODE_ENV = 'test';

// BullMQ is mocked — these tests exercise the seam (lazy construction, graceful
// degradation without Redis), not BullMQ itself.
jest.mock('bullmq', () => {
  class MockQueue {
    constructor(name, opts) {
      MockQueue.instances.push(this);
      this.name = name;
      this.opts = opts;
      this.add = jest.fn().mockResolvedValue({ id: 'job-1' });
    }
  }
  MockQueue.instances = [];
  class MockWorker {
    constructor(name, processor, opts) {
      MockWorker.instances.push(this);
      this.name = name;
      this.processor = processor;
      this.opts = opts;
    }
  }
  MockWorker.instances = [];
  return { Queue: MockQueue, Worker: MockWorker };
});

jest.mock('ioredis', () => jest.fn());

describe('queues/definitions', () => {
  it('exports the Sprint-1 queue names', () => {
    const { QUEUES } = require('../app/queues/definitions');
    expect(QUEUES.FEATURE_HYDRATION).toBe('feature-hydration');
    expect(QUEUES.EMBEDDING_BUILD).toBe('embedding-build');
    expect(QUEUES.STATE_VECTOR_RECOMPUTE).toBe('state-vector-recompute');
  });
});

describe('queues/queue seam', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.REDIS_URL;
  });

  it('enqueue degrades to a no-op when REDIS_URL is not configured', async () => {
    const { Queue } = require('bullmq');
    const { enqueue } = require('../app/queues/queue');

    const result = await enqueue('feature-hydration', { canonicalKeys: ['a'] });

    expect(result).toEqual({ queued: false, reason: 'redis-unavailable' });
    expect(Queue.instances).toHaveLength(0);
  });

  it('enqueue rejects unknown queue names', async () => {
    const { enqueue } = require('../app/queues/queue');

    await expect(enqueue('not-a-queue', {})).rejects.toThrow(/unknown queue/i);
  });

  it('enqueue lazily constructs one BullMQ queue per name and adds the job', async () => {
    process.env.REDIS_URL = 'redis://example:6379';
    const { Queue } = require('bullmq');
    const { enqueue } = require('../app/queues/queue');

    const first = await enqueue('feature-hydration', { canonicalKeys: ['a'] });
    const second = await enqueue('feature-hydration', { canonicalKeys: ['b'] });

    expect(first).toEqual({ queued: true });
    expect(second).toEqual({ queued: true });
    expect(Queue.instances).toHaveLength(1);
    expect(Queue.instances[0].name).toBe('feature-hydration');
    expect(Queue.instances[0].add).toHaveBeenCalledTimes(2);
    expect(Queue.instances[0].add).toHaveBeenCalledWith(
      'feature-hydration',
      { canonicalKeys: ['a'] },
      expect.any(Object)
    );
  });

  it('scheduleRepeatable adds a repeatable job with the cron pattern', async () => {
    process.env.REDIS_URL = 'redis://example:6379';
    const { Queue } = require('bullmq');
    const { scheduleRepeatable } = require('../app/queues/queue');

    const result = await scheduleRepeatable('state-vector-recompute', '0 4 * * *', {});

    expect(result).toEqual({ scheduled: true });
    const [, , opts] = Queue.instances[0].add.mock.calls[0];
    expect(opts.repeat).toEqual({ pattern: '0 4 * * *' });
  });

  it('scheduleRepeatable degrades to a no-op without REDIS_URL', async () => {
    const { scheduleRepeatable } = require('../app/queues/queue');

    const result = await scheduleRepeatable('state-vector-recompute', '0 4 * * *', {});

    expect(result).toEqual({ scheduled: false, reason: 'redis-unavailable' });
  });
});

describe('config/redis createConnection', () => {
  beforeEach(() => jest.resetModules());

  it('builds a BullMQ-compatible connection (maxRetriesPerRequest: null)', () => {
    const IORedis = require('ioredis');
    const { createConnection } = require('../app/config/redis');

    createConnection();

    expect(IORedis).toHaveBeenCalledTimes(1);
    const [, opts] = IORedis.mock.calls[0];
    expect(opts.maxRetriesPerRequest).toBeNull();
  });
});

describe('workers/index bootstrap', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.REDIS_URL;
  });

  it('requiring the module constructs no workers (no side effects)', () => {
    const { Worker } = require('bullmq');
    require('../app/workers');

    expect(Worker.instances).toHaveLength(0);
  });

  it('startWorkers returns [] without REDIS_URL', () => {
    const { startWorkers } = require('../app/workers');

    expect(startWorkers({ 'feature-hydration': jest.fn() })).toEqual([]);
  });

  it('startWorkers constructs one Worker per registered processor', () => {
    process.env.REDIS_URL = 'redis://example:6379';
    const { Worker } = require('bullmq');
    const { startWorkers } = require('../app/workers');
    const processor = jest.fn();

    const workers = startWorkers({ 'feature-hydration': processor });

    expect(workers).toHaveLength(1);
    expect(Worker.instances[0].name).toBe('feature-hydration');
    expect(Worker.instances[0].processor).toBe(processor);
  });

  it('startWorkers rejects processors for unknown queues', () => {
    process.env.REDIS_URL = 'redis://example:6379';
    const { startWorkers } = require('../app/workers');

    expect(() => startWorkers({ 'not-a-queue': jest.fn() })).toThrow(/unknown queue/i);
  });
});
