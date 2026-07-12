// backend/tests/backfillDiscoveryCorpus.test.js
jest.mock('../app/repositories/trackCatalogRepo', () => ({ upsertMany: jest.fn(async () => ({ upserted: 0 })) }));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn(async () => {}) }));
jest.mock('../app/services/vector/vectorIndex', () => ({ getMany: jest.fn(async () => new Map()) }));
jest.mock('../app/services/features/featureService', () => ({ enqueueHydration: jest.fn(async () => ({ queued: true })) }));

const { runBackfill } = require('../app/scripts/backfillDiscoveryCorpus');
const featureService = require('../app/services/features/featureService');

describe('runBackfill', () => {
  it('the default ingest path hydrates AudioFeatures for feature-less tracks', async () => {
    featureService.enqueueHydration.mockClear();
    await runBackfill({
      cursorFactory: async function* () { yield { library: [{ recordingKey: 'a' }] }; },
      sleep: async () => {},
    });
    expect(featureService.enqueueHydration).toHaveBeenCalledWith([{ recordingKey: 'a' }]);
  });

  it('ingests every profile library and tallies totals', async () => {
    const profiles = [
      { library: [{ recordingKey: 'a' }, { recordingKey: 'b' }] },
      { library: [{ recordingKey: 'c' }] },
      { library: [] },
    ];
    const ingested = [];
    const res = await runBackfill({
      ingest: async (lib) => { ingested.push(...lib.map(t => t.recordingKey)); return { catalogued: lib.length, enqueued: lib.length }; },
      cursorFactory: async function* () { for (const p of profiles) yield p; },
      sleep: async () => {},
    });
    expect(res).toEqual({ profiles: 3, tracks: 3 });
    expect(ingested.sort()).toEqual(['a', 'b', 'c']);
  });

  it('a single profile failure does not abort the run', async () => {
    const profiles = [{ library: [{ recordingKey: 'a' }] }, { library: [{ recordingKey: 'b' }] }];
    let n = 0;
    const res = await runBackfill({
      ingest: async (lib) => { if (n++ === 0) throw new Error('one bad profile'); return { catalogued: lib.length }; },
      cursorFactory: async function* () { for (const p of profiles) yield p; },
      sleep: async () => {},
    });
    expect(res.profiles).toBe(2);
  });

  it('throttles the enqueue rate — sleeps once per ingested profile with throttleMs', async () => {
    const profiles = [{ library: [{ recordingKey: 'a' }] }, { library: [{ recordingKey: 'b' }] }];
    const sleep = jest.fn(async () => {});
    await runBackfill({
      ingest: async (lib) => ({ catalogued: lib.length, enqueued: lib.length }),
      cursorFactory: async function* () { for (const p of profiles) yield p; },
      throttleMs: 250,
      sleep,
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('a degenerate BACKFILL_THROTTLE_MS (empty or negative) still paces (falls back to default)', async () => {
    const saved = process.env.BACKFILL_THROTTLE_MS;
    try {
      for (const bad of ['', '-5']) {
        process.env.BACKFILL_THROTTLE_MS = bad;
        const sleep = jest.fn(async () => {});
        await runBackfill({
          ingest: async (lib) => ({ catalogued: lib.length }),
          cursorFactory: async function* () { yield { library: [{ recordingKey: 'a' }] }; },
          sleep,
        });
        expect(sleep).toHaveBeenCalled();
      }
    } finally {
      if (saved === undefined) delete process.env.BACKFILL_THROTTLE_MS;
      else process.env.BACKFILL_THROTTLE_MS = saved;
    }
  });
});
