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
jest.mock('../app/models/User', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue(true),
  findById:          jest.fn(),
}));

// ── The module under test ─────────────────────────────────────────────────────
jest.mock('../app/services/musicProfileService', () => ({
  buildProfile: jest.fn().mockResolvedValue({ topGenres: [] }),
}));

const spotify            = require('../app/services/spotify');
const youtube            = require('../app/services/youtube');
const garmin             = require('../app/services/wearable/garmin');
const musicProfileService = require('../app/services/musicProfileService');
const User               = require('../app/models/User');
const { signOauthState } = require('../app/utils/jwt');
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
    // Identity now travels in a signed `state` (no cookie / no req.user).
    const STATE = signOauthState('user-123', 'spotify');
    const TOKENS  = { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 };
    const PROFILE = { spotifyId: 'sp123', displayName: 'Test User' };

    function spotifyReq(state = STATE) {
      return { query: { code: 'auth-code', state }, cookies: {} };
    }

    it('calls buildProfile with userId after successful token save', async () => {
      spotify.exchangeCode.mockResolvedValue(TOKENS);
      spotify.getProfile.mockResolvedValue(PROFILE);

      const user = buildUser();
      User.findById.mockResolvedValue(user);
      await ctrl.spotifyCallback(spotifyReq(), buildRes());
      await nextTick();

      expect(musicProfileService.buildProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({ _id: 'user-123' }));
    });

    it('redirects immediately without waiting for buildProfile', async () => {
      spotify.exchangeCode.mockResolvedValue(TOKENS);
      spotify.getProfile.mockResolvedValue(PROFILE);
      musicProfileService.buildProfile.mockImplementation(
        () => new Promise(r => setTimeout(r, 5_000)) // slow
      );

      User.findById.mockResolvedValue(buildUser());
      const res  = buildRes();
      await ctrl.spotifyCallback(spotifyReq(), res);

      // Redirect must have already been called (before setImmediate runs)
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/integrations?music=spotify'));
    });

    it('still redirects even if buildProfile throws', async () => {
      spotify.exchangeCode.mockResolvedValue(TOKENS);
      spotify.getProfile.mockResolvedValue(PROFILE);
      musicProfileService.buildProfile.mockRejectedValue(new Error('Gemini timeout'));

      User.findById.mockResolvedValue(buildUser());
      const res  = buildRes();
      await ctrl.spotifyCallback(spotifyReq(), res);
      await nextTick();

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/integrations?music=spotify'));
    });

    it('redirects with an error and does not call buildProfile when Spotify returns an error param', async () => {
      const res = buildRes();
      await ctrl.spotifyCallback({ query: { error: 'access_denied' }, cookies: {} }, res);
      await nextTick();

      expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=spotify_access_denied'));
    });

    it('redirects with an error on a tampered/invalid state and does not call buildProfile', async () => {
      const res = buildRes();
      await ctrl.spotifyCallback(spotifyReq('not-a-valid-jwt'), res);
      await nextTick();

      expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
      expect(spotify.exchangeCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=spotify_state'));
    });

    it('rejects a state signed for a different provider', async () => {
      const res = buildRes();
      await ctrl.spotifyCallback(spotifyReq(signOauthState('user-123', 'youtube')), res);
      await nextTick();

      expect(spotify.exchangeCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=spotify_state'));
    });
  });

  // ── YouTube callback ─────────────────────────────────────────────────────────

  describe('youtubeCallback', () => {
    const STATE   = signOauthState('user-123', 'youtube');
    const TOKENS  = { accessToken: 'yt-at', refreshToken: 'yt-rt', expiresAt: Date.now() + 3_600_000 };
    const CHANNEL = { channelId: 'UCxyz', displayName: 'My Channel' };

    function youtubeReq(state = STATE) {
      return { query: { code: 'yt-auth-code', state }, cookies: {} };
    }

    it('calls buildProfile with userId after successful token save', async () => {
      youtube.exchangeCode.mockResolvedValue(TOKENS);
      youtube.getChannel.mockResolvedValue(CHANNEL);

      const user = buildUser();
      User.findById.mockResolvedValue(user);
      await ctrl.youtubeCallback(youtubeReq(), buildRes());
      await nextTick();

      expect(musicProfileService.buildProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({ _id: 'user-123' }));
    });

    it('redirects immediately without waiting for buildProfile', async () => {
      youtube.exchangeCode.mockResolvedValue(TOKENS);
      youtube.getChannel.mockResolvedValue(CHANNEL);
      musicProfileService.buildProfile.mockImplementation(
        () => new Promise(r => setTimeout(r, 5_000))
      );

      User.findById.mockResolvedValue(buildUser());
      const res  = buildRes();
      await ctrl.youtubeCallback(youtubeReq(), res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/integrations?music=youtube'));
    });

    it('still redirects even if buildProfile throws', async () => {
      youtube.exchangeCode.mockResolvedValue(TOKENS);
      youtube.getChannel.mockResolvedValue(CHANNEL);
      musicProfileService.buildProfile.mockRejectedValue(new Error('DB error'));

      User.findById.mockResolvedValue(buildUser());
      const res  = buildRes();
      await ctrl.youtubeCallback(youtubeReq(), res);
      await nextTick();

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/integrations?music=youtube'));
    });

    it('redirects with an error and does not call buildProfile when YouTube returns an error param', async () => {
      const res = buildRes();
      await ctrl.youtubeCallback({ query: { error: 'access_denied' }, cookies: {} }, res);
      await nextTick();

      expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=youtube_access_denied'));
    });

    it('redirects with an error on a tampered/invalid state and does not call buildProfile', async () => {
      const res = buildRes();
      await ctrl.youtubeCallback(youtubeReq('not-a-valid-jwt'), res);
      await nextTick();

      expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
      expect(youtube.exchangeCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=youtube_state'));
    });
  });

  // ── Garmin callback (OAuth 1.0a) ───────────────────────────────────────────────
  // Identity + request-token secret travel in the first-party `garmin_request`
  // cookie (Redis is unavailable in tests, so the cookie path is exercised).

  describe('garminCallback', () => {
    const COOKIE = JSON.stringify({ token: 'req-token', secret: 'req-secret', uid: 'user-123' });

    it('persists the Garmin token and redirects on a valid callback', async () => {
      garmin.getAccessToken.mockResolvedValue({ accessToken: 'gat', accessTokenSecret: 'gats' });
      garmin.getUserProfile.mockResolvedValue({ garminUserId: 'garmin-99' });

      const user = buildUser();
      User.findById.mockResolvedValue(user);
      const res = buildRes();

      await ctrl.garminCallback(
        { query: { oauth_token: 'req-token', oauth_verifier: 'verifier' }, cookies: { garmin_request: COOKIE } },
        res,
      );

      expect(garmin.getAccessToken).toHaveBeenCalledWith('req-token', 'req-secret', 'verifier');
      expect(user.setToken).toHaveBeenCalledWith('wearableToken', expect.objectContaining({ garminUserId: 'garmin-99' }));
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('biometric=garmin'));
    });

    it('redirects with error=garmin_expired when the request cookie is missing', async () => {
      const res = buildRes();
      await ctrl.garminCallback({ query: { oauth_token: 'req-token', oauth_verifier: 'v' }, cookies: {} }, res);

      expect(garmin.getAccessToken).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_expired'));
    });

    it('redirects with error=garmin_mismatch on a token-fixation attempt', async () => {
      const res = buildRes();
      await ctrl.garminCallback(
        { query: { oauth_token: 'attacker-token', oauth_verifier: 'v' }, cookies: { garmin_request: COOKIE } },
        res,
      );

      expect(garmin.getAccessToken).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_mismatch'));
    });

    it('redirects with error=garmin_denied when the verifier is missing', async () => {
      const res = buildRes();
      await ctrl.garminCallback(
        { query: { oauth_token: 'req-token' }, cookies: { garmin_request: COOKIE } },
        res,
      );

      expect(garmin.getAccessToken).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_denied'));
    });
  });
});
