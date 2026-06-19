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
