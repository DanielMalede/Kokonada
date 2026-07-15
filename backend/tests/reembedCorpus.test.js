// backend/tests/reembedCorpus.test.js
const { runReembed, assertBootEnv } = require('../app/scripts/reembedCorpus');

describe('runReembed', () => {
  it('batches recordingKeys and enqueues EMBEDDING_BUILD per batch (no genresByKey — the worker fix makes it moot)', async () => {
    const rows = [{ recordingKey: 'a' }, { recordingKey: 'b' }, { recordingKey: 'c' }];
    const enqueued = [];
    const res = await runReembed({
      cursorFactory: async function* () { for (const r of rows) yield r; },
      batchSize: 2,
      enqueueFn: async (queue, payload) => { enqueued.push({ queue, payload }); },
      sleep: async () => {},
    });
    expect(res).toEqual({ scanned: 3, enqueued: 3, batches: 2 });
    expect(enqueued).toEqual([
      { queue: 'embedding-build', payload: { recordingKeys: ['a', 'b'] } },
      { queue: 'embedding-build', payload: { recordingKeys: ['c'] } }, // final partial batch flushed
    ]);
    expect(enqueued.every(e => !('genresByKey' in e.payload))).toBe(true);
  });

  it('skips a row with no recordingKey rather than enqueueing a hole', async () => {
    const res = await runReembed({
      cursorFactory: async function* () { yield { recordingKey: 'a' }; yield {}; yield { recordingKey: null }; yield { recordingKey: 'b' }; },
      batchSize: 10,
      enqueueFn: async () => {},
      sleep: async () => {},
    });
    expect(res.scanned).toBe(2); // only the 2 valid rows counted
  });

  it('a single batch failing to enqueue does not abort the run — later batches still flush', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ recordingKey: `k${i}` }));
    let calls = 0;
    const res = await runReembed({
      cursorFactory: async function* () { for (const r of rows) yield r; },
      batchSize: 2,
      enqueueFn: async () => { calls++; if (calls === 1) throw new Error('redis down'); },
      sleep: async () => {},
    });
    expect(res).toEqual({ scanned: 4, enqueued: 2, batches: 1 }); // first batch (2 keys) failed, second (2 keys) succeeded
  });

  it('throttles once per FLUSHED batch (not per scanned row)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ recordingKey: `k${i}` }));
    const sleep = jest.fn(async () => {});
    await runReembed({
      cursorFactory: async function* () { for (const r of rows) yield r; },
      batchSize: 2,
      enqueueFn: async () => {},
      throttleMs: 100,
      sleep,
    });
    expect(sleep).toHaveBeenCalledTimes(3); // 2+2+1 = 3 flushes for 5 rows at batchSize 2
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it('throttles even when a batch fails to enqueue (paces regardless of outcome)', async () => {
    const sleep = jest.fn(async () => {});
    await runReembed({
      cursorFactory: async function* () { yield { recordingKey: 'a' }; },
      batchSize: 1,
      enqueueFn: async () => { throw new Error('down'); },
      throttleMs: 50,
      sleep,
    });
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it('a degenerate REEMBED_THROTTLE_MS (empty or negative) falls back to the safe default', async () => {
    const saved = process.env.REEMBED_THROTTLE_MS;
    try {
      for (const bad of ['', '-5', 'nope']) {
        process.env.REEMBED_THROTTLE_MS = bad;
        const sleep = jest.fn(async () => {});
        await runReembed({
          cursorFactory: async function* () { yield { recordingKey: 'a' }; },
          batchSize: 1,
          enqueueFn: async () => {},
          sleep,
        });
        expect(sleep).toHaveBeenCalledWith(250);
      }
    } finally {
      if (saved === undefined) delete process.env.REEMBED_THROTTLE_MS; else process.env.REEMBED_THROTTLE_MS = saved;
    }
  });

  it('a degenerate REEMBED_BATCH_SIZE (empty, zero, or negative) falls back to the safe default (200)', async () => {
    const saved = process.env.REEMBED_BATCH_SIZE;
    try {
      for (const bad of ['', '0', '-5', 'nope']) {
        process.env.REEMBED_BATCH_SIZE = bad;
        const rows = Array.from({ length: 3 }, (_, i) => ({ recordingKey: `k${i}` }));
        const res = await runReembed({
          cursorFactory: async function* () { for (const r of rows) yield r; },
          enqueueFn: async () => {},
          sleep: async () => {},
        });
        expect(res.batches).toBe(1); // 3 rows all fit in one default-200 batch
      }
    } finally {
      if (saved === undefined) delete process.env.REEMBED_BATCH_SIZE; else process.env.REEMBED_BATCH_SIZE = saved;
    }
  });

  it('an empty corpus is a clean no-op', async () => {
    const res = await runReembed({
      cursorFactory: async function* () {},
      enqueueFn: async () => {},
      sleep: async () => {},
    });
    expect(res).toEqual({ scanned: 0, enqueued: 0, batches: 0 });
  });
});

describe('reembedCorpus assertBootEnv (fail-fast bootstrap)', () => {
  it('throws a clear error when MONGO_URI is missing', () => {
    const saved = process.env.MONGO_URI;
    delete process.env.MONGO_URI;
    try {
      expect(() => assertBootEnv()).toThrow(
        'Bootstrapping failed: MONGO_URI environment variable is missing from the environment or .env file'
      );
    } finally {
      if (saved === undefined) delete process.env.MONGO_URI; else process.env.MONGO_URI = saved;
    }
  });

  it('passes silently when MONGO_URI is present', () => {
    const saved = process.env.MONGO_URI;
    process.env.MONGO_URI = 'mongodb://localhost:27017/kokonada';
    try {
      expect(() => assertBootEnv()).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env.MONGO_URI; else process.env.MONGO_URI = saved;
    }
  });
});
