// backend/tests/globalIngest.test.js
'use strict';

// Stub the CC0 genre LLM so the DEFAULT (non-injected) path is exercised in one test (guards H2:
// the default must call geminiEngine.inferArtistGenres batched, not a dead musicProfileService path).
jest.mock('../app/services/geminiEngine', () => ({ inferArtistGenres: jest.fn(async () => ({})) }));
const geminiEngine = require('../app/services/geminiEngine');
const globalIngest = require('../app/services/discovery/globalIngest');

const abTrack = (rk, artist = 'A', title = 'T', features = { bpm: 120, energy: 0.5 }) =>
  ({ recordingKey: rk, mbid: rk.replace('mbid:', ''), artist, title, features });

function makeDeps() {
  return {
    mapRecord: jest.fn((rec) => (rec && rec.__track) || null),
    audioFeatureRepo: { upsertMany: jest.fn(async () => ({ upserted: 0 })) },
    ingestGlobal: jest.fn(async (entries) => ({ catalogued: entries.length, enqueued: entries.length })),
    canonicalKeyOf: (t) => `at:${(t.artist || '').toLowerCase()}|${(t.title || '').toLowerCase()}`,
  };
}
// Batched genre contract: names[] -> { name: genres[] }.
const genreStub = () => jest.fn(async (names) => Object.fromEntries((names || []).map(n => [n, ['jazz']])));

describe('globalIngest.runOnce', () => {
  let deps, inferGenres;
  beforeEach(() => { jest.clearAllMocks(); deps = makeDeps(); inferGenres = genreStub(); });

  it('maps records to acousticbrainz AudioFeatures AND provider-agnostic global catalog entries (no platform id)', async () => {
    const rec = { __track: abTrack('mbid:m1', 'Bonobo', 'Kerala', { bpm: 120, danceability: 0.7 }) };
    const res = await globalIngest.runOnce({ records: [rec], inferGenres, deps });

    expect(res).toMatchObject({ ok: true, ingested: 1 });
    const feat = deps.audioFeatureRepo.upsertMany.mock.calls[0][0][0];
    expect(feat).toMatchObject({ recordingKey: 'mbid:m1', source: 'acousticbrainz', bpm: 120, danceability: 0.7 });
    expect(feat.confidence).toBeGreaterThan(0.7);
    expect(feat.confidence).toBeLessThan(1);

    const entry = deps.ingestGlobal.mock.calls[0][0][0];
    expect(entry).toMatchObject({ recordingKey: 'mbid:m1', uri: null, source: 'global', title: 'Kerala', artist: 'Bonobo', genres: ['jazz'] });
    expect(entry.canonicalKey).toBe('at:bonobo|kerala');
    expect(entry).not.toHaveProperty('spotifyId');
  });

  it('DEFAULT genre path (no injected inferGenres) calls geminiEngine.inferArtistGenres ONCE, batched, and flows genres', async () => {
    geminiEngine.inferArtistGenres.mockResolvedValue({ Bonobo: ['downtempo'] });
    const res = await globalIngest.runOnce({ records: [{ __track: abTrack('mbid:m1', 'Bonobo', 'Kerala') }], deps });
    expect(res.ingested).toBe(1);
    expect(geminiEngine.inferArtistGenres).toHaveBeenCalledTimes(1);
    expect(geminiEngine.inferArtistGenres).toHaveBeenCalledWith(['Bonobo']); // batched array, not a raw string
    expect(deps.ingestGlobal.mock.calls[0][0][0].genres).toEqual(['downtempo']);
  });

  it('dedupes by recordingKey and honors the track cap', async () => {
    const recs = [
      { __track: abTrack('mbid:m1') }, { __track: abTrack('mbid:m1') },
      { __track: abTrack('mbid:m2') }, { __track: abTrack('mbid:m3') },
    ];
    const res = await globalIngest.runOnce({ records: recs, inferGenres, cap: 2, deps });
    expect(res.ingested).toBe(2);
    expect(deps.ingestGlobal.mock.calls[0][0].map(e => e.recordingKey)).toEqual(['mbid:m1', 'mbid:m2']);
  });

  it('infers genres in ONE batched call for all unique artists', async () => {
    const recs = [{ __track: abTrack('mbid:m1', 'SameArtist') }, { __track: abTrack('mbid:m2', 'SameArtist') }];
    await globalIngest.runOnce({ records: recs, inferGenres, deps });
    expect(inferGenres).toHaveBeenCalledTimes(1);
    expect(inferGenres).toHaveBeenCalledWith(['SameArtist']);
  });

  it('skips un-servable rows lacking title or artist (no wasted embed)', async () => {
    const recs = [
      { __track: abTrack('mbid:ok', 'A', 'T') },
      { __track: abTrack('mbid:noartist', null, 'T') },
      { __track: abTrack('mbid:notitle', 'A', null) },
    ];
    const res = await globalIngest.runOnce({ records: recs, inferGenres, deps });
    expect(res.ingested).toBe(1);
    expect(deps.ingestGlobal.mock.calls[0][0].map(e => e.recordingKey)).toEqual(['mbid:ok']);
  });

  it('stays genre-safe and ok when genre inference fails', async () => {
    inferGenres.mockRejectedValue(new Error('groq down'));
    const res = await globalIngest.runOnce({ records: [{ __track: abTrack('mbid:m1') }], inferGenres, deps });
    expect(res).toMatchObject({ ok: true, ingested: 1 });
    expect(deps.ingestGlobal.mock.calls[0][0][0].genres).toEqual([]);
  });

  it('skips unmappable records and no-ops (ok:true) on empty input', async () => {
    deps.mapRecord = jest.fn(() => null);
    expect(await globalIngest.runOnce({ records: [{}, {}], inferGenres, deps })).toEqual({ ok: true, ingested: 0, embedded: 0 });
    expect(await globalIngest.runOnce({ records: [], inferGenres, deps })).toEqual({ ok: true, ingested: 0, embedded: 0 });
  });

  it('returns ok:false (NOT a clean empty) when a downstream repo rejects — so the worker can hold the cursor', async () => {
    deps.audioFeatureRepo.upsertMany.mockRejectedValue(new Error('mongo down'));
    await expect(globalIngest.runOnce({ records: [{ __track: abTrack('mbid:m1') }], inferGenres, deps }))
      .resolves.toEqual({ ok: false, ingested: 0, embedded: 0 });
  });
});
