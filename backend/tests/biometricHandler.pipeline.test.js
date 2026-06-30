'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../app/models/User', () => ({
  findById: jest.fn(),
}));

jest.mock('../app/models/MusicProfile', () => ({
  findOne: jest.fn(),
}));

jest.mock('../app/models/BiometricLog', () => ({
  find: jest.fn(),
}));

jest.mock('../app/models/PlaylistSession', () => ({
  create:         jest.fn().mockResolvedValue({}),
  find:           jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
}));

jest.mock('../app/models/MedicalProfile', () => ({
  findOne: jest.fn().mockResolvedValue(null),
}));

jest.mock('../app/services/spotify', () => ({
  getValidToken:        jest.fn(),
  getRecommendations:   jest.fn(),
  fetchVibeDiscovery:   jest.fn(),
  getArtistsGenres:     jest.fn(),
  artistGenresAvailable: jest.fn(() => true),
}));

jest.mock('../app/services/youtube', () => ({
  getValidToken:         jest.fn(),
  searchRecommendations: jest.fn(),
}));

jest.mock('../app/services/geminiEngine', () => ({
  buildEmotionPlaylist:    jest.fn(),
  adjustBiometricPlaylist: jest.fn(),
  critiqueTrackVibe:       jest.fn(),
}));

jest.mock('../app/services/playlistMixer', () => ({
  mixPlaylist: jest.fn(),
  personalizeWhitelist: jest.fn(),
  generateFallbackPlaylist: jest.fn().mockReturnValue([{ id: 'lib-1' }, { id: 'lib-2' }]),
}));

jest.mock('../app/services/wearable/adapter', () => ({
  normalize: jest.fn((source, raw) => {
    const KNOWN = ['garmin', 'apple_watch', 'fitbit'];
    if (!KNOWN.includes(source)) throw new Error(`Unknown wearable source: ${source}`);
    const ACTIVITY_MAP = { 0: 'resting', 1: 'running', 2: 'cycling', 5: 'swimming', 6: 'walking', 13: 'strength_training' };
    return {
      heartRate: raw.heartRate,
      activity:  raw.activity || ACTIVITY_MAP[raw.activityType] || 'running',
      source,
    };
  }),
}));

const User            = require('../app/models/User');
const MusicProfile    = require('../app/models/MusicProfile');
const BiometricLog    = require('../app/models/BiometricLog');
const MedicalProfile  = require('../app/models/MedicalProfile');
const PlaylistSession = require('../app/models/PlaylistSession');
const spotify         = require('../app/services/spotify');
const youtube         = require('../app/services/youtube');
const geminiEngine    = require('../app/services/geminiEngine');
const playlistMixer   = require('../app/services/playlistMixer');

const {
  registerBiometricHandler,
  generateAndEmitPlaylist,
  isRepeatMood,
  recentMoodCooldown,
  pickSortAxis,
  resolveBiometricContext,
  _debounceMap,
} = require('../app/sockets/biometricHandler');

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeMusicProfile(overrides = {}) {
  return {
    userId: 'user-123',
    restingHeartRate: 60,
    tempoBaseline: 120,
    energy: 0.6,
    valence: 0.5,
    topGenres: ['pop', 'electronic'],
    topArtists: ['Artist A'],
    genreSet: ['pop', 'electronic'],
    knownArtistIds: ['artist-a'],
    library: [
      { id: 'lib-1', provider: 'spotify', tempo: 120, energy: 0.6, valence: 0.5, acousticness: 0.2, genres: ['pop'], artist: 'Artist A' },
      { id: 'lib-2', provider: 'spotify', tempo: 125, energy: 0.65, valence: 0.55, acousticness: 0.15, genres: ['electronic'], artist: 'Artist B' },
    ],
    ...overrides,
  };
}

const SPOTIFY_USER = {
  _id: 'user-123',
  spotifyToken:      { blob: 'encrypted-spotify' },
  youtubeMusicToken: null,
  getToken: jest.fn(),
  save:     jest.fn().mockResolvedValue(true),
};

const YOUTUBE_USER = {
  _id: 'user-123',
  spotifyToken:      null,
  youtubeMusicToken: { blob: 'encrypted-youtube' },
  getToken: jest.fn(),
  save:     jest.fn().mockResolvedValue(true),
};

const BOTH_PROVIDERS_USER = {
  _id: 'user-123',
  spotifyToken:      { blob: 'encrypted-spotify' },
  youtubeMusicToken: { blob: 'encrypted-youtube' },
  getToken: jest.fn(),
  save:     jest.fn().mockResolvedValue(true),
};

const AI_PARAMS = {
  target_bpm: 128, target_energy: 0.8, target_valence: 0.7,
  target_acousticness: 0.1, seed_genres: ['electronic'], seed_artists: [],
};

const DISCOVERY_TRACKS = [
  { id: 'd1', name: 'Discovery 1' },
  { id: 'd2', name: 'Discovery 2' },
];

const FAMILIAR_TRACKS  = [{ id: 'lib-1', name: 'Familiar 1' }];
const MERGED_TRACKS    = [...FAMILIAR_TRACKS, ...DISCOVERY_TRACKS];

function makeMixedPlaylist() {
  return { familiar: FAMILIAR_TRACKS, discovery: DISCOVERY_TRACKS, merged: MERGED_TRACKS };
}

// ── Socket mock ────────────────────────────────────────────────────────────────

function makeSocket(userId = 'user-123') {
  const handlers = {};
  return {
    id: `socket-${userId}-${Math.random()}`,
    data: { user: { _id: userId } },
    emit: jest.fn(),
    on:   (event, fn) => { handlers[event] = fn; },
    _trigger: (event, payload) => handlers[event]?.(payload),
  };
}

// ── State helper (mirrors biometricHandler internal state shape) ───────────────

function makeState(overrides = {}) {
  return {
    stableHR:         80,
    pendingHR:        null,
    latestActivity:   'running',
    timer:            null,
    consecutiveSkips: 0,
    lastEmotionTaps:  [],
    lastTextPrompt:   '',
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  User.findById.mockResolvedValue(SPOTIFY_USER);
  MusicProfile.findOne.mockResolvedValue(makeMusicProfile());
  spotify.getValidToken.mockResolvedValue('spotify-access-token');
  spotify.getRecommendations.mockResolvedValue(DISCOVERY_TRACKS);
  spotify.fetchVibeDiscovery.mockResolvedValue(DISCOVERY_TRACKS);
  spotify.getArtistsGenres.mockResolvedValue({});
  geminiEngine.adjustBiometricPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });
  geminiEngine.buildEmotionPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });
  geminiEngine.critiqueTrackVibe.mockImplementation(async ({ tracks }) => tracks);
  playlistMixer.mixPlaylist.mockResolvedValue(makeMixedPlaylist());
  playlistMixer.personalizeWhitelist.mockImplementation((tracks) => tracks);
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
  PlaylistSession.countDocuments.mockResolvedValue(0); // default: no repeat → normal mode
  MedicalProfile.findOne.mockResolvedValue(null);
  mockRecentSessions([]);
});

function mockBiometricLogs(logs) {
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve(logs) }) });
}

// Chainable session-query mock supporting BOTH cooldown reads:
//   recentTrackCooldown: find().sort().limit().select().lean()
//   recentMoodCooldown:  find().sort().select().lean()  (no .limit())
function mockRecentSessions(sessions) {
  const chain = {
    sort:   () => chain,
    limit:  () => chain,
    select: () => chain,
    lean:   () => Promise.resolve(sessions),
  };
  PlaylistSession.find.mockReturnValue(chain);
}

// ── generateAndEmitPlaylist — biometric trigger ───────────────────────────────

describe('generateAndEmitPlaylist — biometric trigger', () => {
  it('calls adjustBiometricPlaylist with musicProfile and heartRate', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ stableHR: 95 }));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        musicProfile: expect.objectContaining({ userId: 'user-123' }),
        biometric:    expect.objectContaining({ heartRate: 95 }),
        fetchTracks:  expect.any(Function),
      })
    );
  });

  it('emits playlist_ready with normalized merged tracks and trigger=biometric', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call[1].trigger).toBe('biometric');
    expect(call[1].tracks).toHaveLength(MERGED_TRACKS.length);
    // Library/discovery fixtures carry only id+name; the pipeline reconstructs the
    // Spotify uri from the id and maps name → title.
    expect(call[1].tracks[0]).toMatchObject({ id: 'lib-1', uri: 'spotify:track:lib-1', title: 'Familiar 1' });
    expect(call[1].tracks.every(t => typeof t.uri === 'string')).toBe(true);
  });

  it('passes familiar and discovery counts in playlist_ready', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      familiar:  FAMILIAR_TRACKS.length,
      discovery: DISCOVERY_TRACKS.length,
    }));
  });

  it('passes a cooldown set built from the last 3 playlists into mixPlaylist', async () => {
    mockRecentSessions([
      { trackIds: ['a', 'b'] },
      { trackIds: ['b', 'c'] },
      { trackIds: ['d'] },
    ]);
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    const arg = playlistMixer.mixPlaylist.mock.calls.at(-1)[0];
    expect(arg.cooldownIds).toBeInstanceOf(Set);
    expect([...arg.cooldownIds].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('calls mixPlaylist with aiParams from adjustBiometricPlaylist', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(playlistMixer.mixPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ aiParams: AI_PARAMS })
    );
  });

  it('uses Spotify provider when user has Spotify token', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(spotify.getValidToken).toHaveBeenCalled();
    expect(youtube.getValidToken).not.toHaveBeenCalled();
  });
});

// ── generateAndEmitPlaylist — emotion trigger ─────────────────────────────────

describe('generateAndEmitPlaylist — emotion trigger', () => {
  it('calls buildEmotionPlaylist with stored taps and textPrompt', async () => {
    const socket = makeSocket();
    const taps = [{ x: 0.2, y: 0.7 }, { x: -0.3, y: 0.5 }];
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: taps,
      lastTextPrompt:  'Focus music',
    }));

    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        musicProfile: expect.objectContaining({ userId: 'user-123' }),
        emotionTaps:  taps,
        textPrompt:   'Focus music',
        fetchTracks:  expect.any(Function),
      })
    );
  });

  it('emits playlist_ready with trigger=emotion and normalized tracks', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
    }));

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call[1].trigger).toBe('emotion');
    expect(call[1].tracks).toHaveLength(MERGED_TRACKS.length);
    expect(call[1].tracks.every(t => typeof t.uri === 'string')).toBe(true);
  });

  it('falls back to adjustBiometricPlaylist when emotion taps are empty', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [] }));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalled();
    expect(geminiEngine.buildEmotionPlaylist).not.toHaveBeenCalled();
  });

  it('passes the selected activity through to buildEmotionPlaylist', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
      lastActivity:    'Running',
    }));

    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ activity: 'Running' })
    );
  });

  it('routes an activity-only request (no taps, no text) to the emotion pipeline', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [],
      lastTextPrompt:  '',
      lastActivity:    'Cooking',
    }));

    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalled();
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('passes a 24h biometric snapshot to buildEmotionPlaylist when a MedicalProfile exists', async () => {
    MedicalProfile.findOne.mockResolvedValue({
      restingHeartRate: 58, hrv: 22, bodyBattery: 70, dailyReadiness: 65,
      spO2: 98, respirationRate: 14, sleepStages: { deep: 50, light: 210, rem: 70 },
    });
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
      stableHR:        88,
    }));

    const arg = geminiEngine.buildEmotionPlaylist.mock.calls.at(-1)[0];
    expect(arg.biometricContext).toMatchObject({
      restingHeartRate: 58, heartRate: 88, bodyBattery: 70,
    });
  });

  it('passes biometricContext=null when the user has no MedicalProfile', async () => {
    MedicalProfile.findOne.mockResolvedValue(null);
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
    }));

    const arg = geminiEngine.buildEmotionPlaylist.mock.calls.at(-1)[0];
    expect(arg.biometricContext).toBeNull();
  });
});

// ── emotion_update handler — activity capture ─────────────────────────────────

describe('emotion_update handler', () => {
  it('caches the selected activity on socket state', () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('emotion_update', { taps: [{ x: 0.5, y: 0.5 }], textPrompt: 'x', activity: 'Cooking' });

    expect(_debounceMap.get(socket.id).lastActivity).toBe('Cooking');
  });

  it('normalizes a missing activity to null', () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('emotion_update', { taps: [], textPrompt: '' });

    expect(_debounceMap.get(socket.id).lastActivity).toBeNull();
  });
});

// ── resolveBiometricContext ───────────────────────────────────────────────────

describe('resolveBiometricContext', () => {
  it('returns a structured snapshot with a computed state label and HR ratio', async () => {
    MedicalProfile.findOne.mockResolvedValue({
      restingHeartRate: 60, hrv: 15, bodyBattery: 30, dailyReadiness: 40,
      spO2: 97, respirationRate: 22, sleepStages: { deep: 30, light: 180, rem: 50 },
    });

    const ctx = await resolveBiometricContext('user-123', 95);
    expect(ctx).toMatchObject({ heartRate: 95, restingHeartRate: 60, hrv: 15, bodyBattery: 30 });
    expect(ctx.hrRatio).toBeCloseTo(1.58, 2);
    expect(typeof ctx.stateLabel).toBe('string');
    expect(ctx.sleep).toEqual({ deep: 30, light: 180, rem: 50 });
  });

  it('returns null when the user has no MedicalProfile', async () => {
    MedicalProfile.findOne.mockResolvedValue(null);
    expect(await resolveBiometricContext('user-123', 80)).toBeNull();
  });

  it('returns null when the profile carries no usable scalar signal', async () => {
    MedicalProfile.findOne.mockResolvedValue({
      restingHeartRate: null, hrv: null, bodyBattery: null, dailyReadiness: null,
      spO2: null, respirationRate: null, sleepStages: { deep: null, light: null, rem: null },
    });
    expect(await resolveBiometricContext('user-123', 80)).toBeNull();
  });

  it('degrades to null when the MedicalProfile query throws', async () => {
    MedicalProfile.findOne.mockRejectedValue(new Error('db down'));
    expect(await resolveBiometricContext('user-123', 80)).toBeNull();
  });
});

// ── generateAndEmitPlaylist — skip_loop trigger ───────────────────────────────

describe('generateAndEmitPlaylist — skip_loop trigger', () => {
  it('emits playlist_ready with trigger=skip_loop', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'skip_loop', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      trigger: 'skip_loop',
    }));
  });

  it('calls adjustBiometricPlaylist (not emotion pipeline) on skip', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'skip_loop', makeState({ lastEmotionTaps: [] }));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalled();
    expect(geminiEngine.buildEmotionPlaylist).not.toHaveBeenCalled();
  });
});

// ── Provider selection ────────────────────────────────────────────────────────

describe('provider selection', () => {
  it('prefers Spotify over YouTube when both are connected', async () => {
    User.findById.mockResolvedValue(BOTH_PROVIDERS_USER);
    spotify.getValidToken.mockResolvedValue('spotify-token');

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(spotify.getValidToken).toHaveBeenCalled();
    expect(youtube.getValidToken).not.toHaveBeenCalled();
  });

  it('uses YouTube when only YouTube is connected', async () => {
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
    youtube.searchRecommendations.mockResolvedValue(DISCOVERY_TRACKS);
    geminiEngine.adjustBiometricPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(youtube.getValidToken).toHaveBeenCalled();
    expect(spotify.getValidToken).not.toHaveBeenCalled();
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('emits playlist_error when no music provider is connected', async () => {
    User.findById.mockResolvedValue({
      _id: 'user-123',
      spotifyToken:      null,
      youtubeMusicToken: null,
      getToken: jest.fn(),
      save:     jest.fn(),
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({
      message: expect.any(String),
    }));
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('emits playlist_error when MusicProfile does not exist', async () => {
    MusicProfile.findOne.mockResolvedValue(null);

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({
      message: expect.any(String),
    }));
  });

  it('emits playlist_ready with fallback:true when Gemini fails and library is non-empty', async () => {
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Gemini timeout'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      trigger:   'biometric',
      fallback:  true,
      tracks:    expect.any(Array),
      discovery: 0,
    }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });

  it('fallback playlist_ready carries library tracks and familiar count', async () => {
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Gemini timeout'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call[1].tracks.length).toBeGreaterThan(0);
    expect(call[1].familiar).toBe(call[1].tracks.length);
  });

  it('emits playlist_error (not playlist_ready) when Gemini fails and library is empty', async () => {
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Gemini timeout'));
    playlistMixer.generateFallbackPlaylist.mockReturnValueOnce([]);

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({
      message: expect.any(String),
    }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('emits playlist_error (not an empty playlist_ready) when the mixed playlist is empty', async () => {
    playlistMixer.mixPlaylist.mockResolvedValueOnce({ familiar: [], discovery: [], merged: [] });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }] }));

    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({ message: expect.any(String) }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
  });
});

// ── "Listen to your heart" (request_heart_playlist) ───────────────────────────

describe('request_heart_playlist', () => {
  async function fireHeart(socket, payload) {
    registerBiometricHandler(socket);
    socket._trigger('request_heart_playlist', payload);
    await new Promise(r => setTimeout(r, 50));
  }

  it('uses the averaged HR from the last 30 min of logs when available', async () => {
    mockBiometricLogs([
      { heartRate: 120, activity: 'running' },
      { heartRate: 100, activity: 'running' },
    ]);
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 1 });

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 110 }) }),
    );
  });

  it('falls back to the client-reported current HR when there is no logged data', async () => {
    mockBiometricLogs([]);
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 2, heartRate: 88 });

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 88 }) }),
    );
  });

  it('falls back to resting HR from the profile when no logs or current HR exist', async () => {
    mockBiometricLogs([]);
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 3 }); // no client HR, fresh state → no stableHR

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 60 }) }), // makeMusicProfile.restingHeartRate
    );
  });

  it('emits playlist_ready with trigger=heart (immediate, not queued)', async () => {
    mockBiometricLogs([{ heartRate: 95, activity: 'walking' }]);
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 4 });

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({ trigger: 'heart', reqId: 4 }));
  });

  it('emits playlist_error when there is no heart data of any kind', async () => {
    mockBiometricLogs([]);
    MusicProfile.findOne.mockResolvedValue({ ...makeMusicProfile(), restingHeartRate: null });
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 5 });

    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({ message: expect.any(String) }));
  });
});

// ── mode + reqId threading (Bugs 1-3: export mode survives, stale results dropped) ─

describe('mode + reqId threading', () => {
  it('echoes the chosen mode and reqId back in playlist_ready', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
      lastMode:  'export',
      lastReqId: 7,
    }));

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      mode:  'export',
      reqId: 7,
    }));
  });

  it('in-flight guard prevents a second overlapping generation on the same state', async () => {
    const socket = makeSocket();
    const state = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }] });

    // Fire two without awaiting the first — the second must be collapsed.
    const p1 = generateAndEmitPlaylist(socket, 'emotion', state);
    const p2 = generateAndEmitPlaylist(socket, 'emotion', state);
    await Promise.all([p1, p2]);

    const readyCalls = socket.emit.mock.calls.filter(c => c[0] === 'playlist_ready');
    expect(readyCalls).toHaveLength(1);
  });
});

// ── Agent 1: Bug 8 routing, session honesty, HR validation, mood fallback ─────

describe('Bug 8 — strict branch routing', () => {
  it('routes a custom-text-only request (no taps) to the emotion pipeline, not HR', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [],
      lastTextPrompt:  'rainy day jazz',
    }));
    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalled();
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });
});

describe('session-history honesty (records what actually drove the generation)', () => {
  it('records the emotion taps + prompt for an emotion generation', async () => {
    const socket = makeSocket();
    const taps = [{ x: 0.1, y: 0.95 }];
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: taps, lastTextPrompt: 'gym' }));
    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({
      emotionTaps: taps, contextPrompt: 'gym',
    }));
  });

  it('does NOT record stale emotion context for a heart/biometric generation', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({
      lastEmotionTaps: [{ x: 0.9, y: 0.9 }],
      lastTextPrompt:  'stale mood',
    }));
    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({
      emotionTaps: [{ x: 0, y: 0 }], contextPrompt: '',
    }));
  });
});

describe('HR physiological validation (Bug: HR=0 / garbage / stale)', () => {
  it('rejects a non-physiological logged HR and falls back to resting', async () => {
    mockBiometricLogs([{ heartRate: 0, activity: 'x' }]);
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('request_heart_playlist', { mode: 'live', reqId: 11 });
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 60 }) }),
    );
  });
});

describe('mood-aware fallback when the LLM fails (zero-tolerance holds without AI)', () => {
  it('builds a strictly on-vibe playlist instead of off-vibe library tracks', async () => {
    geminiEngine.buildEmotionPlaylist.mockRejectedValue(new Error('Groq 429'));
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    // The fallback mix carried the strict mood exclude_genres (never a plain top-affinity dump).
    const mixCall = playlistMixer.mixPlaylist.mock.calls.find(c => c[0].aiParams && c[0].aiParams.exclude_genres);
    expect(mixCall).toBeDefined();
    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      trigger: 'emotion', fallback: true,
    }));
  });
});

// ── Layer 1+2: vibe sourcing, personalization (absolute filter), critic ───────

describe('vibe pipeline wiring (Spotify)', () => {
  it('emotion branch: mixPlaylist runs with strictPersonalize:true', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));
    expect(playlistMixer.mixPlaylist).toHaveBeenCalledWith(expect.objectContaining({ strictPersonalize: true }));
  });

  it('HR/biometric branch: mixPlaylist runs with strictPersonalize:false (back-compat)', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());
    expect(playlistMixer.mixPlaylist).toHaveBeenCalledWith(expect.objectContaining({ strictPersonalize: false }));
  });

  it('Spotify fetchTracks closure sources from vibe playlists, personalizes to taste, then runs the critic', async () => {
    spotify.fetchVibeDiscovery.mockResolvedValue([{ id: 'r1', artists: [{ id: 'a1' }] }]);
    spotify.getArtistsGenres.mockResolvedValue({ a1: ['afrobeat'] });

    let captured;
    geminiEngine.buildEmotionPlaylist.mockImplementation(async ({ fetchTracks }) => {
      captured = fetchTracks;
      return { params: AI_PARAMS, tracks: [] };
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    const result = await captured({ ...AI_PARAMS, mood_keywords: ['heavy'], playlist_queries: ['beast mode'] });

    expect(spotify.fetchVibeDiscovery).toHaveBeenCalledWith(
      'spotify-access-token',
      expect.objectContaining({ playlist_queries: ['beast mode'] }),
      { limit: 60 },
    );
    expect(playlistMixer.personalizeWhitelist).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'r1', genres: ['afrobeat'] })]),
      expect.objectContaining({ genreSet: expect.anything(), knownArtistIds: expect.anything() }),
    );
    expect(geminiEngine.critiqueTrackVibe).toHaveBeenCalledWith(
      expect.objectContaining({ moodKey: 'intense', moodKeywords: ['heavy'] }),
    );
    expect(result).toEqual([{ id: 'r1', artists: [{ id: 'a1' }], provider: 'spotify', artistIds: ['a1'], genres: ['afrobeat'] }]);
  });

  it('does NOT run the critic on the HR branch (no mood)', async () => {
    let captured;
    geminiEngine.adjustBiometricPlaylist.mockImplementation(async ({ fetchTracks }) => {
      captured = fetchTracks;
      return { params: AI_PARAMS, tracks: [] };
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());
    await captured(AI_PARAMS);

    expect(geminiEngine.critiqueTrackVibe).not.toHaveBeenCalled();
  });

  it('honours VIBE_CRITIC=false by skipping the critic even on the emotion branch', async () => {
    process.env.VIBE_CRITIC = 'false';
    let captured;
    geminiEngine.buildEmotionPlaylist.mockImplementation(async ({ fetchTracks }) => {
      captured = fetchTracks;
      return { params: AI_PARAMS, tracks: [] };
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));
    await captured({ ...AI_PARAMS, playlist_queries: ['beast mode'] });

    expect(geminiEngine.critiqueTrackVibe).not.toHaveBeenCalled();
    delete process.env.VIBE_CRITIC;
  });
});

// ── Socket event dispatch wiring ──────────────────────────────────────────────
// Verify that socket events route to the correct trigger.
// Uses fake timers only for the 60s debounce test.

describe('socket event dispatch wiring', () => {
  it('emotion_update stores taps without triggering generation', () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);

    socket._trigger('emotion_update', { taps: [{ x: 0.5, y: 0.5 }], textPrompt: 'chill' });

    expect(geminiEngine.buildEmotionPlaylist).not.toHaveBeenCalled();
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('request_playlist calls generateAndEmitPlaylist with emotion trigger', async () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);

    const taps = [{ x: 0.3, y: 0.6 }];
    socket._trigger('emotion_update', { taps, textPrompt: 'study' });
    socket._trigger('request_playlist');

    // Wait for the async pipeline to settle
    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ emotionTaps: taps, textPrompt: 'study' })
    );
  });

  it('2 consecutive track_skipped events trigger the pipeline', async () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped');
    socket._trigger('track_skipped');

    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalled();
  });

  it('biometric_push debounce fires pipeline after 60s', async () => {
    jest.useFakeTimers();

    const socket = makeSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', { source: 'garmin', raw: { heartRate: 65 } });
    socket._trigger('biometric_push', { source: 'garmin', raw: { heartRate: 80 } });

    jest.advanceTimersByTime(60_000);

    jest.useRealTimers();

    // Give real async time to settle
    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 80 }) })
    );
  });
});

// ── handleBiometricReading (direct call, bypasses socket event) ───────────────

describe('handleBiometricReading (direct)', () => {
  it('is exported and callable without a socket event', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    expect(typeof handleBiometricReading).toBe('function');
  });

  it('emits biometric_ack on a valid garmin reading', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    const socket = { id: 'direct-test-1', emit: jest.fn(), data: { user: { _id: 'u1' } } };
    const raw = { heartRate: 90, activityType: 6, startTimeLocal: '2026-06-21T10:00:00' };

    handleBiometricReading(socket, 'garmin', raw);

    expect(socket.emit).toHaveBeenCalledWith('biometric_ack', {
      normalized: expect.objectContaining({ heartRate: 90, activity: 'walking', source: 'garmin' }),
    });
  });

  it('emits connection_error on unknown source', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    const socket = { id: 'direct-test-2', emit: jest.fn(), data: { user: { _id: 'u2' } } };

    handleBiometricReading(socket, 'unknown_device', {});

    expect(socket.emit).toHaveBeenCalledWith('connection_error', expect.objectContaining({ message: expect.any(String) }));
  });
});

// ── handleBiometricReading — immediate (5-min watch) mode ─────────────────────

describe('handleBiometricReading immediate mode', () => {
  const { handleBiometricReading, _debounceMap } = require('../app/sockets/biometricHandler');

  it('still emits biometric_ack', () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    expect(socket.emit).toHaveBeenCalledWith('biometric_ack',
      expect.objectContaining({ normalized: expect.objectContaining({ heartRate: 100 }) }));
  });

  it('triggers generation on the first reading (no prior baseline)', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 140 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-trigger when the change is < 25 bpm', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();
    handleBiometricReading(socket, 'garmin', { heartRate: 120 }, { immediate: true }); // delta 20
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('re-triggers when the change is >= 25 bpm', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();
    handleBiometricReading(socket, 'garmin', { heartRate: 130 }, { immediate: true }); // delta 30
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
  });

  it('never starts the 60s debounce (no recalibration_pending, timer stays null)', () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    handleBiometricReading(socket, 'garmin', { heartRate: 130 }, { immediate: true });
    const events = socket.emit.mock.calls.map(c => c[0]);
    expect(events).not.toContain('recalibration_pending');
    expect(_debounceMap.get(socket.id).timer).toBeNull();
  });
});

// ── Activity-mode change trigger (Bug 4) ──────────────────────────────────────

describe('activity-mode change triggers regeneration', () => {
  const { handleBiometricReading } = require('../app/sockets/biometricHandler');

  it('immediate: re-triggers on a new activity even when HR is flat', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100, activityType: 0 }, { immediate: true }); // resting
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();

    handleBiometricReading(socket, 'garmin', { heartRate: 100, activityType: 1 }, { immediate: true }); // running, same HR
    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
  });

  it('immediate: does NOT re-trigger when activity is unchanged and HR delta < 25', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100, activityType: 0 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();

    handleBiometricReading(socket, 'garmin', { heartRate: 110, activityType: 0 }, { immediate: true }); // delta 10, same activity
    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('streaming: starts recalibration on an activity change with a small HR delta', () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100, activityType: 0 }); // baseline resting
    handleBiometricReading(socket, 'garmin', { heartRate: 103, activityType: 1 }); // delta 3, resting→running

    const events = socket.emit.mock.calls.map(c => c[0]);
    expect(events).toContain('recalibration_pending');
  });
});

// ── Extreme anti-repetition (Affinity Trap Breaker) ───────────────────────────

describe('isRepeatMood', () => {
  it('is true when a session with the same mood exists in the window', async () => {
    PlaylistSession.countDocuments.mockResolvedValueOnce(1);
    expect(await isRepeatMood('user-123', 'calm')).toBe(true);
  });

  it('is false when there is no prior session for the mood', async () => {
    PlaylistSession.countDocuments.mockResolvedValueOnce(0);
    expect(await isRepeatMood('user-123', 'calm')).toBe(false);
  });

  it('is false (never strict) for a null mood — the HR branch', async () => {
    expect(await isRepeatMood('user-123', null)).toBe(false);
    expect(PlaylistSession.countDocuments).not.toHaveBeenCalled();
  });

  it('degrades to false on a DB error (a hiccup never wedges strict mode)', async () => {
    PlaylistSession.countDocuments.mockRejectedValueOnce(new Error('mongo down'));
    expect(await isRepeatMood('user-123', 'calm')).toBe(false);
  });
});

describe('recentMoodCooldown', () => {
  it('unions trackIds from every session served under the mood in the window', async () => {
    mockRecentSessions([{ trackIds: ['a', 'b'] }, { trackIds: ['b', 'c'] }]);
    const ids = await recentMoodCooldown('user-123', 'calm');
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('caps the blacklist size', async () => {
    mockRecentSessions([{ trackIds: ['a', 'b', 'c', 'd', 'e'] }]);
    const ids = await recentMoodCooldown('user-123', 'calm', 24, 3);
    expect(ids.size).toBe(3);
  });

  it('returns an empty set for a null mood', async () => {
    const ids = await recentMoodCooldown('user-123', null);
    expect(ids.size).toBe(0);
  });
});

describe('pickSortAxis', () => {
  it('strict mode never returns plain affinity (forces a different slice)', () => {
    for (let i = 0; i < 20; i++) {
      expect(pickSortAxis(`seed-${i}`, true)).not.toBe('affinity');
    }
  });

  it('is deterministic for a given seed', () => {
    expect(pickSortAxis('fixed', false)).toBe(pickSortAxis('fixed', false));
  });
});

describe('strict-mode wiring (repeat mood → inverted ratios + per-mood cooldown)', () => {
  const INTENSE = [{ x: 0.1, y: 0.95 }];

  it('passes inverted ratios, a strict sort axis, and the per-mood cooldown into mixPlaylist', async () => {
    PlaylistSession.countDocuments.mockResolvedValue(1);          // repeat detected
    mockRecentSessions([{ trackIds: ['m1', 'm2'] }]);            // 24h mood blacklist
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: INTENSE }));

    const arg = playlistMixer.mixPlaylist.mock.calls.at(-1)[0];
    expect(arg.ratios).toEqual({ rotation: 0.10 });
    expect(['reverseAffinity', 'random', 'popularity']).toContain(arg.sortAxis);
    expect([...arg.cooldownIds].sort()).toEqual(['m1', 'm2']);
  });

  it('a FIRST press of a mood stays in normal mode (no inverted ratios)', async () => {
    PlaylistSession.countDocuments.mockResolvedValue(0);          // no repeat
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: INTENSE }));

    const arg = playlistMixer.mixPlaylist.mock.calls.at(-1)[0];
    expect(arg.ratios).toBeNull();
  });

  it('STRICT_ANTIREPEAT=false disables strict mode even on a repeat', async () => {
    process.env.STRICT_ANTIREPEAT = 'false';
    PlaylistSession.countDocuments.mockResolvedValue(1);
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: INTENSE }));

    const arg = playlistMixer.mixPlaylist.mock.calls.at(-1)[0];
    expect(arg.ratios).toBeNull();
    delete process.env.STRICT_ANTIREPEAT;
  });

  it('the HR/biometric branch never goes strict (no mood to repeat)', async () => {
    PlaylistSession.countDocuments.mockResolvedValue(1);
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    const arg = playlistMixer.mixPlaylist.mock.calls.at(-1)[0];
    expect(arg.ratios).toBeNull();
    expect(PlaylistSession.countDocuments).not.toHaveBeenCalled();
  });

  it('records the resolved moodKey on the session (and null for the HR branch)', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: INTENSE }));
    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({ moodKey: 'intense' }));

    PlaylistSession.create.mockClear();
    await generateAndEmitPlaylist(makeSocket(), 'biometric', makeState());
    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({ moodKey: null }));
  });
});
