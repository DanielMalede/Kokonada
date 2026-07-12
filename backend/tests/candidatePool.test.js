'use strict';
process.env.NODE_ENV = 'test';
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
const { buildPool } = require('../app/services/selection/candidatePool');

const lib = (i) => ({ id: `t${i}`, provider: 'spotify', name: `S${i}`, artist: `A${i}`, genres: ['pop'], affinity: i, uri: `spotify:track:t${i}` });

describe('candidatePool.buildPool — uncapped', () => {
  it('returns the whole library when it exceeds the old 500 cap', async () => {
    const library = Array.from({ length: 800 }, (_, i) => lib(i));
    const pool = await buildPool({ userId: 'u1', musicProfile: { library, lastAnalyzed: new Date() }, moodKey: 'uplift' });
    expect(pool.length).toBe(800);
  });
});

// A discovery candidate carries an `id` = the FULL recordingKey (e.g. `spotify:<trackId>`),
// NOT a bare Spotify id. Dedup MUST key on canonicalKey (the pool boundary), never on that
// colon-bearing id. attachCanonicalKeys force-recomputes discovery keys, so both tracks below
// share the SAME real canonical identity (same title/artist) and collapse library-first.
describe('candidatePool.buildPool — canonicalKey dedup with recordingKey-shaped discovery ids', () => {
  const libraryTrack = { id: 'lib1', provider: 'spotify', title: 'Same Song', artist: 'Same Artist', genres: ['pop'], affinity: 10, uri: 'spotify:track:lib1' };

  it('collapses a discovery duplicate (id = a full recordingKey) onto the familiar copy by canonicalKey', async () => {
    const discoveryDup = { id: 'spotify:abc', provider: 'spotify', title: 'Same Song', artist: 'Same Artist', uri: 'spotify:track:abc' };
    const pool = await buildPool({
      userId: 'u1',
      musicProfile: { library: [libraryTrack], lastAnalyzed: new Date() },
      moodKey: 'uplift',
      discoveryTracks: [discoveryDup],
    });
    expect(pool).toHaveLength(1);
    expect(pool[0].id).toBe('lib1'); // library-first: the familiar copy owns the identity
  });

  it('keeps a discovery track with a DIFFERENT canonical identity', async () => {
    const discoveryNew = { id: 'spotify:xyz', provider: 'spotify', title: 'Other Song', artist: 'Other Artist', uri: 'spotify:track:xyz' };
    const pool = await buildPool({
      userId: 'u1',
      musicProfile: { library: [libraryTrack], lastAnalyzed: new Date() },
      moodKey: 'uplift',
      discoveryTracks: [discoveryNew],
    });
    expect(pool).toHaveLength(2);
  });
});
