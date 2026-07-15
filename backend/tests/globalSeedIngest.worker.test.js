// backend/tests/globalSeedIngest.worker.test.js
'use strict';

jest.mock('../app/services/discovery/acousticBrainzDump', () => ({ readBatch: jest.fn() }));
jest.mock('../app/services/discovery/globalIngest', () => ({ runOnce: jest.fn() }));
jest.mock('../app/repositories/ingestCursorRepo', () => ({ getOffset: jest.fn(), setOffset: jest.fn() }));

const { readBatch } = require('../app/services/discovery/acousticBrainzDump');
const globalIngest = require('../app/services/discovery/globalIngest');
const cursorRepo = require('../app/repositories/ingestCursorRepo');
const worker = require('../app/workers/globalSeedIngest.worker');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GLOBAL_SEED_INGEST_ENABLED = 'true';
  process.env.GLOBAL_AB_DUMP_PATH = '/tmp/ab.ndjson';
  cursorRepo.getOffset.mockResolvedValue(10);
  cursorRepo.setOffset.mockResolvedValue(true);
  readBatch.mockResolvedValue({ records: [{ id: 1 }], nextOffset: 12, done: false });
  globalIngest.runOnce.mockResolvedValue({ ingested: 1, embedded: 1 });
});
afterEach(() => { delete process.env.GLOBAL_SEED_INGEST_ENABLED; delete process.env.GLOBAL_AB_DUMP_PATH; delete process.env.GLOBAL_SEED_BATCH; });

describe('globalSeedIngest.worker', () => {
  it('reads the next batch from the cursor, ingests it, and advances the cursor', async () => {
    process.env.GLOBAL_SEED_BATCH = '50';
    const res = await worker.process();
    expect(readBatch).toHaveBeenCalledWith({ path: '/tmp/ab.ndjson', offset: 10, limit: 50 });
    expect(globalIngest.runOnce).toHaveBeenCalledWith({ records: [{ id: 1 }] });
    expect(cursorRepo.setOffset).toHaveBeenCalledWith('global-seed', 12);
    expect(res).toMatchObject({ ingested: 1, embedded: 1, nextOffset: 12, done: false });
  });

  it('wraps the cursor to 0 at EOF so the next run re-scans', async () => {
    readBatch.mockResolvedValue({ records: [], nextOffset: 99, done: true });
    await worker.process();
    expect(cursorRepo.setOffset).toHaveBeenCalledWith('global-seed', 0);
  });

  it('is a DARK no-op when the flag is off', async () => {
    process.env.GLOBAL_SEED_INGEST_ENABLED = 'false';
    expect(await worker.process()).toEqual({ skipped: 'disabled' });
    expect(readBatch).not.toHaveBeenCalled();
    expect(globalIngest.runOnce).not.toHaveBeenCalled();
  });

  it('no-ops when no dump path is configured', async () => {
    delete process.env.GLOBAL_AB_DUMP_PATH;
    expect(await worker.process()).toEqual({ skipped: 'no-dump-path' });
    expect(readBatch).not.toHaveBeenCalled();
  });

  it('never throws — a downstream failure is caught', async () => {
    globalIngest.runOnce.mockRejectedValue(new Error('boom'));
    expect(await worker.process()).toEqual({ skipped: 'error' });
  });
});
