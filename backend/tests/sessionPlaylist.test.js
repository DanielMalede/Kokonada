'use strict';

process.env.NODE_ENV = 'test';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));
jest.mock('../app/services/spotify', () => ({
  // Pass-through token wrapper: the real one refreshes on 401 / types 403s — unit-tested there.
  withFreshToken: jest.fn(async (user, fn) => fn('access-token')),
}));

const axios = require('axios');
const { writeSessionPlaylist } = require('../app/services/spotifySessionPlaylist');

function makeUser(overrides = {}) {
  return { _id: 'u1', spotifySessionPlaylistId: null, save: jest.fn().mockResolvedValue(true), ...overrides };
}

const URIS = ['spotify:track:a', 'spotify:track:b', 'spotify:track:c'];

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: { id: 'spotify-user' } });
  axios.post.mockResolvedValue({ data: { id: 'pl-123' } });
  axios.put.mockResolvedValue({ data: {} });
});

describe('writeSessionPlaylist (D-1 Option A transport)', () => {
  it('first use: creates the hidden private playlist once, persists its id, writes the tracks', async () => {
    const user = makeUser();
    const res = await writeSessionPlaylist(user, URIS);

    // Current Spotify create-playlist endpoint (POST /me/playlists); /users/{id}/playlists is
    // deprecated and required a preceding GET /me for the user id — which we no longer make.
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/me/playlists'),
      expect.objectContaining({ name: 'Kokonada Session', public: false }),
      expect.anything(),
    );
    expect(axios.post.mock.calls[0][0]).not.toContain('/users/');
    expect(axios.get).not.toHaveBeenCalled(); // no GET /me needed anymore
    expect(user.spotifySessionPlaylistId).toBe('pl-123');
    expect(user.save).toHaveBeenCalled();
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining('/playlists/pl-123/tracks'),
      { uris: URIS },
      expect.anything(),
    );
    expect(res).toEqual({ playlistId: 'pl-123', contextUri: 'spotify:playlist:pl-123' });
  });

  it('later generations: a single replace PUT, no create', async () => {
    const user = makeUser({ spotifySessionPlaylistId: 'pl-existing' });
    const res = await writeSessionPlaylist(user, URIS);
    expect(axios.post).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
    expect(res.contextUri).toBe('spotify:playlist:pl-existing');
  });

  it('self-heals a user-deleted playlist: 404 on replace → recreate once → retry', async () => {
    const user = makeUser({ spotifySessionPlaylistId: 'pl-deleted' });
    axios.put
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { response: { status: 404 } }))
      .mockResolvedValueOnce({ data: {} });
    axios.post.mockResolvedValue({ data: { id: 'pl-new' } });

    const res = await writeSessionPlaylist(user, URIS);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(user.spotifySessionPlaylistId).toBe('pl-new');
    expect(res.contextUri).toBe('spotify:playlist:pl-new');
  });

  it('a non-404 failure propagates (the caller falls back to track playback)', async () => {
    const user = makeUser({ spotifySessionPlaylistId: 'pl-x' });
    axios.put.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 500 } }));
    await expect(writeSessionPlaylist(user, URIS)).rejects.toThrow('nope');
  });

  it('caps the replace at Spotify’s 100-uri limit', async () => {
    const user = makeUser({ spotifySessionPlaylistId: 'pl-x' });
    const many = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`);
    await writeSessionPlaylist(user, many);
    expect(axios.put.mock.calls[0][1].uris).toHaveLength(100);
  });

  it('rejects an empty uri list outright', async () => {
    await expect(writeSessionPlaylist(makeUser(), [])).rejects.toThrow(/no uris/);
  });
});
