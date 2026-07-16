'use strict';

const { isSpotifyRow, spotifySelector, runPurge } = require('../scripts/purgeSpotifyCorpus');

// Tiny Mongo-selector matcher so a fake in-memory collection can evaluate the REAL
// spotifySelector() (proving the selector filters spotify: in, youtube:/mbid: out).
function matches(row, q) {
  return Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => matches(row, sub));
    if (k === '$and') return v.every((sub) => matches(row, sub));
    const val = row[k];
    if (v instanceof RegExp) return v.test(String(val ?? ''));
    if (v && typeof v === 'object' && '$ne' in v) return val != null && val !== v.$ne;
    return val === v;
  });
}
function fakeCollection(rows) {
  return {
    rows: [...rows],
    async countDocuments(q = {}) { return this.rows.filter((r) => matches(r, q)).length; },
    async deleteMany(q = {}) {
      const before = this.rows.length;
      this.rows = this.rows.filter((r) => !matches(r, q));
      return { deletedCount: before - this.rows.length };
    },
  };
}

describe('purgeSpotifyCorpus — spotify selector (spotify in, youtube/mbid survive)', () => {
  it('isSpotifyRow flags spotify: recordingKey / uri / spotifyId and spares youtube:/mbid:', () => {
    expect(isSpotifyRow({ recordingKey: 'spotify:abc' })).toBe(true);
    expect(isSpotifyRow({ recordingKey: 'SPOTIFY:abc' })).toBe(true);
    expect(isSpotifyRow({ uri: 'spotify:track:abc' })).toBe(true);
    expect(isSpotifyRow({ recordingKey: 'youtube:x', spotifyId: 'abc' })).toBe(true);
    expect(isSpotifyRow({ recordingKey: 'youtube:x' })).toBe(false);
    expect(isSpotifyRow({ recordingKey: 'mbid:x' })).toBe(false);
    expect(isSpotifyRow({ recordingKey: 'mbid:x', spotifyId: null })).toBe(false);
  });

  it('spotifySelector matches only spotify rows under the real Mongo shape', async () => {
    const col = fakeCollection([
      { recordingKey: 'spotify:a' },
      { recordingKey: 'youtube:y', uri: 'spotify:track:leak' },
      { recordingKey: 'mbid:m', spotifyId: 'x' },
      { recordingKey: 'mbid:clean', spotifyId: null },
      { recordingKey: 'youtube:z' },
    ]);
    expect(await col.countDocuments(spotifySelector())).toBe(3);
  });
});

describe('purgeSpotifyCorpus — runPurge dry-run (default) vs apply', () => {
  const buildCollections = () => ({
    TrackCatalog: fakeCollection([
      { recordingKey: 'spotify:a', uri: 'spotify:track:a', source: 'library' },
      { recordingKey: 'spotify:b', uri: 'spotify:track:b', source: 'global' },
      { recordingKey: 'youtube:y', uri: null, source: 'library' },
      { recordingKey: 'mbid:m', uri: null, source: 'global' },
    ]),
    TrackEmbedding: fakeCollection([
      { recordingKey: 'spotify:a' }, { recordingKey: 'youtube:y' },
    ]),
    AudioFeature: fakeCollection([
      { recordingKey: 'spotify:a', spotifyId: 'a' },
      { recordingKey: 'youtube:y', spotifyId: null },
      { recordingKey: 'mbid:m', spotifyId: null },
    ]),
  });

  it('dry-run counts spotify rows, never deletes, reports pool impact + redis keys', async () => {
    const cols = buildCollections();
    const report = await runPurge({
      collections: cols,
      countRedisAfKeys: async () => 3,
      apply: false,
      logger: { log: () => {} },
    });

    expect(report.applied).toBe(false);
    expect(report.collections.TrackCatalog).toMatchObject({ total: 4, spotify: 2, bySource: { library: 1, global: 1 } });
    expect(report.collections.TrackEmbedding).toMatchObject({ total: 2, spotify: 1 });
    expect(report.collections.AudioFeature).toMatchObject({ total: 3, spotify: 1 });
    expect(report.redisAfSpotifyKeys).toBe(3);
    expect(report.poolImpact).toMatchObject({ totalCorpus: 4, spotifyTagged: 2, pctRemoved: 50 });
    // nothing deleted in dry-run
    expect(cols.TrackCatalog.rows).toHaveLength(4);
    expect(cols.AudioFeature.rows).toHaveLength(3);
    expect(report.collections.TrackCatalog.deleted).toBeUndefined();
  });

  it('apply deletes only spotify rows; youtube/mbid survive', async () => {
    const cols = buildCollections();
    const report = await runPurge({
      collections: cols,
      countRedisAfKeys: async () => 0,
      deleteRedisAfKeys: async () => 3,
      apply: true,
      logger: { log: () => {} },
    });

    expect(report.applied).toBe(true);
    expect(report.collections.TrackCatalog.deleted).toBe(2);
    expect(report.redisAfSpotifyKeys).toBe(3);
    expect(cols.TrackCatalog.rows.map((r) => r.recordingKey).sort()).toEqual(['mbid:m', 'youtube:y']);
    expect(cols.TrackEmbedding.rows.map((r) => r.recordingKey)).toEqual(['youtube:y']);
    expect(cols.AudioFeature.rows.map((r) => r.recordingKey).sort()).toEqual(['mbid:m', 'youtube:y']);
  });
});
