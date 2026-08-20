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
const { COOKIE_NAME } = require('../app/utils/jwt');

let httpServer;
let io;
let port;
const clients = [];

function signAccess(expiresIn = '1h', userId = 'user-1') {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn, jwtid: crypto.randomUUID() });
}

function connect(token, overrides = {}) {
  const socket = Client(`http://127.0.0.1:${port}`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
    ...overrides,
  });
  clients.push(socket);
  return socket;
}

// B2 same-domain auth prep (T4): once the SPA + API share a registrable domain,
// the browser sends the httpOnly session cookie automatically — no handshake.auth
// token involved at all. Connects with NO auth.token but WITH a Cookie header,
// mirroring what a same-domain browser socket connection actually looks like.
function connectWithCookie(cookieValue) {
  const socket = Client(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
    extraHeaders: cookieValue ? { Cookie: `${COOKIE_NAME}=${cookieValue}` } : {},
  });
  clients.push(socket);
  return socket;
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

// W4-D27. `expiresIn: '1s'` does NOT mean "valid for 1000 ms". jsonwebtoken floors `iat`
// to whole seconds and `verify` compares whole seconds, so a token signed at offset t
// within its second dies at the END of that second - a real life of `1000 - t` ms,
// uniform in (0, 1000], median 500 (measured). The handshake it had to survive was
// therefore racing a coin-flip deadline, and under a loaded `--runInBand` suite it
// sometimes lost: the server rejected the already-expired token, `connect_error` fired,
// and `await once(socket, 'connect')` - which has no failure path - hung until the test
// ceiling. That is why the symptom was an opaque TIMEOUT rather than an assertion, and
// why raising the ceiling would only have made the hang longer.
//
// The race is now gone rather than widened. Tests that need a token to expire freeze the
// clock first, so the token cannot die during its own handshake at any stall length, then
// step the clock past `exp` to expire it on demand. No wall-clock budget is left to tune.
const EXPIRY_LEAD_SECONDS = 2;

function signExpiringAt(secondsAhead = EXPIRY_LEAD_SECONDS, userId = 'user-1') {
  const exp = Math.floor(Date.now() / 1000) + secondsAhead;
  const token = jwt.sign({ userId, exp }, process.env.JWT_SECRET, { jwtid: crypto.randomUUID() });
  return { token, expiresAtMs: exp * 1000 };
}

// Fake the CLOCK ONLY. Under a frozen `Date` the handshake cannot outlive the token, and
// the in-session guard - `Date.now() / 1000 >= socket.data.tokenExp` - can be tripped
// exactly when the test chooses. Every timer API stays real, which socket.io needs to keep
// doing real IO. Measured: multi-minute jumps DO break engine.io's ping/pong bookkeeping
// (the round trip never lands), so callers step to just past `exp` and no further.
const CLOCK_ONLY_FAKE = {
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask',
    'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
    'setTimeout', 'clearTimeout',
  ],
};

// Every await of a SUCCESSFUL handshake goes through this rather than `once(socket,
// 'connect')`: a rejected handshake leaves that one pending forever, so the test dies on
// the jest ceiling naming no cause. This fails immediately and says what happened.
function connected(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', (err) => reject(new Error(`handshake rejected: ${err.message}`)));
  });
}

// Block the event loop the way a heavy neighbouring suite does under `--runInBand`.
// Measured against the MONOTONIC clock deliberately: these tests freeze `Date`, and a
// `Date.now()` spin would never terminate under a frozen one.
function stallEventLoop(ms) {
  const end = process.hrtime.bigint() + BigInt(ms) * 1000000n;
  while (process.hrtime.bigint() < end) { /* spin */ }
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
  jest.useRealTimers();
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
    await connected(socket);
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

// T4 (B2 same-domain auth prep): the handshake must also accept the httpOnly
// session cookie as an additional path, alongside — not instead of — the existing
// bearer/handshake.auth.token used by native/mobile clients.
describe('socket handshake auth — cookie fallback (B2 same-domain prep)', () => {
  it('accepts a valid session cookie when no handshake.auth.token is present', async () => {
    const socket = connectWithCookie(signAccess());
    await connected(socket);
    expect(socket.connected).toBe(true);
  });

  it('rejects when neither a token nor a cookie is present', async () => {
    const socket = connectWithCookie(null);
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  it('rejects an invalid/garbage cookie value', async () => {
    const socket = connectWithCookie('not-a-real-jwt');
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  it('rejects a cookie carrying a REVOKED jti — logout must close this door too', async () => {
    mockIsRevoked.mockResolvedValue(true);
    const socket = connectWithCookie(signAccess());
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  it('still accepts handshake.auth.token when present — cookie support is additive, not a replacement', async () => {
    const socket = connect(signAccess());
    await connected(socket);
    expect(socket.connected).toBe(true);
  });
});

describe('mid-session token expiry (TOKEN EXPIRATION CHAOS)', () => {
  it('emits auth_expired and disconnects when a packet arrives after the JWT died', async () => {
    // Freeze first, THEN mint and connect: the token cannot lapse during its own
    // handshake. The lapse is then made to happen by stepping the clock, not by sleeping
    // towards it - so the ceiling below is the DEFAULT one, not a widened 10 s.
    jest.useFakeTimers(CLOCK_ONLY_FAKE);
    try {
      const { token, expiresAtMs } = signExpiringAt();
      const socket = connect(token);
      await connected(socket);

      jest.setSystemTime(expiresAtMs + 500);

      const expired = once(socket, 'auth_expired');
      const dropped = once(socket, 'disconnect');
      socket.emit('emotion_update', { taps: [{ x: 0.5, y: 0.5 }] });

      await expired;
      await dropped;
      expect(socket.connected).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps serving packets while the token is still valid', async () => {
    const socket = connect(signAccess('1h'));
    await connected(socket);
    let died = false;
    socket.on('auth_expired', () => { died = true; });
    socket.emit('emotion_update', { taps: [] });
    await new Promise((r) => setTimeout(r, 300));
    expect(died).toBe(false);
    expect(socket.connected).toBe(true);
  });
});

// W4-D27 regression guards. The bug above was a lost race that surfaced as an opaque
// timeout, so both halves are pinned: a token can no longer die during its own handshake,
// and a handshake rejected for any other reason can no longer hang.
describe('handshake timing guards (W4-D27)', () => {
  it('mints an expiry at a known instant, which expiresIn:"1s" does not', () => {
    const { token, expiresAtMs } = signExpiringAt();

    // The caller is told the exact millisecond the server's guard flips.
    expect(jwt.decode(token).exp * 1000).toBe(expiresAtMs);
    expect(expiresAtMs - Date.now()).toBeGreaterThanOrEqual(1000);
    expect(expiresAtMs - Date.now()).toBeLessThanOrEqual(EXPIRY_LEAD_SECONDS * 1000);

    // The construction this replaced: its life is only the REMAINDER of the current
    // second, so it is under 1000 ms by definition and can be a handful of ms - which is
    // both unknowable to the caller and, at the low end, shorter than a slow handshake.
    const legacy = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '1s' });
    expect(jwt.decode(legacy).exp * 1000 - Date.now()).toBeLessThan(1000);
  });

  it('fails an unexpectedly rejected handshake loudly instead of hanging to the ceiling', async () => {
    const socket = connect('not-a-real-jwt');
    await expect(connected(socket)).rejects.toThrow(/handshake rejected: unauthorized/);
  });

  it('loses a stalled handshake with the 1s-token construction — the defect itself', async () => {
    // On a real clock, 1100 ms exceeds every life a `1s` token can have (<= 1000 ms), so
    // this rejection is certain rather than likely. This is the mechanism that produced
    // the intermittent CI red, reproduced on demand.
    const legacy = connect(jwt.sign(
      { userId: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '1s', jwtid: crypto.randomUUID() },
    ));
    stallEventLoop(1100);
    await expect(connected(legacy)).rejects.toThrow(/handshake rejected: unauthorized/);
  });

  it('survives the same stall — and one longer than the whole lead — once the clock is frozen', async () => {
    // 2100 ms exceeds the WHOLE lead, so deleting the freeze fails this deterministically
    // rather than turning it into another sometimes-test. The client's own connect timeout
    // is lifted for this one socket so that the TOKEN is the only thing under test —
    // otherwise the 2 s default is what expires, which is a different fact.
    jest.useFakeTimers(CLOCK_ONLY_FAKE);
    try {
      const { token } = signExpiringAt();
      const fixed = connect(token, { timeout: 10000 });
      stallEventLoop(2100);
      await connected(fixed);
      expect(fixed.connected).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
