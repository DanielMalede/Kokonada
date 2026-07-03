'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';
process.env.FRONTEND_URL   = 'http://localhost';

const http = require('http');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Client = require('socket.io-client');

// isRevoked is configurable per-test: the revoked-jti handshake rejection is the
// hole this suite exists to close.
const mockIsRevoked = jest.fn().mockResolvedValue(false);
jest.mock('../app/utils/tokenDenylist', () => ({
  isRevoked: (...a) => mockIsRevoked(...a),
  revoke: jest.fn().mockResolvedValue(true),
}));

jest.mock('../app/config/sentry', () => ({ captureException: jest.fn() }));
jest.mock('../app/sockets/biometricHandler', () => ({ registerBiometricHandler: jest.fn() }));

const USER_DOC = { _id: 'user-1', deletedAt: null };
const mockSelect = jest.fn().mockResolvedValue(USER_DOC);
jest.mock('../app/models/User', () => ({
  findById: jest.fn(() => ({ select: (...a) => mockSelect(...a) })),
}));

const { createSocketServer } = require('../app/sockets/index');

let httpServer;
let io;
let port;
const clients = [];

function signAccess(expiresIn = '1h', userId = 'user-1') {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn, jwtid: crypto.randomUUID() });
}

function connect(token) {
  const socket = Client(`http://127.0.0.1:${port}`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
  });
  clients.push(socket);
  return socket;
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

beforeAll((done) => {
  httpServer = http.createServer();
  io = createSocketServer(httpServer);
  httpServer.listen(0, () => {
    port = httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  // io.close() also closes the http server it is attached to
  io.close(() => done());
});

afterEach(() => {
  while (clients.length) {
    const s = clients.pop();
    if (s.connected) s.disconnect();
    s.close();
  }
  mockIsRevoked.mockResolvedValue(false);
  jest.clearAllMocks();
});

describe('socket handshake auth', () => {
  it('accepts a valid token', async () => {
    const socket = connect(signAccess());
    await once(socket, 'connect');
    expect(socket.connected).toBe(true);
  });

  it('rejects a missing token', async () => {
    const socket = connect(null);
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign(
      { userId: 'user-1', iat: Math.floor(Date.now() / 1000) - 7200 },
      process.env.JWT_SECRET,
      { expiresIn: '1h', jwtid: crypto.randomUUID() },
    );
    const socket = connect(token);
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  it('rejects a REVOKED jti — logout must close the socket door too', async () => {
    mockIsRevoked.mockResolvedValue(true);
    const socket = connect(signAccess());
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  it('rejects a soft-deleted user', async () => {
    mockSelect.mockResolvedValueOnce({ _id: 'user-1', deletedAt: new Date() });
    const socket = connect(signAccess());
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });
});

describe('mid-session token expiry (TOKEN EXPIRATION CHAOS)', () => {
  it('emits auth_expired and disconnects when a packet arrives after the JWT died', async () => {
    const socket = connect(signAccess('1s'));
    await once(socket, 'connect');

    // let the JWT lapse while the socket stays open
    await new Promise((r) => setTimeout(r, 1200));

    const expired = once(socket, 'auth_expired');
    const dropped = once(socket, 'disconnect');
    socket.emit('emotion_update', { taps: [{ x: 0.5, y: 0.5 }] });

    await expired;
    await dropped;
    expect(socket.connected).toBe(false);
  }, 10000);

  it('keeps serving packets while the token is still valid', async () => {
    const socket = connect(signAccess('1h'));
    await once(socket, 'connect');
    let died = false;
    socket.on('auth_expired', () => { died = true; });
    socket.emit('emotion_update', { taps: [] });
    await new Promise((r) => setTimeout(r, 300));
    expect(died).toBe(false);
    expect(socket.connected).toBe(true);
  });
});
