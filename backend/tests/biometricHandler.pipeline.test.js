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
  normalize: jest.fn((source, raw) => ({
    heartRate: raw.heartRate,
    activity:  raw.activity || 'running',
    source,
  })),
}));

const User            = require('../app/models/User');
const MusicProfile    = require('../app/models/MusicProfile');
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
});

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

  it('emits playlist_ready with merged tracks and trigger=biometric', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      trigger: 'biometric',
      tracks:  MERGED_TRACKS,
    }));
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

  it('emits playlist_ready with trigger=emotion', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
    }));

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      trigger: 'emotion',
      tracks:  MERGED_TRACKS,
    }));
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
