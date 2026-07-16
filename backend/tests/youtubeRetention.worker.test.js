'use strict';

process.env.NODE_ENV = 'test';

// T3.5 (YouTube ToS compliance): stored YouTube library data must be refreshed OR purged within
// 30 days. Connected users get a refresh; disconnected users' (and unrefreshable) YouTube rows
// are purged. Spotify rows + the global mbid corpus are never touched.
jest.mock('../app/models/MusicProfile', () => ({ find: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/services/musicProfileService', () => ({
  buildProfile: jest.fn().mockResolvedValue({}),
  recomputeFootprint: jest.fn(() => ({ topGenres: ['g'], topArtists: ['a'], genreSet: ['g'] })),
}));

const MusicProfile = require('../app/models/MusicProfile');
const User = require('../app/models/User');
const musicProfileService = require('../app/services/musicProfileService');
const { process: run } = require('../app/workers/youtubeRetention.worker');

const SPOTIFY_ROW = { id: 's1', provider: 'spotify', name: 'Keep Me' };
const YT_ROW      = { id: 'y1', provider: 'youtube_music', name: 'Purge Me' };

function stubProfiles(...profiles) {
  MusicProfile.find.mockReturnValue({ limit: () => Promise.resolve(profiles) });
}

beforeEach(() => {
  jest.clearAllMocks();
  MusicProfile.updateOne.mockResolvedValue({});
  musicProfileService.buildProfile.mockResolvedValue({});
  musicProfileService.recomputeFootprint.mockReturnValue({ topGenres: ['g'], topArtists: ['a'], genreSet: ['g'] });
});

describe('youtubeRetention.worker', () => {
  it('targets only profiles with YouTube rows older than the 30-day window', async () => {
    stubProfiles();
    const before = Date.now();
    await run();
    const [filter] = MusicProfile.find.mock.calls[0];
    expect(filter['library.provider']).toBe('youtube_music');
    const cutoff = filter.$or.find((c) => c.lastAnalyzed && c.lastAnalyzed.$lt)?.lastAnalyzed.$lt;
    const ageMs = before - cutoff.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(29 * 24 * 3600 * 1000);
    expect(ageMs).toBeLessThanOrEqual(31 * 24 * 3600 * 1000);
  });

  it('REFRESHES a connected user\'s library (never purges it)', async () => {
    stubProfiles({ userId: 'u1', library: [SPOTIFY_ROW, YT_ROW] });
    User.findById.mockResolvedValue({ _id: 'u1', youtubeMusicToken: { blob: 'oauth' } });

    const res = await run();

    expect(musicProfileService.buildProfile).toHaveBeenCalledWith('u1', expect.any(Object));
    expect(MusicProfile.updateOne).not.toHaveBeenCalled();
    expect(res.refreshed).toBe(1);
  });

  it('PURGES a disconnected user\'s YouTube rows, keeping Spotify rows', async () => {
    stubProfiles({ userId: 'u2', library: [SPOTIFY_ROW, YT_ROW] });
    User.findById.mockResolvedValue({ _id: 'u2', youtubeMusicToken: null });

    const res = await run();

    expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
    const [, update] = MusicProfile.updateOne.mock.calls[0];
    expect(update.$set.library).toEqual([SPOTIFY_ROW]); // youtube_music stripped, spotify kept
    expect(res.purged).toBe(1);
    expect(res.rowsPurged).toBe(1);
  });

  it('falls back to purge when a refresh throws (never retains stale YouTube data)', async () => {
    stubProfiles({ userId: 'u3', library: [SPOTIFY_ROW, YT_ROW] });
    User.findById.mockResolvedValue({ _id: 'u3', youtubeMusicToken: { blob: 'oauth' } });
    musicProfileService.buildProfile.mockRejectedValueOnce(new Error('yt 401'));

    const res = await run();

    expect(MusicProfile.updateOne).toHaveBeenCalled();
    expect(res.purged).toBe(1);
  });
});
