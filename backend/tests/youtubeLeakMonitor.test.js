'use strict';

const { checkYoutubeLeak, checkYoutubeLeakCached, _resetCache } = require('../app/services/monitoring/youtubeLeakMonitor');
const { youtubeRowSelector } = require('../app/utils/youtubeContent');

function matches(row, q) {
  return Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => matches(row, sub));
    const val = row[k];
    if (v instanceof RegExp) return v.test(String(val ?? ''));
    if (v && typeof v === 'object' && '$ne' in v) return val != null && val !== v.$ne;
    return val === v;
  });
}
const fakeCollection = (rows) => ({
  async countDocuments(q = {}) { return rows.filter((r) => matches(r, q)).length; },
});

describe('youtubeLeakMonitor.checkYoutubeLeak', () => {
  it('reports ok=true and zero counts when no youtube rows exist (spotify/mbid rows are ignored)', async () => {
    const res = await checkYoutubeLeak({
      collections: {
        TrackCatalog:   fakeCollection([{ recordingKey: 'spotify:s' }, { recordingKey: 'mbid:m' }]),
        TrackEmbedding: fakeCollection([{ recordingKey: 'mbid:m' }]),
        AudioFeature:   fakeCollection([{ recordingKey: 'mbid:m', spotifyId: null }]),
      },
    });
    expect(res.ok).toBe(true);
    expect(res.total).toBe(0);
    expect(res.counts).toEqual({ TrackCatalog: 0, TrackEmbedding: 0, AudioFeature: 0 });
  });

  it('reports ok=false with per-collection counts and a non-zero total when youtube rows leak', async () => {
    const warn = jest.fn();
    const res = await checkYoutubeLeak({
      collections: {
        TrackCatalog:   fakeCollection([{ recordingKey: 'youtube:y' }, { recordingKey: 'mbid:m' }]),
        TrackEmbedding: fakeCollection([{ recordingKey: 'youtube:y' }]),
        AudioFeature:   fakeCollection([{ recordingKey: 'youtube:y' }]),
      },
      logger: { warn, info: jest.fn() },
    });
    expect(res.ok).toBe(false);
    expect(res.counts).toEqual({ TrackCatalog: 1, TrackEmbedding: 1, AudioFeature: 1 });
    expect(res.total).toBe(3);
    expect(warn).toHaveBeenCalled(); // alerts (non-destructive) when a leak is present
  });

  it('uses the shared youtubeRowSelector (regression guard on the query shape)', async () => {
    const spy = { async countDocuments(q) { this.q = q; return 0; }, q: null };
    await checkYoutubeLeak({ collections: { TrackCatalog: spy } });
    expect(spy.q).toEqual(youtubeRowSelector());
  });

  it('youtubeRowSelector uses a case-SENSITIVE anchored regex so the DB query can use the index', () => {
    const sel = youtubeRowSelector();
    const rk = sel.$or.find((c) => c.recordingKey)?.recordingKey;
    expect(rk).toBeInstanceOf(RegExp);
    expect(rk.flags).not.toContain('i');
    expect(rk.test('youtube:abc')).toBe(true);
    expect(rk.test('YOUTUBE:abc')).toBe(false); // real keys are lowercase; case-insensitivity would defeat the index
  });
});

describe('youtubeLeakMonitor.checkYoutubeLeakCached', () => {
  beforeEach(() => _resetCache());

  it('serves a cached result within the TTL (no repeat collection scans), rescans after it expires', async () => {
    let calls = 0;
    const collections = { TrackCatalog: { async countDocuments() { calls++; return 0; } } };
    let t = 1000;
    const now = () => t;

    await checkYoutubeLeakCached({ collections, ttlMs: 5000, now });
    await checkYoutubeLeakCached({ collections, ttlMs: 5000, now }); // within TTL → cached
    expect(calls).toBe(1);

    t = 7000; // past the TTL
    await checkYoutubeLeakCached({ collections, ttlMs: 5000, now });
    expect(calls).toBe(2);
  });
});
