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
jest.mock('../app/services/wearable/metricStore',   () => ({ persistMetrics: jest.fn() }));
jest.mock('../app/models/BiometricLog',  () => ({}));
jest.mock('../app/models/MusicProfile',  () => ({ deleteOne: jest.fn().mockResolvedValue({}), findOneAndUpdate: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/models/ServeEvent',    () => ({ deleteMany: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/utils/userRedisPurge', () => ({ purgeUserKeys: jest.fn().mockResolvedValue(0) }));
jest.mock('../app/services/selection/candidatePool', () => ({ invalidateUserPools: jest.fn().mockResolvedValue(0) }));
jest.mock('../app/models/User', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue(true),
  findById:          jest.fn(),
}));
// Art.9 consent service — the Garmin callback now gates its 6-month backfill on a current grant.
// Default to granted so existing callback tests are unaffected; the gate test overrides it.
jest.mock('../app/services/privacy/consent', () => ({
  getConsentStatus:       jest.fn().mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false }),
  HEALTH_CONSENT_PURPOSE: 'health_biometric_processing',
}));

// ── The module under test ─────────────────────────────────────────────────────
jest.mock('../app/services/musicProfileService', () => ({
  buildProfile: jest.fn().mockResolvedValue({ topGenres: [] }),
}));

const spotify            = require('../app/services/spotify');
const youtube            = require('../app/services/youtube');
const garmin             = require('../app/services/wearable/garmin');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const musicProfileService = require('../app/services/musicProfileService');
const User               = require('../app/models/User');
const MusicProfile       = require('../app/models/MusicProfile');
const ServeEvent         = require('../app/models/ServeEvent');
const { purgeUserKeys }  = require('../app/utils/userRedisPurge');
const candidatePool      = require('../app/services/selection/candidatePool');
const { signOauthState } = require('../app/utils/jwt');
const { getConsentStatus } = require('../app/services/privacy/consent');
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

  it('erases the personalized serve history and user Redis state (Spotify retention containment)', async () => {
    const user = buildUser({ spotifyToken: { blob: 'x' }, musicProvider: 'spotify' });
    const res = buildRes();
    await ctrl.spotifyDisconnect({ user }, res, jest.fn());

    expect(ServeEvent.deleteMany).toHaveBeenCalledWith({ userId: 'user-123' });
    expect(purgeUserKeys).toHaveBeenCalledWith('user-123');
  });
});

describe('youtubeDisconnect — deterministic Spotify-native rebuild', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clears the YT token, wipes the pool cache, and rebuilds Spotify-only when Spotify remains', async () => {
    const user = buildUser({
      youtubeMusicToken: { blob: 'yt' },
      spotifyToken:      { blob: 'sp' },
      musicProvider:     'youtube',
      getToken: jest.fn((field) => (field === 'spotifyToken' ? { accessToken: 'sp-at' } : null)),
    });
    User.findById.mockResolvedValue(user); // loadUserWithTokens re-loads the full doc
    musicProfileService.buildProfile.mockResolvedValue({ library: [{ id: 'a' }, { id: 'b' }] });
    const res = buildRes();

    await ctrl.youtubeDisconnect({ user: { _id: 'user-123' } }, res, jest.fn());

    expect(user.youtubeMusicToken).toBeNull();
    expect(user.musicProvider).toBe('spotify');
    expect(candidatePool.invalidateUserPools).toHaveBeenCalledWith('user-123');
    expect(musicProfileService.buildProfile).toHaveBeenCalledWith('user-123', user);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ rebuilt: true, provider: 'spotify', library: 2 }),
    );
  });

  it('does NOT rebuild (clears the library) when no Spotify connection remains', async () => {
    const user = buildUser({ youtubeMusicToken: { blob: 'yt' }, getToken: jest.fn(() => null) });
    User.findById.mockResolvedValue(user);
    const res = buildRes();

    await ctrl.youtubeDisconnect({ user: { _id: 'user-123' } }, res, jest.fn());

    expect(user.youtubeMusicToken).toBeNull();
    expect(user.musicProvider).toBeNull();
    expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
    expect(MusicProfile.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user-123' },
      expect.objectContaining({ $set: expect.objectContaining({ library: [] }) }),
      expect.any(Object),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ rebuilt: false, library: 0 }));
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
      await nextTick(); // drain the fire-and-forget backfill setImmediate so it can't leak into the next test

      expect(garmin.exchangeCode).toHaveBeenCalledWith('auth-code', 'verifier');
      expect(garmin.getUserId).toHaveBeenCalledWith('gat');
      expect(user.garminUserId).toBe('garmin-99');
      expect(user.setToken).toHaveBeenCalledWith('wearableToken', expect.objectContaining({ accessToken: 'gat', garminUserId: 'garmin-99' }));
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('biometric=garmin'));
    });

    it('skips the 6-month backfill when the user has no current Art.9 consent (still connects)', async () => {
      garmin.exchangeCode.mockResolvedValue({ accessToken: 'gat', refreshToken: 'grt', expiresAt: Date.now() + 3600000 });
      garmin.getUserId.mockResolvedValue({ garminUserId: 'garmin-99' });
      getConsentStatus.mockResolvedValueOnce({ granted: false, currentVersion: 1, staleVersion: false });
      User.findById.mockResolvedValue(buildUser());
      const res = buildRes();

      await ctrl.garminCallback({ query: { code: 'auth-code', state: validState() }, cookies: {} }, res);
      await nextTick(); // let any (wrongly) scheduled setImmediate backfill run

      expect(garmin.requestSixMonthBackfill).not.toHaveBeenCalled(); // never asks Garmin to push history
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('biometric=garmin')); // connection still succeeds
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
