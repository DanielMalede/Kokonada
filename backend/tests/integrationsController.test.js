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
jest.mock('../app/services/wearable/garmin',      () => ({ isConfigured: jest.fn().mockReturnValue(true), generatePKCE: jest.fn().mockReturnValue({ codeVerifier: 'cv', codeChallenge: 'cc' }), getAuthUrl: jest.fn(), exchangeCode: jest.fn(), getUserId: jest.fn(), requestSixMonthBackfill: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../app/services/wearable/appleHealth', () => ({ ingestBatch: jest.fn() }));
jest.mock('../app/services/wearable/healthStore', () => ({ ingestBatch: jest.fn() }));
jest.mock('../app/services/wearable/suunto',      () => ({ verifyWebhookSignature: jest.fn(), handleWebhook: jest.fn() }));
jest.mock('../app/services/wearable/garminConnect', () => ({ isEnabled: jest.fn(), login: jest.fn(), fetchAllBiometrics: jest.fn(), toCanonicalMetrics: jest.fn(), restoreSession: jest.fn() }));
jest.mock('../app/services/wearable/metricStore',   () => ({ persistMetrics: jest.fn() }));
jest.mock('../app/models/BiometricLog',  () => ({}));
jest.mock('../app/models/MusicProfile',  () => ({ deleteOne: jest.fn().mockResolvedValue({}) }));
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
const garminConnect      = require('../app/services/wearable/garminConnect');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const musicProfileService = require('../app/services/musicProfileService');
const User               = require('../app/models/User');
const MusicProfile       = require('../app/models/MusicProfile');
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

describe('spotifyDisconnect', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clears the token and deletes the cached MusicProfile (Spotify data-handling)', async () => {
    const user = buildUser({ spotifyToken: { blob: 'x' }, musicProvider: 'spotify' });
    const res = buildRes();
    await ctrl.spotifyDisconnect({ user }, res, jest.fn());

    expect(user.spotifyToken).toBeNull();
    expect(user.musicProvider).toBeNull();
    expect(MusicProfile.deleteOne).toHaveBeenCalledWith({ userId: 'user-123' });
    expect(res.json).toHaveBeenCalledWith({ message: 'Spotify disconnected' });
  });
});

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

      // Third arg is the onProgress callback that streams build progress to the socket (#2).
      expect(musicProfileService.buildProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({ _id: 'user-123' }), expect.any(Function));
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

  // ── Garmin callback (OAuth 2.0 + PKCE) ─────────────────────────────────────────
  // Identity + PKCE verifier travel in the signed `state` (stateless; no cookie).
  describe('garminCallback', () => {
    const validState = () => signOauthState('user-123', 'garmin', { cv: 'verifier' });

    it('exchanges the code, stores OAuth2 tokens + garminUserId, and redirects', async () => {
      garmin.exchangeCode.mockResolvedValue({ accessToken: 'gat', refreshToken: 'grt', expiresAt: Date.now() + 3600000 });
      garmin.getUserId.mockResolvedValue({ garminUserId: 'garmin-99' });

      const user = buildUser();
      User.findById.mockResolvedValue(user);
      const res = buildRes();

      await ctrl.garminCallback({ query: { code: 'auth-code', state: validState() }, cookies: {} }, res);

      expect(garmin.exchangeCode).toHaveBeenCalledWith('auth-code', 'verifier');
      expect(garmin.getUserId).toHaveBeenCalledWith('gat');
      expect(user.garminUserId).toBe('garmin-99');
      expect(user.setToken).toHaveBeenCalledWith('wearableToken', expect.objectContaining({ accessToken: 'gat', garminUserId: 'garmin-99' }));
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('biometric=garmin'));
    });

    it('redirects with error=garmin_state on a tampered/missing state', async () => {
      const res = buildRes();
      await ctrl.garminCallback({ query: { code: 'c', state: 'bad' }, cookies: {} }, res);

      expect(garmin.exchangeCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_state'));
    });

    it('redirects with error=garmin_failed on token-exchange failure', async () => {
      garmin.exchangeCode.mockRejectedValue(new Error('token endpoint down'));
      User.findById.mockResolvedValue(buildUser());
      const res = buildRes();
      await ctrl.garminCallback({ query: { code: 'c', state: validState() }, cookies: {} }, res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_failed'));
    });
  });
});

describe('garminCredentialsConnect (unofficial wrapper pull)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    garminConnect.isEnabled.mockReturnValue(true);
  });

  function buildReq(body, user) {
    return { user: user || { _id: 'user-123' }, body };
  }

  it('returns 503 when the experiment flag is off', async () => {
    garminConnect.isEnabled.mockReturnValue(false);
    const res = buildRes();
    await ctrl.garminCredentialsConnect(buildReq({ email: 'e@x.com', password: 'pw' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(garminConnect.login).not.toHaveBeenCalled();
  });

  it('returns 400 when email or password is missing', async () => {
    const res = buildRes();
    await ctrl.garminCredentialsConnect(buildReq({ email: 'e@x.com' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(garminConnect.login).not.toHaveBeenCalled();
  });

  it('returns 401 on a failed Garmin login', async () => {
    garminConnect.login.mockRejectedValue(new Error('Invalid credentials'));
    const res = buildRes();
    await ctrl.garminCredentialsConnect(buildReq({ email: 'e@x.com', password: 'bad' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(persistMetrics).not.toHaveBeenCalled();
  });

  it('returns 422 when the account requires MFA', async () => {
    garminConnect.login.mockRejectedValue(new Error('MFA verification code required'));
    const res = buildRes();
    await ctrl.garminCredentialsConnect(buildReq({ email: 'e@x.com', password: 'pw' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: 'garmin_mfa_unsupported' });
  });

  it('persists metrics, sets provider, stores session tokens (never the password)', async () => {
    const sessionTokens = { oauth1: { oauth_token: 't' }, oauth2: { access_token: 'a' } };
    garminConnect.login.mockResolvedValue({ client: {}, sessionTokens });
    garminConnect.fetchAllBiometrics.mockResolvedValue({ garminUserId: '999', warnings: [], heartRate: { resting: 52 } });
    garminConnect.toCanonicalMetrics.mockReturnValue([{ metric: 'restingHeartRate', value: 52, unit: 'bpm', recordedAt: new Date(), source: 'garmin' }]);
    persistMetrics.mockResolvedValue({ inserted: 1, profileMetrics: { restingHeartRate: 52 } });

    const user = buildUser();
    User.findById.mockResolvedValue(user);
    const res = buildRes();
    await ctrl.garminCredentialsConnect(buildReq({ email: 'e@x.com', password: 'sup3r-secret' }), res, jest.fn());

    expect(persistMetrics).toHaveBeenCalledWith('user-123', expect.any(Array));
    expect(user.wearableProvider).toBe('garmin');
    expect(user.garminUserId).toBe('999');
    // Session tokens are stored — and the raw password is nowhere in the stored blob.
    expect(user.setToken).toHaveBeenCalledWith('wearableToken', expect.objectContaining({ provider: 'garmin-connect', sessionTokens }));
    const stored = JSON.stringify(user.setToken.mock.calls[0][1]);
    expect(stored).not.toContain('sup3r-secret');
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ connected: true, provider: 'garmin' }));
  });
});
