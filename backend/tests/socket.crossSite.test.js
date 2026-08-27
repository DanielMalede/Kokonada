'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';

const http = require('http');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Client = require('socket.io-client');

// BE-008 — CROSS-SITE WEBSOCKET HIJACKING.
//
// The handshake used to accept the raw `Cookie:` header as a credential. Four facts made
// that a hole rather than a convenience, and they only compose into one together:
//   1. the session cookie is `SameSite=None; Secure` in production (utils/jwt.js), so the
//      browser attaches it to CROSS-SITE requests;
//   2. a WebSocket upgrade is exempt from the same-origin policy — there is no preflight
//      and no Access-Control-Allow-Origin for the browser to refuse;
//   3. `/socket.io/` never reaches Express middleware at all — Engine.IO installs its own
//      `request`/`upgrade` listeners ahead of Express — so `csrfOriginGuard`, mounted at
//      `/api/`, can never see the handshake;
//   4. Engine.IO's `cors` option is the same `cors` npm middleware, which SETS HEADERS and
//      calls next(). It does not reject an upgrade.
// Net effect: any page on the internet could open a fully authenticated duplex socket for
// any logged-in user and read back Art.9 biometric payloads — against a locked
// zero-knowledge-biometrics decision.
//
// The fix is not an Origin check (nothing reads one, and RN sends none). It is to stop
// accepting an AMBIENT credential the browser attaches by itself: `handshake.auth.token`
// only, which is an explicit act by a real client. Both shipping clients already use it.
//
// These tests are the pin. They were RED before the fallback was removed.

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

function signAccess(userId = 'user-1') {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() });
}

// The attacker's shape: no handshake.auth.token, only the ambient cookie the browser
// would attach by itself, from a page the victim did not author.
function connectAsCrossSitePage(cookieValue, extra = {}) {
  const socket = Client(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
    extraHeaders: {
      ...(cookieValue ? { Cookie: `${COOKIE_NAME}=${cookieValue}` } : {}),
      Origin: 'https://evil.example',
      ...extra,
    },
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
  httpServer.listen(0, () => { port = httpServer.address().port; done(); });
});

afterEach(() => {
  clients.splice(0).forEach((s) => s.close());
  mockIsRevoked.mockResolvedValue(false);
});

afterAll((done) => {
  io.close();
  httpServer.close(done);
});

describe('BE-008 — cross-site WebSocket hijacking is closed', () => {
  it('REJECTS a handshake carrying only an ambient session cookie from a foreign origin', async () => {
    const err = await once(connectAsCrossSitePage(signAccess()), 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  // The Origin header is incidental — nothing in the handshake reads one, and React Native
  // sends none. What closes the hole is refusing the ambient credential itself, so a cookie
  // with NO Origin at all must fail too. If this passes while the test above fails, someone
  // has "fixed" it with an Origin allowlist, which RN traffic would then break.
  it('REJECTS an ambient session cookie even with no Origin header — the credential is the problem, not the origin', async () => {
    const socket = Client(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000,
      extraHeaders: { Cookie: `${COOKIE_NAME}=${signAccess()}` },
    });
    clients.push(socket);
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  it('still ACCEPTS an explicit handshake.auth.token — the shipping clients must keep working', async () => {
    const socket = Client(`http://127.0.0.1:${port}`, {
      auth: { token: signAccess() },
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000,
      extraHeaders: { Origin: 'https://evil.example' },
    });
    clients.push(socket);
    await once(socket, 'connect');
    expect(socket.connected).toBe(true);
  });

  it('an explicit token that is REVOKED is still refused, foreign origin or not', async () => {
    mockIsRevoked.mockResolvedValue(true);
    const socket = Client(`http://127.0.0.1:${port}`, {
      auth: { token: signAccess() },
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000,
    });
    clients.push(socket);
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });
});
