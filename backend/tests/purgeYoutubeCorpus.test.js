'use strict';

const { isYoutubeRow, youtubeSelector, runPurge } = require('../scripts/purgeYoutubeCorpus');

// Tiny Mongo-selector matcher so a fake in-memory collection can evaluate the REAL
// youtubeSelector() (proving the selector filters youtube: in, spotify:/mbid: out).
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

describe('purgeYoutubeCorpus — youtube selector (youtube in, spotify/mbid survive)', () => {
  it('isYoutubeRow flags youtube: recordingKey / uri and spares spotify:/mbid:', () => {
    expect(isYoutubeRow({ recordingKey: 'youtube:abc' })).toBe(true);
    expect(isYoutubeRow({ recordingKey: 'YOUTUBE:abc' })).toBe(true);
    expect(isYoutubeRow({ uri: 'youtube:track:abc' })).toBe(true);
    expect(isYoutubeRow({ recordingKey: 'spotify:x' })).toBe(false);
    expect(isYoutubeRow({ recordingKey: 'mbid:x' })).toBe(false);
    expect(isYoutubeRow({ recordingKey: 'spotify:x', spotifyId: 'z' })).toBe(false); // a spotifyId is not youtube content
  });

  it('youtubeSelector matches only youtube rows under the real Mongo shape', async () => {
    const col = fakeCollection([
      { recordingKey: 'youtube:a' },
      { recordingKey: 'mbid:m', uri: 'youtube:leak' },
      { recordingKey: 'spotify:s', spotifyId: 'x' },
      { recordingKey: 'mbid:clean' },
      { recordingKey: 'spotify:z' },
    ]);
    expect(await col.countDocuments(youtubeSelector())).toBe(2);
  });
});

describe('purgeYoutubeCorpus — runPurge dry-run (default) vs apply', () => {
  const buildCollections = () => ({
    TrackCatalog: fakeCollection([
      { recordingKey: 'youtube:a', uri: 'youtube:a', source: 'library' },
      { recordingKey: 'youtube:b', uri: 'youtube:b', source: 'global' },
      { recordingKey: 'spotify:s', uri: null, source: 'library' },
      { recordingKey: 'mbid:m', uri: null, source: 'global' },
    ]),
    TrackEmbedding: fakeCollection([
      { recordingKey: 'youtube:a' }, { recordingKey: 'mbid:m' },
    ]),
    AudioFeature: fakeCollection([
      { recordingKey: 'youtube:a' },
      { recordingKey: 'spotify:s', spotifyId: 's' },
      { recordingKey: 'mbid:m' },
    ]),
  });

  it('dry-run counts youtube rows, never deletes, reports pool impact + redis keys', async () => {
    const cols = buildCollections();
    const report = await runPurge({
      collections: cols,
      countRedisAfKeys: async () => 3,
      apply: false,
      logger: { log: () => {} },
    });

    expect(report.applied).toBe(false);
    expect(report.collections.TrackCatalog).toMatchObject({ total: 4, youtube: 2, bySource: { library: 1, global: 1 } });
    expect(report.collections.TrackEmbedding).toMatchObject({ total: 2, youtube: 1 });
    expect(report.collections.AudioFeature).toMatchObject({ total: 3, youtube: 1 });
    expect(report.redisAfYoutubeKeys).toBe(3);
    expect(report.poolImpact).toMatchObject({ totalCorpus: 4, youtubeTagged: 2, pctRemoved: 50 });
    // nothing deleted in dry-run
    expect(cols.TrackCatalog.rows).toHaveLength(4);
    expect(cols.AudioFeature.rows).toHaveLength(3);
    expect(report.collections.TrackCatalog.deleted).toBeUndefined();
  });

  it('apply deletes only youtube rows; spotify/mbid survive', async () => {
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
    expect(report.redisAfYoutubeKeys).toBe(3);
    expect(cols.TrackCatalog.rows.map((r) => r.recordingKey).sort()).toEqual(['mbid:m', 'spotify:s']);
    expect(cols.TrackEmbedding.rows.map((r) => r.recordingKey)).toEqual(['mbid:m']);
    expect(cols.AudioFeature.rows.map((r) => r.recordingKey).sort()).toEqual(['mbid:m', 'spotify:s']);
  });
});
