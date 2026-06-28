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
  create: jest.fn().mockResolvedValue({}),
}));

jest.mock('../app/services/spotify', () => ({
  getValidToken:      jest.fn(),
  getRecommendations: jest.fn(),
}));

jest.mock('../app/services/youtube', () => ({
  getValidToken:         jest.fn(),
  searchRecommendations: jest.fn(),
}));

jest.mock('../app/services/geminiEngine', () => ({
  buildEmotionPlaylist:    jest.fn(),
  adjustBiometricPlaylist: jest.fn(),
}));

jest.mock('../app/services/playlistMixer', () => ({
  mixPlaylist: jest.fn(),
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
const PlaylistSession = require('../app/models/PlaylistSession');
const spotify         = require('../app/services/spotify');
const youtube         = require('../app/services/youtube');
const geminiEngine    = require('../app/services/geminiEngine');
const playlistMixer   = require('../app/services/playlistMixer');

const {
  registerBiometricHandler,
  generateAndEmitPlaylist,
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
  geminiEngine.adjustBiometricPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });
  geminiEngine.buildEmotionPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });
  playlistMixer.mixPlaylist.mockResolvedValue(makeMixedPlaylist());
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
});

function mockBiometricLogs(logs) {
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve(logs) }) });
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
