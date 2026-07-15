// backend/tests/globalIngest.test.js
'use strict';

const globalIngest = require('../app/services/discovery/globalIngest');

const abTrack = (rk, artist = 'A', title = 'T', features = { bpm: 120, energy: 0.5 }) =>
  ({ recordingKey: rk, mbid: rk.replace('mbid:', ''), artist, title, features });

function makeDeps() {
  return {
    // mapRecord passthrough for tests: the record carries its mapped track under __track.
    mapRecord: jest.fn((rec) => (rec && rec.__track) || null),
    audioFeatureRepo: { upsertMany: jest.fn(async () => ({ upserted: 0 })) },
    ingestGlobal: jest.fn(async (entries) => ({ catalogued: entries.length, enqueued: entries.length })),
    canonicalKeyOf: (t) => `at:${(t.artist || '').toLowerCase()}|${(t.title || '').toLowerCase()}`,
  };
}

describe('globalIngest.runOnce', () => {
  let deps, inferGenres;
  beforeEach(() => { deps = makeDeps(); inferGenres = jest.fn(async () => ['jazz']); });

  it('maps records to acousticbrainz AudioFeatures AND provider-agnostic global catalog entries (no platform id)', async () => {
    const rec = { __track: abTrack('mbid:m1', 'Bonobo', 'Kerala', { bpm: 120, danceability: 0.7 }) };
    const res = await globalIngest.runOnce({ records: [rec], inferGenres, deps });

    expect(res).toMatchObject({ ingested: 1 });
    const feat = deps.audioFeatureRepo.upsertMany.mock.calls[0][0][0];
    expect(feat).toMatchObject({ recordingKey: 'mbid:m1', source: 'acousticbrainz', bpm: 120, danceability: 0.7 });
    expect(feat.confidence).toBeGreaterThan(0.7);
    expect(feat.confidence).toBeLessThan(1);

    const entry = deps.ingestGlobal.mock.calls[0][0][0];
    expect(entry).toMatchObject({ recordingKey: 'mbid:m1', uri: null, source: 'global', title: 'Kerala', artist: 'Bonobo', genres: ['jazz'] });
    expect(entry.canonicalKey).toBe('at:bonobo|kerala');
    expect(entry).not.toHaveProperty('spotifyId'); // provider-agnostic: no platform id ever
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

  it('infers genres once per unique artist (batch-cached, CC0 LLM path)', async () => {
    const recs = [{ __track: abTrack('mbid:m1', 'SameArtist') }, { __track: abTrack('mbid:m2', 'SameArtist') }];
    await globalIngest.runOnce({ records: recs, inferGenres, deps });
    expect(inferGenres).toHaveBeenCalledTimes(1);
  });

  it('stays genre-safe and never throws when genre inference fails', async () => {
    inferGenres.mockRejectedValue(new Error('groq down'));
    const res = await globalIngest.runOnce({ records: [{ __track: abTrack('mbid:m1') }], inferGenres, deps });
    expect(res.ingested).toBe(1);
    expect(deps.ingestGlobal.mock.calls[0][0][0].genres).toEqual([]);
  });

  it('skips unmappable records and no-ops on empty input', async () => {
    deps.mapRecord = jest.fn(() => null);
    expect(await globalIngest.runOnce({ records: [{}, {}], inferGenres, deps })).toEqual({ ingested: 0, embedded: 0 });
    expect(await globalIngest.runOnce({ records: [], inferGenres, deps })).toEqual({ ingested: 0, embedded: 0 });
  });

  it('never throws when a downstream repo rejects', async () => {
    deps.audioFeatureRepo.upsertMany.mockRejectedValue(new Error('mongo down'));
    await expect(globalIngest.runOnce({ records: [{ __track: abTrack('mbid:m1') }], inferGenres, deps }))
      .resolves.toEqual({ ingested: 0, embedded: 0 });
  });
});
