'use strict';

process.env.ENCRYPTION_KEY       = 'a'.repeat(64);
process.env.JWT_SECRET            = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV              = 'test';
process.env.SPOTIFY_CLIENT_ID     = 'spotify_client_id';
process.env.SPOTIFY_CLIENT_SECRET = 'spotify_client_secret';
process.env.SPOTIFY_REDIRECT_URI  = 'http://localhost:5000/api/integrations/spotify/callback';
process.env.YOUTUBE_CLIENT_ID     = 'yt_client_id';
process.env.YOUTUBE_CLIENT_SECRET = 'yt_client_secret';
process.env.YOUTUBE_REDIRECT_URI  = 'http://localhost:5000/api/integrations/youtube/callback';
process.env.GARMIN_CONSUMER_KEY   = 'garmin_key';
process.env.GARMIN_CONSUMER_SECRET = 'garmin_secret';
process.env.GARMIN_REDIRECT_URI   = 'http://localhost:5000/api/integrations/garmin/callback';
process.env.SUUNTO_WEBHOOK_SECRET = 'suunto_secret';
process.env.MOBILE_DEEP_LINK      = 'kokonada://';
process.env.GARMIN_WEBHOOK_SECRET = 'garmin_webhook_secret';

// ── Service mocks (factory form — never loads the real modules, avoids mongoose) ─
jest.mock('../app/services/musicProfileService', () => ({
  buildProfile: jest.fn().mockResolvedValue({ topGenres: [], library: [] }),
}));
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
  getAuthUrl:              jest.fn(),
  isConfigured:            jest.fn(),
  generatePKCE:            jest.fn().mockReturnValue({ codeVerifier: 'test-cv', codeChallenge: 'test-cc' }),
  exchangeCode:            jest.fn(),
  exchangeCodeFromGIS:     jest.fn(),
  getChannel:              jest.fn(),
  getValidToken:           jest.fn(),
  getLikedVideos:          jest.fn(),
  paginateLikedVideos:     jest.fn(),
  paginatePlaylistItems:   jest.fn(),
  searchRecommendations:   jest.fn(),
}));
jest.mock('../app/services/wearable/garmin', () => ({
  isConfigured:            jest.fn().mockReturnValue(true),
  generatePKCE:            jest.fn().mockReturnValue({ codeVerifier: 'test-cv', codeChallenge: 'test-cc' }),
  getAuthUrl:              jest.fn(),
  exchangeCode:            jest.fn(),
  getUserId:               jest.fn(),
  requestSixMonthBackfill: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../app/services/wearable/garminIngest', () => ({
  ingestSummaries: jest.fn(),
}));
jest.mock('../app/services/wearable/appleHealth', () => ({
  ingestBatch: jest.fn(),
}));
jest.mock('../app/services/wearable/healthStore', () => ({
  ingestBatch: jest.fn(),
}));
// suunto mock — only handleWebhook and getWorkouts need mocking here;
// verifyWebhookSignature is tested via its real crypto logic below
jest.mock('../app/services/wearable/suunto', () => ({
  verifyWebhookSignature: jest.fn(),
  handleWebhook:          jest.fn(),
  getWorkouts:            jest.fn(),
}));
jest.mock('../app/services/features/featureService', () => ({
  hydrate:          jest.fn(),
  enqueueHydration: jest.fn(),
}));

// Mock mongoose models to avoid the Node 21 / mongoose 9 incompatibility
jest.mock('../app/models/BiometricLog', () => ({}));
jest.mock('../app/models/MusicProfile', () => ({ deleteOne: jest.fn().mockResolvedValue({}), findOneAndUpdate: jest.fn().mockResolvedValue({}), findOne: jest.fn() }));
jest.mock('../app/models/User', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue(true),
  findById:          jest.fn(),
  findOne:           jest.fn(),
}));

const spotify     = require('../app/services/spotify');
const youtube     = require('../app/services/youtube');
const garmin      = require('../app/services/wearable/garmin');
const healthStore = require('../app/services/wearable/healthStore');
const garminIngest = require('../app/services/wearable/garminIngest');
const User        = require('../app/models/User');
const MusicProfile = require('../app/models/MusicProfile');
const featureService = require('../app/services/features/featureService');
const { signOauthState, verifyOauthState } = require('../app/utils/jwt');
const timingSafe = require('../app/utils/timingSafeEqual');

const ctrl = require('../app/controllers/integrationsController');
const { normalize } = require('../app/services/wearable/adapter');

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  const res = {
    cookie:      jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect:    jest.fn().mockReturnThis(),
    status:      jest.fn().mockReturnThis(),
    json:        jest.fn().mockReturnThis(),
  };
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPOTIFY
// ═══════════════════════════════════════════════════════════════════════════════
describe('Spotify OAuth flow', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('spotifyConnect', () => {
    it('redirects to Spotify with a signed state (no cookie needed)', () => {
      spotify.getAuthUrl.mockReturnValue('https://accounts.spotify.com/authorize?...');

      const req = { user: buildUser() };
      const res = buildRes();

      ctrl.spotifyConnect(req, res);

      // No state cookie — identity travels in the signed state instead
      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('accounts.spotify.com'));
    });

    it('passes a signed-JWT state token (3 dot-separated segments) to getAuthUrl', () => {
      spotify.getAuthUrl.mockReturnValue('https://accounts.spotify.com/authorize');

      ctrl.spotifyConnect({ user: buildUser() }, buildRes());

      const stateArg = spotify.getAuthUrl.mock.calls[0][0];
      expect(stateArg.split('.')).toHaveLength(3); // header.payload.signature
    });

    it('threads returnTo=app into the signed state for a mobile connect', () => {
      spotify.getAuthUrl.mockReturnValue('https://accounts.spotify.com/authorize');

      ctrl.spotifyConnect({ user: buildUser(), query: { returnTo: 'app' } }, buildRes());

      const stateArg = spotify.getAuthUrl.mock.calls[0][0];
      expect(verifyOauthState(stateArg).returnTo).toBe('app');
    });

    it('leaves returnTo unset for a web connect (default)', () => {
      spotify.getAuthUrl.mockReturnValue('https://accounts.spotify.com/authorize');

      ctrl.spotifyConnect({ user: buildUser() }, buildRes());

      const stateArg = spotify.getAuthUrl.mock.calls[0][0];
      expect(verifyOauthState(stateArg).returnTo).toBeUndefined();
    });
  });

  describe('spotifyCallback', () => {
    const validState = () => signOauthState('user-123', 'spotify');
    const appState   = () => signOauthState('user-123', 'spotify', { returnTo: 'app' });

    it('redirects with an error when Spotify returns an error param', async () => {
      const req = { query: { error: 'access_denied' }, cookies: {} };
      const res = buildRes();
      await ctrl.spotifyCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=spotify_access_denied'));
    });

    it('redirects with error=spotify_state on a tampered state', async () => {
      const req = { query: { code: 'abc', state: 'wrong-state' }, cookies: {} };
      const res = buildRes();
      await ctrl.spotifyCallback(req, res);

      expect(spotify.exchangeCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=spotify_state'));
    });

    it('redirects with error=spotify_state when state is missing', async () => {
      const req = { query: { code: 'abc' }, cookies: {} };
      const res = buildRes();
      await ctrl.spotifyCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=spotify_state'));
    });

    it('encrypts tokens and redirects to the app on success', async () => {
      const tokens  = { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600000 };
      const profile = { spotifyId: 'sp123', displayName: 'Test User' };

      spotify.exchangeCode.mockResolvedValue(tokens);
      spotify.getProfile.mockResolvedValue(profile);

      const user = buildUser();
      User.findById.mockResolvedValue(user);
      const req  = { query: { code: 'auth-code', state: validState() }, cookies: {} };
      const res  = buildRes();

      await ctrl.spotifyCallback(req, res);

      expect(spotify.exchangeCode).toHaveBeenCalledWith('auth-code');
      expect(spotify.getProfile).toHaveBeenCalledWith(tokens.accessToken);
      expect(user.setToken).toHaveBeenCalledWith('spotifyToken', tokens);
      expect(user.save).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/integrations?music=spotify'));
    });

    it('deep-links back into the native app on success when the state carried returnTo=app', async () => {
      spotify.exchangeCode.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600000 });
      spotify.getProfile.mockResolvedValue({ spotifyId: 'sp', displayName: 'T' });
      User.findById.mockResolvedValue(buildUser());

      const res = buildRes();
      await ctrl.spotifyCallback({ query: { code: 'auth-code', state: appState() }, cookies: {} }, res);

      expect(res.redirect).toHaveBeenCalledWith('kokonada://integrations?music=spotify');
    });

    it('deep-links an error back into the native app when returnTo=app', async () => {
      const res = buildRes();
      await ctrl.spotifyCallback({ query: { error: 'access_denied', state: appState() }, cookies: {} }, res);

      expect(res.redirect).toHaveBeenCalledWith('kokonada://integrations?error=spotify_access_denied');
    });

    it('redirects with error=spotify_failed on service failure (never raw JSON)', async () => {
      spotify.exchangeCode.mockRejectedValue(new Error('Spotify API down'));

      const user = buildUser();
      User.findById.mockResolvedValue(user);
      const req = { query: { code: 'code', state: validState() }, cookies: {} };
      const res = buildRes();
      await ctrl.spotifyCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=spotify_failed'));
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('spotifyDisconnect', () => {
    it('nulls the spotifyToken and saves', async () => {
      const user = buildUser({ spotifyToken: { blob: 'encrypted' } });
      const req  = { user };
      const res  = buildRes();

      await ctrl.spotifyDisconnect(req, res, jest.fn());

      expect(user.spotifyToken).toBeNull();
      expect(user.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: 'Spotify disconnected' });
    });
  });

  describe('spotifyStatus', () => {
    it('returns connected=true when blob is present', () => {
      const req = { user: buildUser({ spotifyToken: { blob: 'encrypted-blob' } }) };
      const res = buildRes();
      ctrl.spotifyStatus(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
    });

    it('returns connected=false when spotifyToken is null', () => {
      const req = { user: buildUser({ spotifyToken: null }) };
      const res = buildRes();
      ctrl.spotifyStatus(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ connected: false }));
    });

    it('reports canSave when the granted scopes include user-library-modify (audit #5)', () => {
      const req = { user: buildUser({
        spotifyToken: { blob: 'x' },
        spotifyScopes: 'user-read-private user-library-modify',
      }) };
      const res = buildRes();
      ctrl.spotifyStatus(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        connected: true, hasLibraryWrite: true, canSave: true,
      }));
    });

    it('reports canSave=false when the token predates the write scopes', () => {
      const req = { user: buildUser({ spotifyToken: { blob: 'x' }, spotifyScopes: 'user-read-private user-top-read' }) };
      const res = buildRes();
      ctrl.spotifyStatus(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ canSave: false, hasLibraryWrite: false }));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// YOUTUBE
// ═══════════════════════════════════════════════════════════════════════════════
describe('YouTube OAuth flow', () => {
  beforeEach(() => { jest.clearAllMocks(); youtube.isConfigured.mockReturnValue(true); });

  it('youtubeConnect redirects with a signed state and sets no cookie', () => {
    youtube.getAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?...');

    const res = buildRes();
    ctrl.youtubeConnect({ user: buildUser() }, res);

    expect(youtube.getAuthUrl).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('youtubeConnect redirects with error=youtube_unconfigured when creds are missing', () => {
    youtube.isConfigured.mockReturnValue(false);

    const res = buildRes();
    ctrl.youtubeConnect({ user: buildUser() }, res);

    expect(youtube.getAuthUrl).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=youtube_unconfigured'));
  });

  it('youtubeCallback redirects with error=youtube_state on a tampered state', async () => {
    const req = { query: { code: 'c', state: 'bad' }, cookies: {} };
    const res = buildRes();
    await ctrl.youtubeCallback(req, res);
    expect(youtube.exchangeCode).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=youtube_state'));
  });

  it('youtubeCallback encrypts tokens and redirects on success', async () => {
    const tokens  = { accessToken: 'ytat', refreshToken: 'ytrt', expiresAt: Date.now() + 3600000 };
    const channel = { channelId: 'UCxyz', displayName: 'My Channel' };

    youtube.exchangeCode.mockResolvedValue(tokens);
    youtube.getChannel.mockResolvedValue(channel);

    const user = buildUser();
    User.findById.mockResolvedValue(user);
    const req  = { query: { code: 'yt-code', state: signOauthState('user-123', 'youtube') }, cookies: {} };

    await ctrl.youtubeCallback(req, buildRes());

    expect(user.setToken).toHaveBeenCalledWith('youtubeMusicToken', tokens);
    expect(user.save).toHaveBeenCalled();
  });

  it('youtubeDisconnect re-loads the full user, nulls token, and saves', async () => {
    // auth() strips token blobs, so the handler re-loads via User.findById.
    const user = buildUser({ youtubeMusicToken: { blob: 'enc' } });
    User.findById.mockResolvedValue(user);
    const res = buildRes();
    await ctrl.youtubeDisconnect({ user: { _id: user._id } }, res, jest.fn());
    expect(user.youtubeMusicToken).toBeNull();
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'YouTube Music disconnected' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GARMIN (OAuth 1.0a)
// ═══════════════════════════════════════════════════════════════════════════════
describe('Garmin OAuth 2.0 + PKCE flow', () => {
  beforeEach(() => { jest.clearAllMocks(); garmin.isConfigured.mockReturnValue(true); });

  it('garminConnect redirects with a signed PKCE state and sets no cookie', () => {
    garmin.getAuthUrl.mockReturnValue('https://connect.garmin.com/oauth2Confirm?...');
    const res = buildRes();
    ctrl.garminConnect({ user: buildUser() }, res);

    expect(garmin.generatePKCE).toHaveBeenCalled();
    expect(garmin.getAuthUrl).toHaveBeenCalledWith(expect.any(String), 'test-cc'); // (state, codeChallenge)
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('connect.garmin.com'));
  });

  it('garminConnect redirects with error=garmin_unconfigured when creds are missing', () => {
    garmin.isConfigured.mockReturnValue(false);
    const res = buildRes();
    ctrl.garminConnect({ user: buildUser() }, res);

    expect(garmin.getAuthUrl).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_unconfigured'));
  });

  it('garminCallback redirects with error=garmin_state on a tampered state', async () => {
    const res = buildRes();
    await ctrl.garminCallback({ query: { code: 'c', state: 'bad' }, cookies: {} }, res);

    expect(garmin.exchangeCode).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_state'));
  });

  it('garminCallback exchanges the code, stores OAuth2 tokens + garminUserId, and redirects', async () => {
    const tokens = { accessToken: 'gat', refreshToken: 'grt', expiresAt: Date.now() + 3600000 };
    garmin.exchangeCode.mockResolvedValue(tokens);
    garmin.getUserId.mockResolvedValue({ garminUserId: 'garmin-99' });

    const user = buildUser();
    User.findById.mockResolvedValue(user);
    const req = { query: { code: 'auth-code', state: signOauthState('user-123', 'garmin', { cv: 'verifier' }) }, cookies: {} };

    await ctrl.garminCallback(req, buildRes());

    expect(garmin.exchangeCode).toHaveBeenCalledWith('auth-code', 'verifier');
    expect(garmin.getUserId).toHaveBeenCalledWith('gat');
    expect(user.garminUserId).toBe('garmin-99'); // plaintext for webhook routing
    expect(user.setToken).toHaveBeenCalledWith('wearableToken',
      expect.objectContaining({ accessToken: 'gat', refreshToken: 'grt', garminUserId: 'garmin-99' }));
    expect(user.save).toHaveBeenCalled();
  });

  it('garminCallback redirects with error=garmin_failed on token-exchange failure', async () => {
    garmin.exchangeCode.mockRejectedValue(new Error('Garmin token endpoint down'));
    User.findById.mockResolvedValue(buildUser());
    const res = buildRes();
    await ctrl.garminCallback({ query: { code: 'c', state: signOauthState('user-123', 'garmin', { cv: 'v' }) }, cookies: {} }, res);

    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_failed'));
  });

  describe('garminDisconnect', () => {
    it('nulls provider + token and saves', async () => {
      const user = buildUser({ wearableProvider: 'garmin', wearableToken: { blob: 'enc' } });
      await ctrl.garminDisconnect({ user }, buildRes(), jest.fn());
      expect(user.wearableProvider).toBeNull();
      expect(user.wearableToken).toBeNull();
      expect(user.save).toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEARABLE ADAPTER (pure unit — no mocks needed)
// ═══════════════════════════════════════════════════════════════════════════════
describe('wearable adapter — normalize()', () => {
  const ts = '2024-01-15T10:30:00Z';

  describe('Garmin', () => {
    it('maps known activityType integer to canonical label', () => {
      const result = normalize('garmin', { heartRate: 75, activityType: 1, startTimeLocal: ts });
      expect(result).toEqual({ heartRate: 75, activity: 'running', recordedAt: new Date(ts), source: 'garmin' });
    });

    it('maps activityType 0 to resting', () => {
      const result = normalize('garmin', { heartRate: 58, activityType: 0, startTimeLocal: ts });
      expect(result.activity).toBe('resting');
    });

    it('maps unknown activityType to unknown', () => {
      const result = normalize('garmin', { heartRate: 90, activityType: 999, startTimeLocal: ts });
      expect(result.activity).toBe('unknown');
    });
  });

  describe('Apple HealthKit', () => {
    it('maps known workout type to canonical label', () => {
      const result = normalize('apple_health', {
        value: 130, workoutType: 'HKWorkoutActivityTypeRunning', startDate: ts,
      });
      expect(result).toEqual({ heartRate: 130, activity: 'running', recordedAt: new Date(ts), source: 'apple_health' });
    });

    it('maps null workoutType to unknown', () => {
      const result = normalize('apple_health', { value: 72, workoutType: null, startDate: ts });
      expect(result.activity).toBe('unknown');
    });
  });

  describe('Suunto', () => {
    it('maps known sport string to canonical label', () => {
      const result = normalize('suunto', { hr: 145, sport: 'CYCLING', timestamp: ts });
      expect(result).toEqual({ heartRate: 145, activity: 'cycling', recordedAt: new Date(ts), source: 'suunto' });
    });

    it('maps unknown sport to unknown', () => {
      const result = normalize('suunto', { hr: 100, sport: 'YOGA', timestamp: ts });
      expect(result.activity).toBe('unknown');
    });
  });

  it('throws on an unrecognised source string', () => {
    expect(() => normalize('fitbit', { heartRate: 80 })).toThrow('Unknown wearable source');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUUNTO WEBHOOK SIGNATURE VERIFICATION
// Tested directly — extracted logic matches suunto.js verifyWebhookSignature
// (avoids loading BiometricLog/mongoose via requireActual)
// ═══════════════════════════════════════════════════════════════════════════════
describe('Suunto webhook signature verification', () => {
  const crypto = require('crypto');

  // Mirror of the real verifyWebhookSignature function (pure crypto, no DB)
  function realVerify(rawBody, signatureHeader) {
    const secret = process.env.SUUNTO_WEBHOOK_SECRET;
    if (!secret) return process.env.NODE_ENV !== 'production'; // fail-closed in prod
    let expected, provided;
    try {
      expected = Buffer.from(
        crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex'
      );
      provided = Buffer.from(signatureHeader || '', 'hex');
    } catch {
      return false;
    }
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  }

  it('accepts a valid HMAC-SHA256 signature', () => {
    const body   = JSON.stringify({ hr: 120, sport: 'RUNNING', timestamp: '2024-01-15T10:30:00Z' });
    const secret = process.env.SUUNTO_WEBHOOK_SECRET;
    const sig    = crypto.createHmac('sha256', secret).update(body).digest('hex');

    expect(realVerify(body, sig)).toBe(true);
  });

  it('rejects an incorrect signature', () => {
    const body = JSON.stringify({ hr: 120 });
    expect(realVerify(body, 'deadbeef'.repeat(8))).toBe(false);
  });

  it('rejects when signature header is empty string (length mismatch throws)', () => {
    const body = JSON.stringify({ hr: 100 });
    let result;
    try {
      result = realVerify(body, '');
    } catch {
      result = false;
    }
    expect(result).toBe(false);
  });

  it('skips verification (dev convenience) when SUUNTO_WEBHOOK_SECRET is not set in non-prod', () => {
    const saved = process.env.SUUNTO_WEBHOOK_SECRET;
    delete process.env.SUUNTO_WEBHOOK_SECRET;
    expect(realVerify('any body', 'any sig')).toBe(true);
    process.env.SUUNTO_WEBHOOK_SECRET = saved;
  });

  it('fails closed (returns false) when secret is unset in production', () => {
    const savedSecret = process.env.SUUNTO_WEBHOOK_SECRET;
    const savedEnv    = process.env.NODE_ENV;
    delete process.env.SUUNTO_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    expect(realVerify('any body', 'any sig')).toBe(false);
    process.env.SUUNTO_WEBHOOK_SECRET = savedSecret;
    process.env.NODE_ENV = savedEnv;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEARABLE STATUS endpoint
// ═══════════════════════════════════════════════════════════════════════════════
describe('wearableStatus', () => {
  it('returns connected=true and provider when wearableToken blob is set', () => {
    const req = { user: buildUser({ wearableProvider: 'garmin', wearableToken: { blob: 'enc' } }) };
    const res = buildRes();
    ctrl.wearableStatus(req, res);
    expect(res.json).toHaveBeenCalledWith({ provider: 'garmin', connected: true });
  });

  it('returns connected=true for apple_health (no token blob needed)', () => {
    const req = { user: buildUser({ wearableProvider: 'apple_health', wearableToken: null }) };
    const res = buildRes();
    ctrl.wearableStatus(req, res);
    expect(res.json).toHaveBeenCalledWith({ provider: 'apple_health', connected: true });
  });

  it('returns connected=false and provider=null when nothing connected', () => {
    const req = { user: buildUser() };
    const res = buildRes();
    ctrl.wearableStatus(req, res);
    expect(res.json).toHaveBeenCalledWith({ provider: null, connected: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GARMIN HEALTH API WEBHOOK (server-to-server push)
// ═══════════════════════════════════════════════════════════════════════════════
describe('garminWebhook', () => {
  const secret = 'garmin_webhook_secret';
  beforeEach(() => jest.clearAllMocks());

  it('rejects a wrong/missing secret with 401 and never ingests', async () => {
    const res = buildRes();
    await ctrl.garminWebhook({ query: { secret: 'nope' }, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(garminIngest.ingestSummaries).not.toHaveBeenCalled();
  });

  it('groups summaries per Garmin user and ingests for a known user', async () => {
    User.findOne.mockReturnValue({ select: () => Promise.resolve({ _id: 'user-1' }) });
    garminIngest.ingestSummaries.mockResolvedValue({ accepted: 2, inserted: 1, profileMetrics: {} });

    const body = {
      sleeps:  [{ userId: 'g1', startTimeInSeconds: 1, deepSleepDurationInSeconds: 3600 }],
      dailies: [{ userId: 'g1', startTimeInSeconds: 1, restingHeartRateInBeatsPerMinute: 52 }],
    };
    const res = buildRes();
    await ctrl.garminWebhook({ query: { secret }, body }, res, jest.fn());

    expect(User.findOne).toHaveBeenCalledWith({ garminUserId: 'g1', deletedAt: null });
    const [uid, items] = garminIngest.ingestSummaries.mock.calls[0];
    expect(uid).toBe('user-1');
    expect(items).toHaveLength(2); // sleeps + dailies grouped for g1
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true, users: 1 });
  });

  it('skips summaries whose Garmin userId maps to no user', async () => {
    User.findOne.mockReturnValue({ select: () => Promise.resolve(null) });
    const res = buildRes();
    await ctrl.garminWebhook({ query: { secret }, body: { sleeps: [{ userId: 'ghost', startTimeInSeconds: 1 }] } }, res, jest.fn());
    expect(garminIngest.ingestSummaries).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true, users: 0 });
  });

  // ── audit T2.1 — fail-closed + header secret + constant-time + injection guard ──

  it('fails closed with 503 when the secret is UNSET in production (no unauthenticated writes)', async () => {
    const prevSecret = process.env.GARMIN_WEBHOOK_SECRET;
    const prevEnv = process.env.NODE_ENV;
    delete process.env.GARMIN_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    try {
      const res = buildRes();
      await ctrl.garminWebhook({ headers: {}, query: {}, body: {} }, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ error: 'garmin webhook not configured' });
      expect(garminIngest.ingestSummaries).not.toHaveBeenCalled();
    } finally {
      process.env.GARMIN_WEBHOOK_SECRET = prevSecret;
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('accepts the secret via the x-garmin-webhook-secret HEADER and ingests', async () => {
    User.findOne.mockReturnValue({ select: () => Promise.resolve({ _id: 'user-1' }) });
    garminIngest.ingestSummaries.mockResolvedValue({ accepted: 1, inserted: 1, profileMetrics: {} });
    const res = buildRes();
    await ctrl.garminWebhook({
      headers: { 'x-garmin-webhook-secret': secret },
      query: {},
      body: { dailies: [{ userId: 'g1', startTimeInSeconds: 1, restingHeartRateInBeatsPerMinute: 52 }] },
    }, res, jest.fn());
    expect(User.findOne).toHaveBeenCalledWith({ garminUserId: 'g1', deletedAt: null });
    expect(res.json).toHaveBeenCalledWith({ received: true, users: 1 });
  });

  it('rejects a wrong header secret with 401 via a CONSTANT-TIME compare (timingSafeEqualStr)', async () => {
    const spy = jest.spyOn(timingSafe, 'timingSafeEqualStr');
    try {
      const res = buildRes();
      // A different-length wrong secret must NOT throw — proves the digest-based compare.
      await ctrl.garminWebhook({ headers: { 'x-garmin-webhook-secret': 'x' }, query: {}, body: {} }, res, jest.fn());
      expect(spy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(garminIngest.ingestSummaries).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a non-string userId (NoSQL operator injection) and never queries the DB', async () => {
    const res = buildRes();
    await ctrl.garminWebhook({
      headers: { 'x-garmin-webhook-secret': secret },
      query: {},
      body: { sleeps: [{ userId: { $gt: '' }, startTimeInSeconds: 1 }] },
    }, res, jest.fn());
    expect(User.findOne).not.toHaveBeenCalled();
    expect(garminIngest.ingestSummaries).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true, users: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH-STORE BATCH INGEST (HealthKit / Health Connect medical-profile backfill)
// ═══════════════════════════════════════════════════════════════════════════════
describe('healthBatchIngest', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ingests the batch via the health-store service and returns its result', async () => {
    healthStore.ingestBatch.mockResolvedValue({ accepted: 3, profileMetrics: { restingHeartRate: 55 } });
    const user = buildUser({ wearableProvider: 'apple_health' });
    const samples = [{ type: 'heart_rate', value: 72, startDate: '2026-01-15T03:30:00Z' }];
    const req = { user, body: { platform: 'healthkit', samples } };
    const res = buildRes();

    await ctrl.healthBatchIngest(req, res, jest.fn());

    expect(healthStore.ingestBatch).toHaveBeenCalledWith(user._id, 'healthkit', samples);
    expect(res.json).toHaveBeenCalledWith({ accepted: 3, profileMetrics: { restingHeartRate: 55 } });
  });

  it('marks wearableProvider on first push (health_connect → health_connect)', async () => {
    healthStore.ingestBatch.mockResolvedValue({ accepted: 1 });
    const user = buildUser({ wearableProvider: null });

    await ctrl.healthBatchIngest({ user, body: { platform: 'health_connect', samples: [] } }, buildRes(), jest.fn());

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(user._id, { wearableProvider: 'health_connect' });
  });

  it('does not re-set wearableProvider when already on the same provider', async () => {
    healthStore.ingestBatch.mockResolvedValue({ accepted: 1 });
    const user = buildUser({ wearableProvider: 'apple_health' });

    await ctrl.healthBatchIngest({ user, body: { platform: 'healthkit', samples: [] } }, buildRes(), jest.fn());

    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 for an unrecognised platform and never calls the service', async () => {
    const res = buildRes();
    await ctrl.healthBatchIngest({ user: buildUser(), body: { platform: 'fitbit', samples: [] } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(healthStore.ingestBatch).not.toHaveBeenCalled();
  });

  it('forwards service errors to next (no raw 500 body)', async () => {
    const err = new Error('db down');
    healthStore.ingestBatch.mockRejectedValue(err);
    const next = jest.fn();

    await ctrl.healthBatchIngest({ user: buildUser(), body: { platform: 'healthkit', samples: [] } }, buildRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO-FEATURE HYDRATION
// ═══════════════════════════════════════════════════════════════════════════════
describe('hydrateLibrary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hydrates the user library and returns the provider summary', async () => {
    const library = [{ id: 'y1', provider: 'youtube_music' }, { id: 'y2', provider: 'youtube_music' }];
    MusicProfile.findOne.mockReturnValue({ lean: () => Promise.resolve({ library }) });
    featureService.hydrate.mockResolvedValue({ requested: 2, api: 0, llm: 2, failed: 0 });

    const res = buildRes();
    await ctrl.hydrateLibrary({ user: { _id: 'u1' } }, res, jest.fn());

    expect(featureService.hydrate).toHaveBeenCalledWith(library);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.objectContaining({ llm: 2 }) }));
  });

  it('returns an empty-library note without calling hydrate when the profile has no tracks', async () => {
    MusicProfile.findOne.mockReturnValue({ lean: () => Promise.resolve({ library: [] }) });

    const res = buildRes();
    await ctrl.hydrateLibrary({ user: { _id: 'u1' } }, res, jest.fn());

    expect(featureService.hydrate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ note: 'empty library' }));
  });
});
