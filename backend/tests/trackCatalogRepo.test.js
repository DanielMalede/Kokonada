// backend/tests/trackCatalogRepo.test.js
'use strict';

// Adapted to this codebase's model-mock repo-test pattern (audioFeatureRepo / unclassifiedRepo):
// the plan's mongodb-memory-server is not a dependency here, so we mock the Mongoose model and
// assert the operations the repo emits + the hydration it builds — preserving the plan's three
// behaviors: upsert+getMany hydration, genre-union on re-upsert (never shrinks), empty no-op.
jest.mock('../app/models/TrackCatalog', () => ({ bulkWrite: jest.fn(), find: jest.fn() }));

const TrackCatalog = require('../app/models/TrackCatalog');
const repo = require('../app/repositories/trackCatalogRepo');

function mockFind(rows = []) {
  TrackCatalog.find.mockReturnValue({ lean: () => Promise.resolve(rows) });
}

beforeEach(() => {
  jest.clearAllMocks();
  TrackCatalog.bulkWrite.mockResolvedValue({});
  mockFind([]);
});

describe('trackCatalogRepo', () => {
  it('upserts and getMany returns hydrated metadata', async () => {
    await repo.upsertMany([{ recordingKey: 'spotify:t1', canonicalKey: 'at:a|b', uri: 'spotify:track:t1', title: 'B', artist: 'A', genres: ['rock'] }]);

    const op = TrackCatalog.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.filter).toEqual({ recordingKey: 'spotify:t1' });
    expect(op.upsert).toBe(true);
    expect(op.update.$set).toMatchObject({ canonicalKey: 'at:a|b', uri: 'spotify:track:t1', title: 'B', artist: 'A' });

    mockFind([{ recordingKey: 'spotify:t1', canonicalKey: 'at:a|b', uri: 'spotify:track:t1', title: 'B', artist: 'A', genres: ['rock'] }]);
    const map = await repo.getMany(['spotify:t1', 'missing']);
    expect(map.get('spotify:t1')).toMatchObject({ uri: 'spotify:track:t1', title: 'B', artist: 'A', genres: ['rock'] });
    expect(map.has('missing')).toBe(false);
  });

  it('unions genres on re-upsert and never shrinks', async () => {
    await repo.upsertMany([{ recordingKey: 'k', genres: ['rock'] }]);
    await repo.upsertMany([{ recordingKey: 'k', genres: ['indie'], title: 'T2' }]);

    // Union mechanism: each re-upsert appends genres via $addToSet (never $set → never shrinks).
    const firstOp = TrackCatalog.bulkWrite.mock.calls[0][0][0].updateOne;
    const secondOp = TrackCatalog.bulkWrite.mock.calls[1][0][0].updateOne;
    expect(firstOp.update.$addToSet).toEqual({ genres: { $each: ['rock'] } });
    expect(secondOp.update.$addToSet).toEqual({ genres: { $each: ['indie'] } });
    // Scalar metadata is last-write-wins.
    expect(secondOp.update.$set.title).toBe('T2');

    // Hydration reflects the (Mongo-)unioned result.
    mockFind([{ recordingKey: 'k', genres: ['indie', 'rock'], title: 'T2' }]);
    const map = await repo.getMany(['k']);
    expect(map.get('k').genres.sort()).toEqual(['indie', 'rock']);
    expect(map.get('k').title).toBe('T2');
  });

  it('empty input is a no-op', async () => {
    expect(await repo.upsertMany([])).toEqual({ upserted: 0 });
    expect(TrackCatalog.bulkWrite).not.toHaveBeenCalled();
    expect((await repo.getMany([])).size).toBe(0);
    expect(TrackCatalog.find).not.toHaveBeenCalled();
  });
});
