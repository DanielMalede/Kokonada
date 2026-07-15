// backend/tests/prepare-wave1-dump.test.js
'use strict';

const { extractMbid, buildSeedRecord, isServable, decompressorFor } = require('../scripts/prepare-wave1-dump');
const { mapRecord } = require('../app/services/features/acousticBrainzFeatures');

const MBID = 'b1a9c0e9-1111-2222-3333-444455556666';

const highlevelRec = () => ({
  metadata: { tags: { musicbrainz_recordingid: [MBID], artist: ['Bonobo'], title: ['Kerala'] } },
  highlevel: {
    danceability: { all: { danceable: 0.7, not_danceable: 0.3 } },
    mood_happy: { all: { happy: 0.6, not_happy: 0.4 } },
    mood_sad: { all: { sad: 0.2, not_sad: 0.8 } },
    mood_aggressive: { all: { aggressive: 0.3, not_aggressive: 0.7 } },
    mood_party: { all: { party: 0.5, not_party: 0.5 } },
    mood_relaxed: { all: { relaxed: 0.4, not_relaxed: 0.6 } },
    mood_acoustic: { all: { acoustic: 0.65, not_acoustic: 0.35 } },
  },
});
const lowlevelRec = () => ({
  metadata: { tags: { musicbrainz_recordingid: [MBID] } },
  rhythm: { bpm: 120 },
  lowlevel: { average_loudness: 0.8 },
});

describe('prepare-wave1-dump — extractMbid', () => {
  it('reads the MBID from metadata.tags', () => {
    expect(extractMbid(highlevelRec())).toBe(MBID);
  });
  it('falls back to a UUID in the tar entry name', () => {
    expect(extractMbid({}, `highlevel/b1/${MBID}-0.json`)).toBe(MBID);
  });
  it('returns null when neither tags nor filename carry an MBID', () => {
    expect(extractMbid({ metadata: { tags: {} } }, 'notes.txt')).toBeNull();
  });
});

describe('prepare-wave1-dump — buildSeedRecord', () => {
  it('merges high-level moods + low-level rhythm/loudness + tags into the reader shape', () => {
    const seed = buildSeedRecord({ mbid: MBID, highlevelRec: highlevelRec(), lowlevelRec: lowlevelRec() });
    expect(seed.metadata.tags.musicbrainz_recordingid).toEqual([MBID]);
    expect(seed.metadata.tags.artist).toEqual(['Bonobo']);
    expect(seed.rhythm.bpm).toBe(120);
    expect(seed.lowlevel.average_loudness).toBe(0.8);
    expect(seed.highlevel.mood_happy.all.happy).toBe(0.6);
  });
  it('falls back to low-level tags for artist/title when high-level lacks them', () => {
    const hl = highlevelRec(); hl.metadata.tags.artist = undefined; hl.metadata.tags.title = undefined;
    const ll = lowlevelRec(); ll.metadata.tags.artist = ['LL Artist']; ll.metadata.tags.title = ['LL Title'];
    const seed = buildSeedRecord({ mbid: MBID, highlevelRec: hl, lowlevelRec: ll });
    expect(seed.metadata.tags.artist).toEqual(['LL Artist']);
    expect(seed.metadata.tags.title).toEqual(['LL Title']);
  });
});

describe('prepare-wave1-dump — isServable', () => {
  it('accepts a record with mbid + title + artist + a feature (bpm or mood)', () => {
    expect(isServable(buildSeedRecord({ mbid: MBID, highlevelRec: highlevelRec(), lowlevelRec: lowlevelRec() }))).toBe(true);
  });
  it('rejects a record missing artist/title, or with no feature signal', () => {
    const noArtist = highlevelRec(); noArtist.metadata.tags.artist = undefined;
    expect(isServable(buildSeedRecord({ mbid: MBID, highlevelRec: noArtist, lowlevelRec: lowlevelRec() }))).toBe(false);
    const bare = { metadata: { tags: { musicbrainz_recordingid: [MBID], artist: ['A'], title: ['T'] } }, rhythm: {}, lowlevel: {}, highlevel: {} };
    expect(isServable(bare)).toBe(false); // no bpm and no mood models
  });
});

describe('prepare-wave1-dump — output is consumable by the ingest reader (round-trip)', () => {
  it('a merged seed record maps cleanly through acousticBrainzFeatures.mapRecord', () => {
    const seed = buildSeedRecord({ mbid: MBID, highlevelRec: highlevelRec(), lowlevelRec: lowlevelRec() });
    const mapped = mapRecord(seed);
    expect(mapped.recordingKey).toBe(`mbid:${MBID}`);
    expect(mapped.artist).toBe('Bonobo');
    expect(mapped.title).toBe('Kerala');
    expect(mapped.features.bpm).toBe(120);
    expect(mapped.features.danceability).toBeCloseTo(0.7, 5);
    expect(mapped.features.acousticness).toBeCloseTo(0.65, 5);
    expect(Number.isFinite(mapped.features.loudness)).toBe(true);
  });
});

describe('prepare-wave1-dump — decompressorFor', () => {
  it('maps .zst / .gz to a stream, plain .tar to null, and .bz2 to a clear error', () => {
    expect(typeof decompressorFor('x.tar.zst').pipe).toBe('function');
    expect(typeof decompressorFor('x.tar.gz').pipe).toBe('function');
    expect(decompressorFor('x.tar')).toBeNull();
    expect(() => decompressorFor('x.tar.bz2')).toThrow(/unbzip2-stream/);
  });
});
