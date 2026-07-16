'use strict';

process.env.NODE_ENV = 'test';
process.env.YOUTUBE_REFRESH_BACKOFF_MS = '0'; // no real delays in tests (jitter/backoff → ~0)

// T3.5 + H1 (YouTube ToS compliance): stored YouTube library data must be refreshed OR purged
// within 30 days. Connected users get a refresh (retried with backoff on TRANSIENT errors);
// a TERMINAL error (revoked/invalid_grant) purges immediately; a transient outage only purges
// once past the hard compliance ceiling — never on a rate-limit blip. Spotify + mbid untouched.
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

const DAY = 24 * 3600 * 1000;
const SPOTIFY_ROW = { id: 's1', provider: 'spotify', name: 'Keep Me' };
const YT_ROW      = { id: 'y1', provider: 'youtube_music', name: 'Refresh Or Purge' };
const RECENT_STALE = new Date(Date.now() - 31 * DAY); // past 30d TTL, within the transient grace
const VERY_STALE   = new Date(Date.now() - 45 * DAY); // past the hard compliance ceiling

const CONNECTED = (id) => ({ _id: id, youtubeMusicToken: { blob: 'oauth' } });
const httpErr = (status, data) => Object.assign(new Error(`http ${status}`), { response: { status, data } });

function stubProfiles(...profiles) {
  MusicProfile.find.mockReturnValue({ limit: () => Promise.resolve(profiles) });
}
const profile = (userId, over = {}) => ({ userId, library: [SPOTIFY_ROW, YT_ROW], lastAnalyzed: RECENT_STALE, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  MusicProfile.updateOne.mockResolvedValue({});
  musicProfileService.buildProfile.mockResolvedValue({});
  musicProfileService.recomputeFootprint.mockReturnValue({ topGenres: ['g'], topArtists: ['a'], genreSet: ['g'] });
});

describe('youtubeRetention.worker — selection + basic routing', () => {
  it('targets only profiles with YouTube rows older than the 30-day window', async () => {
    stubProfiles();
    const before = Date.now();
    await run();
    const [filter] = MusicProfile.find.mock.calls[0];
    expect(filter['library.provider']).toBe('youtube_music');
    const cutoff = filter.$or.find((c) => c.lastAnalyzed && c.lastAnalyzed.$lt)?.lastAnalyzed.$lt;
    const ageMs = before - cutoff.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(29 * DAY);
    expect(ageMs).toBeLessThanOrEqual(31 * DAY);
  });

  it('REFRESHES a connected user\'s library (never purges it)', async () => {
    stubProfiles(profile('u1'));
    User.findById.mockResolvedValue(CONNECTED('u1'));
    const res = await run();
    expect(musicProfileService.buildProfile).toHaveBeenCalledWith('u1', expect.any(Object));
    expect(MusicProfile.updateOne).not.toHaveBeenCalled();
    expect(res.refreshed).toBe(1);
  });

  it('PURGES a disconnected user\'s YouTube rows, keeping Spotify rows', async () => {
    stubProfiles(profile('u2'));
    User.findById.mockResolvedValue({ _id: 'u2', youtubeMusicToken: null });
    const res = await run();
    expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
    const [, update] = MusicProfile.updateOne.mock.calls[0];
    expect(update.$set.library).toEqual([SPOTIFY_ROW]);
    expect(res.purged).toBe(1);
    expect(res.rowsPurged).toBe(1);
  });
});

describe('youtubeRetention.worker — transient vs terminal refresh failure (H1)', () => {
  it('purges IMMEDIATELY on a TERMINAL error (invalid_grant), without wasting retries', async () => {
    stubProfiles(profile('u3'));
    User.findById.mockResolvedValue(CONNECTED('u3'));
    musicProfileService.buildProfile.mockRejectedValue(httpErr(400, { error: 'invalid_grant' }));

    const res = await run();

    expect(musicProfileService.buildProfile).toHaveBeenCalledTimes(1); // no retries on a terminal failure
    expect(MusicProfile.updateOne).toHaveBeenCalled();
    expect(res.purged).toBe(1);
  });

  it('does NOT purge on a TRANSIENT error within the grace window — retries with backoff, then defers', async () => {
    stubProfiles(profile('u4', { lastAnalyzed: RECENT_STALE }));
    User.findById.mockResolvedValue(CONNECTED('u4'));
    musicProfileService.buildProfile.mockRejectedValue(httpErr(429, {})); // rate limited, sustained

    const res = await run();

    expect(musicProfileService.buildProfile.mock.calls.length).toBeGreaterThan(1); // retried
    expect(MusicProfile.updateOne).not.toHaveBeenCalled();                          // library preserved
    expect(res.purged).toBe(0);
    expect(res.deferred).toBe(1);
  });

  it('recovers when a transient error clears on retry (refreshed, never purged)', async () => {
    stubProfiles(profile('u5'));
    User.findById.mockResolvedValue(CONNECTED('u5'));
    musicProfileService.buildProfile
      .mockRejectedValueOnce(httpErr(503, {})) // transient blip
      .mockResolvedValueOnce({});              // retry succeeds

    const res = await run();

    expect(MusicProfile.updateOne).not.toHaveBeenCalled();
    expect(res.refreshed).toBe(1);
  });

  it('DOES purge on a transient error once past the hard compliance ceiling', async () => {
    stubProfiles(profile('u6', { lastAnalyzed: VERY_STALE }));
    User.findById.mockResolvedValue(CONNECTED('u6'));
    musicProfileService.buildProfile.mockRejectedValue(httpErr(429, {}));

    const res = await run();

    expect(MusicProfile.updateOne).toHaveBeenCalled();
    expect(res.purged).toBe(1);
  });
});
