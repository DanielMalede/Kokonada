// backend/tests/trackCatalogRepo.test.js
'use strict';

// Adapted to this codebase's model-mock repo-test pattern (audioFeatureRepo / unclassifiedRepo):
// the plan's mongodb-memory-server is not a dependency here, so we mock the Mongoose model and
// assert the operations the repo emits + the hydration it builds — preserving the plan's three
// behaviors: upsert+getMany hydration, genre-union on re-upsert (never shrinks), empty no-op.
jest.mock('../app/models/TrackCatalog', () => ({ bulkWrite: jest.fn(), find: jest.fn(), updateOne: jest.fn() }));

const TrackCatalog = require('../app/models/TrackCatalog');
const repo = require('../app/repositories/trackCatalogRepo');

function mockFind(rows = []) {
  TrackCatalog.find.mockReturnValue({ lean: () => Promise.resolve(rows) });
}

beforeEach(() => {
  jest.clearAllMocks();
  TrackCatalog.bulkWrite.mockResolvedValue({});
  TrackCatalog.updateOne.mockResolvedValue({ modifiedCount: 0 });
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

  it('preserves stored canonicalKey when a re-upsert omits it (no null clobber)', async () => {
    await repo.upsertMany([{ recordingKey: 'k', canonicalKey: 'c1' }]);
    await repo.upsertMany([{ recordingKey: 'k', title: 'meta-only' }]);
    const secondOp = TrackCatalog.bulkWrite.mock.calls[1][0][0].updateOne;
    expect(secondOp.update.$set).not.toHaveProperty('canonicalKey');
    expect(secondOp.update.$set.title).toBe('meta-only');
  });

  it('stamps provenance via $setOnInsert (global path) so it sets on INSERT only — never downgrades an existing row', async () => {
    await repo.upsertMany([{ recordingKey: 'g1', source: 'global', title: 'T' }]);
    const op = TrackCatalog.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.update.$setOnInsert).toEqual({ source: 'global' });
    expect(op.update.$set).not.toHaveProperty('source'); // never in $set, else every re-upsert would clobber
  });

  it('defaults provenance to library when no source is given (existing library ingest unchanged)', async () => {
    await repo.upsertMany([{ recordingKey: 'l1', title: 'T' }]);
    const op = TrackCatalog.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.update.$setOnInsert).toEqual({ source: 'library' });
  });

  it('coerces an unknown source to library (enum guard)', async () => {
    await repo.upsertMany([{ recordingKey: 'x1', source: 'bogus' }]);
    const op = TrackCatalog.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.update.$setOnInsert).toEqual({ source: 'library' });
  });

  it('empty input is a no-op', async () => {
    expect(await repo.upsertMany([])).toEqual({ upserted: 0 });
    expect(TrackCatalog.bulkWrite).not.toHaveBeenCalled();
    expect((await repo.getMany([])).size).toBe(0);
    expect(TrackCatalog.find).not.toHaveBeenCalled();
  });

  it('swallows duplicate-key races (E11000 = a concurrent same-recordingKey upsert already won)', async () => {
    TrackCatalog.bulkWrite.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000, writeErrors: [{ code: 11000 }] })
    );
    await expect(repo.upsertMany([{ recordingKey: 'k', genres: ['rock'] }])).resolves.toEqual({ upserted: 1 });
  });

  it('rethrows real write failures (not E11000)', async () => {
    TrackCatalog.bulkWrite.mockRejectedValue(Object.assign(new Error('network'), { code: 6 }));
    await expect(repo.upsertMany([{ recordingKey: 'k' }])).rejects.toThrow('network');
  });
});

describe('trackCatalogRepo.updateResolvedUris', () => {
  it('emits a targeted $set of uri by recordingKey and never upserts (updates existing only)', async () => {
    const res = await repo.updateResolvedUris([{ recordingKey: 'yt:abc', uri: 'spotify:track:123' }]);
    expect(res).toEqual({ updated: 1 });

    const [ops] = TrackCatalog.bulkWrite.mock.calls[0];
    const op = ops[0].updateOne;
    expect(op.filter).toEqual({ recordingKey: 'yt:abc' });
    expect(op.update).toEqual({ $set: { uri: 'spotify:track:123' } });
    // upsert:false invariant — a recordingKey not already in the catalog must create NO stub doc.
    expect(op.upsert).not.toBe(true);
  });

  it('caches only recordingKey + uri (no user-identifying fields reach the catalog write)', async () => {
    await repo.updateResolvedUris([{ recordingKey: 'yt:abc', uri: 'spotify:track:123' }]);
    const op = TrackCatalog.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(Object.keys(op.update.$set)).toEqual(['uri']);
  });

  it('empty / missing pairs is a no-op that writes nothing', async () => {
    expect(await repo.updateResolvedUris([])).toEqual({ updated: 0 });
    expect(await repo.updateResolvedUris()).toEqual({ updated: 0 });
    expect(TrackCatalog.bulkWrite).not.toHaveBeenCalled();
  });

  it('filters out invalid pairs (missing recordingKey or uri)', async () => {
    const res = await repo.updateResolvedUris([
      { recordingKey: 'yt:ok', uri: 'spotify:track:ok' },
      { uri: 'spotify:track:nokey' },
      { recordingKey: 'yt:nouri' },
      { recordingKey: '', uri: 'spotify:track:empty' },
      null,
    ]);
    expect(res).toEqual({ updated: 1 });
    const ops = TrackCatalog.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter).toEqual({ recordingKey: 'yt:ok' });
  });

  it('propagates a real DB error (caller is fire-and-forget)', async () => {
    TrackCatalog.bulkWrite.mockRejectedValue(new Error('boom'));
    await expect(repo.updateResolvedUris([{ recordingKey: 'k', uri: 'spotify:track:k' }])).rejects.toThrow('boom');
  });
});

describe('trackCatalogRepo.invalidateResolvedUri', () => {
  it('nulls the CACHED uri of a translated (youtube:) entry and reports invalidated:true', async () => {
    TrackCatalog.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const res = await repo.invalidateResolvedUri('youtube:abc');
    expect(res).toEqual({ invalidated: true });
    expect(TrackCatalog.updateOne).toHaveBeenCalledWith({ recordingKey: 'youtube:abc' }, { $set: { uri: null } });
  });

  it('NEVER touches a native spotify:-keyed entry — its uri is identity, not cache', async () => {
    const res = await repo.invalidateResolvedUri('spotify:track:xyz');
    expect(res).toEqual({ invalidated: false });
    expect(TrackCatalog.updateOne).not.toHaveBeenCalled();
  });

  it('a missing entry / already-null uri (modifiedCount 0) reports invalidated:false', async () => {
    TrackCatalog.updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect(await repo.invalidateResolvedUri('youtube:missing')).toEqual({ invalidated: false });
    expect(TrackCatalog.updateOne).toHaveBeenCalledWith({ recordingKey: 'youtube:missing' }, { $set: { uri: null } });
  });

  it('a non-string / empty key is a safe no-op (invalidated:false, no write)', async () => {
    expect(await repo.invalidateResolvedUri('')).toEqual({ invalidated: false });
    expect(await repo.invalidateResolvedUri(null)).toEqual({ invalidated: false });
    expect(await repo.invalidateResolvedUri(undefined)).toEqual({ invalidated: false });
    expect(await repo.invalidateResolvedUri(42)).toEqual({ invalidated: false });
    expect(TrackCatalog.updateOne).not.toHaveBeenCalled();
  });
});
