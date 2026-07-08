'use strict';

process.env.NODE_ENV = 'test';
process.env.RECCOBEATS_URL = 'https://recco.example';

jest.mock('axios');
const axios = require('axios');

const adapter = require('../app/services/features/reccoBeatsAdapter');

const sp = (id) => ({ provider: 'spotify', id, title: `Song ${id}`, artist: 'Artist' });

function apiItem(spotifyId, overrides = {}) {
  return {
    href: `https://open.spotify.com/track/${spotifyId}`,
    tempo: 120, energy: 0.7, valence: 0.6, acousticness: 0.2, danceability: 0.65, loudness: -7,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('reccoBeatsAdapter.supports', () => {
  it('supports only tracks with a resolvable Spotify id', () => {
    expect(adapter.supports(sp('a'))).toBe(true);
    expect(adapter.supports({ uri: 'spotify:track:b' })).toBe(true);
    expect(adapter.supports({ provider: 'youtube_music', id: 'v1' })).toBe(false);
  });
});

describe('reccoBeatsAdapter.getFeatures', () => {
  it('fetches features by Spotify id and clamps them into store shape', async () => {
    axios.get.mockResolvedValue({ data: { content: [apiItem('a', { tempo: 400 })] } });

    const results = await adapter.getFeatures([sp('a')]);

    expect(results).toHaveLength(1);
    expect(results[0].recordingKey).toBe('spotify:a');
    expect(results[0].source).toBe('api');
    expect(results[0].confidence).toBe(1);
    expect(results[0].features.bpm).toBe(260); // clamped, not trusted
    expect(results[0].features.energy).toBe(0.7);
  });

  it('splits requests into batches of RECCOBEATS_BATCH ids', async () => {
    axios.get.mockResolvedValue({ data: { content: [] } });
    const tracks = Array.from({ length: 85 }, (_, i) => sp(`t${i}`));

    await adapter.getFeatures(tracks);

    expect(axios.get).toHaveBeenCalledTimes(3); // 40 + 40 + 5
    const firstIds = axios.get.mock.calls[0][1].params.ids.split(',');
    expect(firstIds).toHaveLength(40);
  });

  it('retries 429 responses via withRetry, then succeeds', async () => {
    const rateLimited = Object.assign(new Error('429'), {
      response: { status: 429, headers: { 'retry-after': '0' } },
    });
    axios.get
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ data: { content: [apiItem('a')] } });

    const results = await adapter.getFeatures([sp('a')]);

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(results[0].features.bpm).toBe(120);
  });

  it('a batch that keeps failing yields features:null for its tracks — never throws', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500 } }));

    const results = await adapter.getFeatures([sp('a'), sp('b')]);

    expect(results).toHaveLength(2);
    expect(results.every(r => r.features === null)).toBe(true);
  });

  it('tracks missing from the response body come back as features:null', async () => {
    axios.get.mockResolvedValue({ data: { content: [apiItem('a')] } });

    const results = await adapter.getFeatures([sp('a'), sp('ghost')]);

    const ghost = results.find(r => r.recordingKey === 'spotify:ghost');
    expect(ghost.features).toBeNull();
  });

  it('ignores unsupported tracks instead of sending them to the API', async () => {
    axios.get.mockResolvedValue({ data: { content: [] } });

    const results = await adapter.getFeatures([{ provider: 'youtube_music', id: 'v1' }]);

    expect(axios.get).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('tags apiStatus: hit (found), miss (200 but absent = catalog gap), error (batch threw)', async () => {
    axios.get.mockResolvedValue({ data: { content: [apiItem('a')] } });
    const [hit] = await adapter.getFeatures([sp('a')]);
    expect(hit.apiStatus).toBe('hit');

    axios.get.mockResolvedValue({ data: { content: [] } });
    const [miss] = await adapter.getFeatures([sp('a')]);
    expect(miss.features).toBeNull();
    expect(miss.apiStatus).toBe('miss');

    axios.get.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500 } }));
    const [err] = await adapter.getFeatures([sp('a')]);
    expect(err.features).toBeNull();
    expect(err.apiStatus).toBe('error');
  });
});

describe('shadow audit — API chaos', () => {
  it('a timeout (no response object) degrades to nulls without retry storms', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' }));

    const results = await adapter.getFeatures([sp('a')]);

    expect(results[0].features).toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(1); // non-429 errors are not retried
  });

  it('a zero/garbage RECCOBEATS_BATCH cannot infinite-loop the adapter', async () => {
    process.env.RECCOBEATS_BATCH = '0';
    axios.get.mockResolvedValue({ data: { content: [] } });

    const results = await adapter.getFeatures([sp('a'), sp('b')]);

    expect(results).toHaveLength(2);
    delete process.env.RECCOBEATS_BATCH;
  }, 2000);
});
