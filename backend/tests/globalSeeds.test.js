// backend/tests/globalSeeds.test.js
'use strict';

jest.mock('../app/models/IngestCursor', () => ({ findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));
const IngestCursor = require('../app/models/IngestCursor');
const seeds = require('../app/services/discovery/globalSeeds');

const L = ['a', 'b', 'c', 'd', 'e'];

describe('globalSeeds.nextBatch (pure rotation)', () => {
  it('returns n items from the offset and advances by n', () => {
    expect(seeds.nextBatch(0, 2, L)).toEqual({ batch: ['a', 'b'], nextOffset: 2 });
    expect(seeds.nextBatch(2, 2, L)).toEqual({ batch: ['c', 'd'], nextOffset: 4 });
  });

  it('wraps around the end of the list', () => {
    expect(seeds.nextBatch(4, 2, L)).toEqual({ batch: ['e', 'a'], nextOffset: 1 });
  });

  it('normalizes an out-of-range or negative offset via modulo', () => {
    expect(seeds.nextBatch(7, 1, L)).toEqual({ batch: ['c'], nextOffset: 3 }); // 7 % 5 = 2
    expect(seeds.nextBatch(-1, 1, L)).toEqual({ batch: ['e'], nextOffset: 0 }); // -1 -> 4
  });

  it('caps n at the list length (one batch never repeats a seed)', () => {
    const r = seeds.nextBatch(0, 99, L);
    expect(r.batch).toEqual(L);
    expect(new Set(r.batch).size).toBe(L.length);
  });

  it('empty list or non-positive n is a safe empty batch', () => {
    expect(seeds.nextBatch(0, 2, [])).toEqual({ batch: [], nextOffset: 0 });
    expect(seeds.nextBatch(0, 0, L)).toEqual({ batch: [], nextOffset: 0 });
  });
});

describe('globalSeeds.allSeeds', () => {
  afterEach(() => { delete process.env.GLOBAL_SEED_PLAYLIST_IDS; });

  it('exposes a non-empty static set of well-formed genre/mood seeds', () => {
    const all = seeds.allSeeds();
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(['genre', 'playlist']).toContain(s.kind);
      if (s.kind === 'genre') expect(typeof s.query).toBe('string');
      if (s.kind === 'playlist') expect(typeof s.playlistId).toBe('string');
    }
    expect(all.some(s => s.kind === 'genre')).toBe(true);
  });

  it('appends playlist seeds from GLOBAL_SEED_PLAYLIST_IDS (comma-separated, trimmed)', () => {
    process.env.GLOBAL_SEED_PLAYLIST_IDS = 'pl1, pl2 ,';
    const all = seeds.allSeeds();
    const pls = all.filter(s => s.kind === 'playlist').map(s => s.playlistId);
    expect(pls).toEqual(expect.arrayContaining(['pl1', 'pl2']));
    expect(pls).not.toContain(''); // trailing empty entry dropped
  });
});

describe('globalSeeds.takeNextBatch (persisted cursor)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    IngestCursor.findOneAndUpdate.mockResolvedValue({ name: 'global-seed', offset: 2 });
    IngestCursor.updateOne.mockResolvedValue({});
  });

  it('reads the persisted offset, returns that batch, and advances the stored cursor', async () => {
    const batch = await seeds.takeNextBatch(2, L);
    expect(batch).toEqual(['c', 'd']);
    // advanced the stored cursor to nextOffset (4)
    expect(IngestCursor.updateOne).toHaveBeenCalledWith(
      { name: 'global-seed' }, { $set: { offset: 4 } }, { upsert: true }
    );
  });

  it('starts at offset 0 when no cursor row exists yet', async () => {
    IngestCursor.findOneAndUpdate.mockResolvedValue(null);
    const batch = await seeds.takeNextBatch(2, L);
    expect(batch).toEqual(['a', 'b']);
    expect(IngestCursor.updateOne).toHaveBeenCalledWith(
      { name: 'global-seed' }, { $set: { offset: 2 } }, { upsert: true }
    );
  });
});
