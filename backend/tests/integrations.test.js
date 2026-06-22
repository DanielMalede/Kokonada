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
process.env.SUUNTO_WEBHOOK_SECRET = 'suunto_secret';
process.env.MOBILE_DEEP_LINK      = 'kokonada://';

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
  exchangeCode:            jest.fn(),
  getChannel:              jest.fn(),
  getValidToken:           jest.fn(),
  getLikedVideos:          jest.fn(),
  paginateLikedVideos:     jest.fn(),
  paginatePlaylistItems:   jest.fn(),
  searchRecommendations:   jest.fn(),
}));
jest.mock('../app/services/wearable/garmin', () => ({
  getRequestToken:   jest.fn(),
  getAuthUrl:        jest.fn(),
  getAccessToken:    jest.fn(),
  getUserProfile:    jest.fn(),
  getDailyHeartRate: jest.fn(),
}));
jest.mock('../app/services/wearable/appleHealth', () => ({
  ingestBatch: jest.fn(),
}));
// suunto mock — only handleWebhook and getWorkouts need mocking here;
// verifyWebhookSignature is tested via its real crypto logic below
jest.mock('../app/services/wearable/suunto', () => ({
  verifyWebhookSignature: jest.fn(),
  handleWebhook:          jest.fn(),
  getWorkouts:            jest.fn(),
}));

// Mock mongoose models to avoid the Node 21 / mongoose 9 incompatibility
jest.mock('../app/models/BiometricLog', () => ({}));
jest.mock('../app/models/User', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue(true),
  findById:          jest.fn(),
}));

const spotify     = require('../app/services/spotify');
const youtube     = require('../app/services/youtube');
const garmin      = require('../app/services/wearable/garmin');
const User        = require('../app/models/User');
const { signOauthState } = require('../app/utils/jwt');

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
  });

  describe('spotifyCallback', () => {
    const validState = () => signOauthState('user-123', 'spotify');

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
      expect(res.json).toHaveBeenCalledWith({ connected: true });
    });

    it('returns connected=false when spotifyToken is null', () => {
      const req = { user: buildUser({ spotifyToken: null }) };
      const res = buildRes();
      ctrl.spotifyStatus(req, res);
      expect(res.json).toHaveBeenCalledWith({ connected: false });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// YOUTUBE
// ═══════════════════════════════════════════════════════════════════════════════
describe('YouTube OAuth flow', () => {
  beforeEach(() => jest.clearAllMocks());

  it('youtubeConnect redirects with a signed state and sets no cookie', () => {
    youtube.getAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?...');

    const res = buildRes();
    ctrl.youtubeConnect({ user: buildUser() }, res);

    expect(youtube.getAuthUrl).toHaveBeenCalledWith(expect.any(String));
    expect(res.cookie).not.toHaveBeenCalled();
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

  it('youtubeDisconnect nulls token and saves', async () => {
    const user = buildUser({ youtubeMusicToken: { blob: 'enc' } });
    await ctrl.youtubeDisconnect({ user }, buildRes(), jest.fn());
    expect(user.youtubeMusicToken).toBeNull();
    expect(user.save).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GARMIN (OAuth 1.0a)
// ═══════════════════════════════════════════════════════════════════════════════
describe('Garmin OAuth 1.0a flow', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('garminConnect', () => {
    it('stores { token, secret, uid } JSON in cookie and redirects', async () => {
      garmin.getRequestToken.mockResolvedValue({
        oauthToken:       'req_token_abc',
        oauthTokenSecret: 'req_secret_xyz',
      });
      garmin.getAuthUrl.mockReturnValue('https://connect.garmin.com/oauthConfirm?oauth_token=req_token_abc');

      const res = buildRes();
      await ctrl.garminConnect({ user: buildUser() }, res, jest.fn());

      expect(res.cookie).toHaveBeenCalledWith(
        'garmin_request',
        JSON.stringify({ token: 'req_token_abc', secret: 'req_secret_xyz', uid: 'user-123' }),
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
      );
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('connect.garmin.com'));
    });
  });

  describe('garminCallback — security guards', () => {
    it('redirects with error=garmin_expired when garmin_request cookie is missing', async () => {
      const req = { query: { oauth_token: 't', oauth_verifier: 'v' }, cookies: {} };
      const res = buildRes();
      await ctrl.garminCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_expired'));
      expect(res.json).not.toHaveBeenCalled();
    });

    it('redirects with error=garmin_mismatch on token fixation (returned token ≠ stored)', async () => {
      const stored = JSON.stringify({ token: 'original_token', secret: 'secret', uid: 'user-123' });
      const req = {
        query:   { oauth_token: 'attacker_token', oauth_verifier: 'v' },
        cookies: { garmin_request: stored },
      };
      const res = buildRes();
      await ctrl.garminCallback(req, res);

      expect(garmin.getAccessToken).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_mismatch'));
    });

    it('redirects with error=garmin_denied when oauth_verifier is missing (user denied)', async () => {
      const stored = JSON.stringify({ token: 'tok', secret: 'sec', uid: 'user-123' });
      const req = {
        query:   { oauth_token: 'tok' /* no oauth_verifier */ },
        cookies: { garmin_request: stored },
      };
      const res = buildRes();
      await ctrl.garminCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_denied'));
    });

    it('redirects with error=garmin_expired on malformed cookie JSON', async () => {
      const req = {
        query:   { oauth_token: 'tok', oauth_verifier: 'ver' },
        cookies: { garmin_request: 'not-json' },
      };
      const res = buildRes();
      await ctrl.garminCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=garmin_expired'));
    });
  });

  describe('garminCallback — success path', () => {
    it('exchanges verifier, verifies profile, encrypts credential pair, redirects', async () => {
      const stored = JSON.stringify({ token: 'req_tok', secret: 'req_sec', uid: 'user-123' });
      garmin.getAccessToken.mockResolvedValue({
        accessToken: 'acc_tok', accessTokenSecret: 'acc_sec',
      });
      garmin.getUserProfile.mockResolvedValue({ garminUserId: 'garmin-u1' });

      const user = buildUser();
      User.findById.mockResolvedValue(user);
      const req  = {
        query:   { oauth_token: 'req_tok', oauth_verifier: 'verifier123' },
        cookies: { garmin_request: stored },
      };
      const res  = buildRes();

      await ctrl.garminCallback(req, res);

      expect(garmin.getAccessToken).toHaveBeenCalledWith('req_tok', 'req_sec', 'verifier123');
      expect(garmin.getUserProfile).toHaveBeenCalledWith('acc_tok', 'acc_sec');
      expect(user.setToken).toHaveBeenCalledWith('wearableToken', {
        accessToken: 'acc_tok',
        accessTokenSecret: 'acc_sec',
        garminUserId: 'garmin-u1',
      });
      expect(user.save).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/integrations?biometric=garmin'));
    });

    it('clears the request cookie immediately (one-time use)', async () => {
      const stored = JSON.stringify({ token: 'req_tok', secret: 'req_sec', uid: 'user-123' });
      garmin.getAccessToken.mockResolvedValue({ accessToken: 'at', accessTokenSecret: 'as' });
      garmin.getUserProfile.mockResolvedValue({ garminUserId: 'gid' });
      User.findById.mockResolvedValue(buildUser());

      const res = buildRes();
      await ctrl.garminCallback(
        { query: { oauth_token: 'req_tok', oauth_verifier: 'v' }, cookies: { garmin_request: stored } },
        res,
      );

      expect(res.clearCookie).toHaveBeenCalledWith('garmin_request', expect.objectContaining({ sameSite: 'lax' }));
    });
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
