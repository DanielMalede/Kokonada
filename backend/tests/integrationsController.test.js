'use strict';

process.env.ENCRYPTION_KEY        = 'a'.repeat(64);
process.env.JWT_SECRET             = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV               = 'test';
process.env.SPOTIFY_CLIENT_ID      = 'spotify_client_id';
process.env.SPOTIFY_CLIENT_SECRET  = 'spotify_client_secret';
process.env.SPOTIFY_REDIRECT_URI   = 'http://localhost:5000/api/integrations/spotify/callback';
process.env.YOUTUBE_CLIENT_ID      = 'yt_client_id';
process.env.YOUTUBE_CLIENT_SECRET  = 'yt_client_secret';
process.env.YOUTUBE_REDIRECT_URI   = 'http://localhost:5000/api/integrations/youtube/callback';
process.env.MOBILE_DEEP_LINK       = 'kokonada://';

// ── Mock all external dependencies ────────────────────────────────────────────
jest.mock('../app/services/spotify', () => ({
  getAuthUrl:             jest.fn(),
  exchangeCode:           jest.fn(),
  getProfile:             jest.fn(),
  getValidToken:          jest.fn(),
  getTopTrackFeatures:    jest.fn(),
  paginateLikedSongs:     jest.fn(),
  paginatePlaylistTracks: jest.fn(),
  batchAudioFeatures:     jest.fn(),
  getRecommendations:     jest.fn(),
}));
jest.mock('../app/services/youtube', () => ({
  getAuthUrl:            jest.fn(),
  exchangeCode:          jest.fn(),
  getChannel:            jest.fn(),
  getValidToken:         jest.fn(),
  getLikedVideos:        jest.fn(),
  paginateLikedVideos:   jest.fn(),
  paginatePlaylistItems: jest.fn(),
  searchRecommendations: jest.fn(),
}));
jest.mock('../app/services/wearable/garmin',      () => ({ getRequestToken: jest.fn(), getAuthUrl: jest.fn(), getAccessToken: jest.fn(), getUserProfile: jest.fn() }));
jest.mock('../app/services/wearable/appleHealth', () => ({ ingestBatch: jest.fn() }));
jest.mock('../app/services/wearable/suunto',      () => ({ verifyWebhookSignature: jest.fn(), handleWebhook: jest.fn() }));
jest.mock('../app/models/BiometricLog',  () => ({}));
jest.mock('../app/models/User', () => ({ findByIdAndUpdate: jest.fn().mockResolvedValue(true) }));

// ── The module under test ─────────────────────────────────────────────────────
jest.mock('../app/services/musicProfileService', () => ({
  buildProfile: jest.fn().mockResolvedValue({ topGenres: [] }),
}));

const spotify            = require('../app/services/spotify');
const youtube            = require('../app/services/youtube');
const musicProfileService = require('../app/services/musicProfileService');
const ctrl               = require('../app/controllers/integrationsController');

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildUser(overrides = {}) {
  return {
    _id: 'user-123',
    spotifyToken:      null,
    youtubeMusicToken: null,
    wearableProvider:  null,
    wearableToken:     null,
    setToken: jest.fn(function (field, obj) { this[field] = { blob: 'encrypted' }; }),
    getToken: jest.fn(),
    save:     jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildRes() {
  return {
    cookie:      jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect:    jest.fn().mockReturnThis(),
    status:      jest.fn().mockReturnThis(),
    json:        jest.fn().mockReturnThis(),
  };
}

// flush setImmediate queue
const nextTick = () => new Promise(r => setImmediate(r));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('integrationsController — buildProfile wiring', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Spotify callback ─────────────────────────────────────────────────────────

  describe('spotifyCallback', () => {
    const STATE = 'valid-state-abc123';
    const TOKENS  = { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 };
    const PROFILE = { spotifyId: 'sp123', displayName: 'Test User' };

    function spotifyReq(user) {
      return {
        query:   { code: 'auth-code', state: STATE },
        cookies: { spotify_oauth_state: STATE },
        user,
      };
    }

    it('calls buildProfile with userId after successful token save', async () => {
      spotify.exchangeCode.mockResolvedValue(TOKENS);
      spotify.getProfile.mockResolvedValue(PROFILE);

      const user = buildUser();
      await ctrl.spotifyCallback(spotifyReq(user), buildRes(), jest.fn());
      await nextTick();

      expect(musicProfileService.buildProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({ _id: 'user-123' }));
    });

    it('redirects immediately without waiting for buildProfile', async () => {
      spotify.exchangeCode.mockResolvedValue(TOKENS);
      spotify.getProfile.mockResolvedValue(PROFILE);
      musicProfileService.buildProfile.mockImplementation(
        () => new Promise(r => setTimeout(r, 5_000)) // slow
      );

      const user = buildUser();
      const res  = buildRes();
      await ctrl.spotifyCallback(spotifyReq(user), res, jest.fn());

      // Redirect must have already been called (before setImmediate runs)
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('spotify/success'));
    });

    it('still redirects even if buildProfile throws', async () => {
      spotify.exchangeCode.mockResolvedValue(TOKENS);
      spotify.getProfile.mockResolvedValue(PROFILE);
      musicProfileService.buildProfile.mockRejectedValue(new Error('Gemini timeout'));

      const user = buildUser();
      const res  = buildRes();
      await ctrl.spotifyCallback(spotifyReq(user), res, jest.fn());
      await nextTick();

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('spotify/success'));
    });

    it('does not call buildProfile when Spotify returns an error param', async () => {
      const req = {
        query:   { error: 'access_denied' },
        cookies: {},
        user:    buildUser(),
      };
      await ctrl.spotifyCallback(req, buildRes(), jest.fn());
      await nextTick();

      expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
    });

    it('does not call buildProfile on CSRF state mismatch', async () => {
      const req = {
        query:   { code: 'abc', state: 'wrong-state' },
        cookies: { spotify_oauth_state: 'correct-state' },
        user:    buildUser(),
      };
      await ctrl.spotifyCallback(req, buildRes(), jest.fn());
      await nextTick();

      expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
    });
  });

  // ── YouTube callback ─────────────────────────────────────────────────────────

  describe('youtubeCallback', () => {
    const STATE   = 'yt-valid-state-xyz';
    const TOKENS  = { accessToken: 'yt-at', refreshToken: 'yt-rt', expiresAt: Date.now() + 3_600_000 };
    const CHANNEL = { channelId: 'UCxyz', displayName: 'My Channel' };

    function youtubeReq(user) {
      return {
        query:   { code: 'yt-auth-code', state: STATE },
        cookies: { youtube_oauth_state: STATE },
        user,
      };
    }

    it('calls buildProfile with userId after successful token save', async () => {
      youtube.exchangeCode.mockResolvedValue(TOKENS);
      youtube.getChannel.mockResolvedValue(CHANNEL);

      const user = buildUser();
      await ctrl.youtubeCallback(youtubeReq(user), buildRes(), jest.fn());
      await nextTick();

      expect(musicProfileService.buildProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({ _id: 'user-123' }));
    });

    it('redirects immediately without waiting for buildProfile', async () => {
      youtube.exchangeCode.mockResolvedValue(TOKENS);
      youtube.getChannel.mockResolvedValue(CHANNEL);
      musicProfileService.buildProfile.mockImplementation(
        () => new Promise(r => setTimeout(r, 5_000))
      );

      const user = buildUser();
      const res  = buildRes();
      await ctrl.youtubeCallback(youtubeReq(user), res, jest.fn());

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('youtube/success'));
    });

    it('still redirects even if buildProfile throws', async () => {
      youtube.exchangeCode.mockResolvedValue(TOKENS);
      youtube.getChannel.mockResolvedValue(CHANNEL);
      musicProfileService.buildProfile.mockRejectedValue(new Error('DB error'));

      const user = buildUser();
      const res  = buildRes();
      await ctrl.youtubeCallback(youtubeReq(user), res, jest.fn());
      await nextTick();

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('youtube/success'));
    });

    it('does not call buildProfile when YouTube returns an error param', async () => {
      const req = {
        query:   { error: 'access_denied' },
        cookies: {},
        user:    buildUser(),
      };
      await ctrl.youtubeCallback(req, buildRes(), jest.fn());
      await nextTick();

      expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
    });

    it('does not call buildProfile on CSRF state mismatch', async () => {
      const req = {
        query:   { code: 'abc', state: 'wrong-state' },
        cookies: { youtube_oauth_state: 'correct-state' },
        user:    buildUser(),
      };
      await ctrl.youtubeCallback(req, buildRes(), jest.fn());
      await nextTick();

      expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
    });
  });
});
