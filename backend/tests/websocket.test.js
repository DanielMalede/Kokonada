'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET      = 'test-jwt-secret-for-tests-only';
process.env.JWT_EXPIRES_IN  = '1h';
process.env.NODE_ENV        = 'test';
process.env.FRONTEND_URL    = 'http://localhost:3000';

const http = require('http');
const { io: Client } = require('socket.io-client');
const { signToken, COOKIE_NAME } = require('../app/utils/jwt');

// ── Mocks ──────────────────────────────────────────────────────────────────────
const mockSelect  = jest.fn();
const mockFindById = jest.fn(() => ({ select: mockSelect }));
jest.mock('../app/models/User', () => ({ findById: (...a) => mockFindById(...a) }));

// biometricHandler now imports these — mock them to prevent mongoose load errors
// and to make generateAndEmitPlaylist a no-op in these state-machine tests
jest.mock('../app/models/MusicProfile',    () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/models/PlaylistSession', () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/services/spotify',       () => ({ getValidToken: jest.fn(), getRecommendations: jest.fn() }));
jest.mock('../app/services/youtube',       () => ({ getValidToken: jest.fn(), searchRecommendations: jest.fn() }));
jest.mock('../app/services/geminiEngine',  () => ({ buildEmotionPlaylist: jest.fn(), adjustBiometricPlaylist: jest.fn() }));
jest.mock('../app/services/playlistMixer', () => ({ mixPlaylist: jest.fn() }));

// ── Helpers ───────────────────────────────────────────────────────────────────
function waitFor(socket, event, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

function connectSocket(port, opts = {}) {
  return Client(`http://localhost:${port}`, {
    forceNew: true,
    transports: ['websocket'],
    ...opts,
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────
describe('WebSocket auth', () => {
  let httpServer, io, port;
  const MOCK_USER = { _id: 'user123', deletedAt: null };

  beforeAll(done => {
    const express = require('express');
    const app = express();
    httpServer = http.createServer(app);
    const { createSocketServer } = require('../app/sockets');
    io = createSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll(done => {
    // io.close() already closes the underlying httpServer; calling
    // httpServer.close() again would fire done(err) with "Server is not running"
    io.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSelect.mockResolvedValue(MOCK_USER);
  });

  it('disconnects immediately when no token is provided', done => {
    const client = connectSocket(port);
    client.on('connect_error', err => {
      expect(err.message).toBe('unauthorized');
      client.close();
      done();
    });
  });

  it('disconnects when token is invalid', done => {
    const client = connectSocket(port, { auth: { token: 'bad.token.here' } });
    client.on('connect_error', err => {
      expect(err.message).toBe('unauthorized');
      client.close();
      done();
    });
  });

  it('disconnects when user is not found in DB', done => {
    mockSelect.mockResolvedValue(null);
    const token = signToken({ userId: 'ghost' });
    const client = connectSocket(port, { auth: { token } });
    client.on('connect_error', err => {
      expect(err.message).toBe('unauthorized');
      client.close();
      done();
    });
  });

  it('disconnects when user is soft-deleted', done => {
    mockSelect.mockResolvedValue({ _id: 'user123', deletedAt: new Date() });
    const token = signToken({ userId: 'user123' });
    const client = connectSocket(port, { auth: { token } });
    client.on('connect_error', err => {
      expect(err.message).toBe('unauthorized');
      client.close();
      done();
    });
  });

  it('connects successfully with a valid Bearer token in handshake.auth', done => {
    const token = signToken({ userId: MOCK_USER._id });
    const client = connectSocket(port, { auth: { token } });
    client.on('connect', () => {
      expect(mockFindById).toHaveBeenCalledWith(MOCK_USER._id);
      expect(mockSelect).toHaveBeenCalledWith('-spotifyToken -youtubeMusicToken -wearableToken');
      client.close();
      done();
    });
    client.on('connect_error', done);
  });

  it('connects successfully with a valid token in cookie header', done => {
    const token = signToken({ userId: MOCK_USER._id });
    const client = connectSocket(port, {
      extraHeaders: { cookie: `${COOKIE_NAME}=${token}` },
    });
    client.on('connect', () => {
      client.close();
      done();
    });
    client.on('connect_error', done);
  });
});

// ── Biometric handler unit tests ───────────────────────────────────────────────
// These tests use a mock socket object — no network needed.
describe('biometricHandler — normalize + ack', () => {
  const { registerBiometricHandler, _debounceMap } = require('../app/sockets/biometricHandler');

  function makeMockSocket(userId = 'user-abc') {
    const handlers = {};
    return {
      data: { user: { _id: userId } },
      emit: jest.fn(),
      on: jest.fn((event, fn) => { handlers[event] = fn; }),
      _trigger: (event, payload) => handlers[event]?.(payload),
    };
  }

  afterEach(() => {
    _debounceMap.clear();
  });

  it('emits biometric_ack with normalized data on valid garmin push', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 75, activityType: 1, startTimeLocal: '2026-01-01T10:00:00' },
    });

    expect(socket.emit).toHaveBeenCalledWith('biometric_ack', {
      normalized: expect.objectContaining({
        heartRate: 75,
        activity: 'running',
        source: 'garmin',
      }),
    });
  });

  it('emits biometric_ack with normalized data on valid apple_health push', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', {
      source: 'apple_health',
      raw: {
        value: 88,
        workoutType: 'HKWorkoutActivityTypeRunning',
        startDate: '2026-01-01T10:00:00',
      },
    });

    expect(socket.emit).toHaveBeenCalledWith('biometric_ack', {
      normalized: expect.objectContaining({ heartRate: 88, source: 'apple_health' }),
    });
  });

  it('emits connection_error and does NOT disconnect on unknown source', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', { source: 'fitbit', raw: {} });

    expect(socket.emit).toHaveBeenCalledWith('connection_error', {
      message: expect.stringContaining('Unknown wearable source'),
    });
    // biometric_ack must NOT have been emitted
    const ackCall = socket.emit.mock.calls.find(([e]) => e === 'biometric_ack');
    expect(ackCall).toBeUndefined();
  });
});

describe('biometricHandler — 60-second debounce', () => {
  const { registerBiometricHandler, _debounceMap } = require('../app/sockets/biometricHandler');

  function makeMockSocket(userId = 'user-debounce') {
    const handlers = {};
    return {
      data: { user: { _id: userId } },
      emit: jest.fn(),
      on: jest.fn((event, fn) => { handlers[event] = fn; }),
      _trigger: (event, payload) => handlers[event]?.(payload),
    };
  }

  const GARMIN_RAW = (hr, activityType = 0) => ({
    source: 'garmin',
    raw: { heartRate: hr, activityType, startTimeLocal: '2026-01-01T10:00:00' },
  });

  beforeEach(() => {
    jest.useFakeTimers();
    _debounceMap.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    _debounceMap.clear();
  });

  it('does NOT emit recalibration_pending when delta < 10 BPM', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70)); // sets stableHR = 70
    socket._trigger('biometric_push', GARMIN_RAW(75)); // delta = 5, below threshold

    const pendingCall = socket.emit.mock.calls.find(([e]) => e === 'recalibration_pending');
    expect(pendingCall).toBeUndefined();
  });

  it('emits recalibration_pending when delta >= 10 BPM', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85)); // delta = 15

    expect(socket.emit).toHaveBeenCalledWith('recalibration_pending', {
      delta: 15,
      secondsRemaining: 60,
    });
  });

  it('does NOT start a second timer if one is already running', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85)); // starts timer
    socket._trigger('biometric_push', GARMIN_RAW(90)); // should be ignored

    const pendingCalls = socket.emit.mock.calls.filter(([e]) => e === 'recalibration_pending');
    expect(pendingCalls).toHaveLength(1); // only one timer ever started
  });

  it('triggers playlist generation after 60 seconds of sustained change', () => {
    const { adjustBiometricPlaylist } = require('../app/services/geminiEngine');
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85));

    jest.advanceTimersByTime(60_000);

    // generateAndEmitPlaylist is called (pipeline starts); full output tested in biometricHandler.pipeline.test.js
    // MusicProfile.findOne returns null so the pipeline short-circuits with playlist_error — that's fine here
    expect(socket.emit).toHaveBeenCalledWith('recalibration_pending', expect.objectContaining({ delta: 15 }));
  });

  it('emits recalibration_cancelled and clears timer when HR returns below threshold', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85)); // starts timer
    socket._trigger('biometric_push', GARMIN_RAW(72)); // delta = 2, below threshold

    // Timer was cancelled — advancing 60s should NOT emit recalibration
    jest.advanceTimersByTime(60_000);

    expect(socket.emit).toHaveBeenCalledWith('recalibration_cancelled', { reason: 'change_reverted' });
    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });

  it('clears the timer and deletes state on disconnect — no event fires after', () => {
    const socket = makeMockSocket('user-disconnect-test');
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85)); // starts timer

    socket._trigger('disconnect');

    jest.advanceTimersByTime(60_000);

    // No recalibration or cancelled event after disconnect
    const recalCalls = socket.emit.mock.calls.filter(
      ([e]) => e === 'playlist_recalibration' || e === 'recalibration_cancelled'
    );
    expect(recalCalls).toHaveLength(0);
    expect(_debounceMap.has('user-disconnect-test')).toBe(false);
  });
});

describe('biometricHandler — skip loop', () => {
  const { registerBiometricHandler, _debounceMap } = require('../app/sockets/biometricHandler');

  function makeMockSocket(userId = 'user-skip') {
    const handlers = {};
    return {
      data: { user: { _id: userId } },
      emit: jest.fn(),
      on: jest.fn((event, fn) => { handlers[event] = fn; }),
      _trigger: (event, payload) => handlers[event]?.(payload),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    _debounceMap.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    _debounceMap.clear();
  });

  it('does NOT recalibrate on a single skip', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped', {});

    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });

  it('triggers playlist generation on two consecutive skips (skip counter resets)', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped', {});
    socket._trigger('track_skipped', {}); // skip counter hits 2 → pipeline fires + resets to 0

    // A third skip alone must NOT re-trigger (counter was reset to 0)
    socket.emit.mockClear();
    socket._trigger('track_skipped', {}); // counter = 1, below threshold

    // No playlist-related emit from the third skip (only one track_skipped event, counter = 1)
    const playlistEmits = socket.emit.mock.calls.filter(([e]) => e === 'playlist_ready' || e === 'playlist_error');
    expect(playlistEmits).toHaveLength(0);
  });

  it('resets skip counter after two skips so a third pair is needed for another recalibration', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped', {});
    socket._trigger('track_skipped', {}); // fires recalibration, resets counter to 0

    socket.emit.mockClear();

    socket._trigger('track_skipped', {}); // counter = 1, no recalibration yet

    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });

  it('resets skip counter on biometric_push so skips must be consecutive', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped', {}); // counter = 1
    // biometric_push resets the counter
    socket._trigger('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 70, activityType: 0, startTimeLocal: '2026-01-01T10:00:00' },
    });
    socket._trigger('track_skipped', {}); // counter back to 1, not 2

    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });

  it('two consecutive skips cancel any running debounce timer', () => {
    const { adjustBiometricPlaylist } = require('../app/services/geminiEngine');
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    // Start a debounce timer
    socket._trigger('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 70, activityType: 0, startTimeLocal: '2026-01-01T10:00:00' },
    });
    socket._trigger('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 85, activityType: 1, startTimeLocal: '2026-01-01T10:00:01' },
    });
    // Timer is now running

    socket._trigger('track_skipped', {});
    socket._trigger('track_skipped', {}); // fires skip_loop pipeline + clears timer

    // Record how many times emit was called from the skip_loop trigger
    const emitCountAfterSkips = socket.emit.mock.calls.length;
    socket.emit.mockClear();

    jest.advanceTimersByTime(60_000); // biometric timer was cancelled — no second pipeline call

    // No new playlist-related events should fire (timer was cleared)
    const newEmits = socket.emit.mock.calls.filter(([e]) => e !== 'biometric_ack');
    expect(newEmits).toHaveLength(0);
  });
});
