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
