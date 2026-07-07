'use strict';

jest.mock('../app/models/UnclassifiedTrack', () => ({
  bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 2 }),
  find: jest.fn(),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
}));

const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const repo = require('../app/repositories/unclassifiedRepo');

describe('unclassifiedRepo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('addMany upserts one idempotent row per track (keyed by userId+track.id)', async () => {
    const n = await repo.addMany('u1', [{ id: 't1', provider: 'youtube_music', name: 'a' }, { id: 't2' }], 'ingest');
    expect(n).toBe(2);
    const ops = UnclassifiedTrack.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(ops[0].updateOne.filter).toEqual({ userId: 'u1', 'track.id': 't1' });
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(ops[0].updateOne.update.$setOnInsert).toEqual(
      expect.objectContaining({ userId: 'u1', reason: 'ingest', attempts: 0 }),
    );
  });

  it('addMany skips tracks with no id and no-ops on empty', async () => {
    const n = await repo.addMany('u1', [{ provider: 'youtube_music' }], 'ingest');
    expect(n).toBe(0);
    expect(UnclassifiedTrack.bulkWrite).not.toHaveBeenCalled();
  });

  it('dueBatch queries nextAttemptAt<=now, oldest first, limited', async () => {
    const chain = { sort: jest.fn(() => chain), limit: jest.fn(() => chain), lean: jest.fn().mockResolvedValue([{ _id: 'x' }]) };
    UnclassifiedTrack.find.mockReturnValue(chain);
    const rows = await repo.dueBatch(50, 1000);
    expect(UnclassifiedTrack.find).toHaveBeenCalledWith({ nextAttemptAt: { $lte: new Date(1000) } });
    expect(chain.sort).toHaveBeenCalledWith({ nextAttemptAt: 1 });
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(rows).toEqual([{ _id: 'x' }]);
  });

  it('remove deletes by _id', async () => {
    await repo.remove('abc');
    expect(UnclassifiedTrack.deleteOne).toHaveBeenCalledWith({ _id: 'abc' });
  });

  it('reschedule sets attempts + nextAttemptAt', async () => {
    const when = new Date(5000);
    await repo.reschedule('abc', 3, when);
    expect(UnclassifiedTrack.updateOne).toHaveBeenCalledWith(
      { _id: 'abc' },
      expect.objectContaining({ $set: expect.objectContaining({ attempts: 3, nextAttemptAt: when }) }),
    );
  });
});
