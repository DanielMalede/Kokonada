'use strict';

const { checkSpotifyLeak, checkSpotifyLeakCached, _resetCache } = require('../app/services/monitoring/spotifyLeakMonitor');
const { spotifyRowSelector } = require('../app/utils/spotifyContent');

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

describe('spotifyLeakMonitor.checkSpotifyLeak', () => {
  it('reports ok=true and zero counts when no spotify rows exist', async () => {
    const res = await checkSpotifyLeak({
      collections: {
        TrackCatalog:   fakeCollection([{ recordingKey: 'youtube:y' }, { recordingKey: 'mbid:m' }]),
        TrackEmbedding: fakeCollection([{ recordingKey: 'mbid:m' }]),
        AudioFeature:   fakeCollection([{ recordingKey: 'youtube:y', spotifyId: null }]),
      },
    });
    expect(res.ok).toBe(true);
    expect(res.total).toBe(0);
    expect(res.counts).toEqual({ TrackCatalog: 0, TrackEmbedding: 0, AudioFeature: 0 });
  });

  it('reports ok=false with per-collection counts and a non-zero total when spotify rows leak', async () => {
    const warn = jest.fn();
    const res = await checkSpotifyLeak({
      collections: {
        TrackCatalog:   fakeCollection([{ recordingKey: 'spotify:a' }, { recordingKey: 'youtube:y' }]),
        TrackEmbedding: fakeCollection([{ recordingKey: 'spotify:a' }]),
        AudioFeature:   fakeCollection([{ recordingKey: 'youtube:y', spotifyId: 'zz' }]),
      },
      logger: { warn, info: jest.fn() },
    });
    expect(res.ok).toBe(false);
    expect(res.counts).toEqual({ TrackCatalog: 1, TrackEmbedding: 1, AudioFeature: 1 });
    expect(res.total).toBe(3);
    expect(warn).toHaveBeenCalled(); // alerts (non-destructive) when a leak is present
  });

  it('uses the shared spotifyRowSelector (regression guard on the query shape)', async () => {
    const spy = { async countDocuments(q) { this.q = q; return 0; }, q: null };
    await checkSpotifyLeak({ collections: { TrackCatalog: spy } });
    expect(spy.q).toEqual(spotifyRowSelector());
  });

  it('spotifyRowSelector uses a case-SENSITIVE anchored regex so the DB query can use the index', () => {
    const sel = spotifyRowSelector();
    const rk = sel.$or.find((c) => c.recordingKey)?.recordingKey;
    expect(rk).toBeInstanceOf(RegExp);
    expect(rk.flags).not.toContain('i');
    expect(rk.test('spotify:abc')).toBe(true);
    expect(rk.test('SPOTIFY:abc')).toBe(false); // real keys are lowercase; case-insensitivity would defeat the index
  });
});

describe('spotifyLeakMonitor.checkSpotifyLeakCached', () => {
  beforeEach(() => _resetCache());

  it('serves a cached result within the TTL (no repeat collection scans), rescans after it expires', async () => {
    let calls = 0;
    const collections = { TrackCatalog: { async countDocuments() { calls++; return 0; } } };
    let t = 1000;
    const now = () => t;

    await checkSpotifyLeakCached({ collections, ttlMs: 5000, now });
    await checkSpotifyLeakCached({ collections, ttlMs: 5000, now }); // within TTL → cached
    expect(calls).toBe(1);

    t = 7000; // past the TTL
    await checkSpotifyLeakCached({ collections, ttlMs: 5000, now });
    expect(calls).toBe(2);
  });
});
