'use strict';

// M1 — Engine.IO's `connection_error` hands app/sockets/index.js a PLAIN object:
// { req, code, message, context }. Passed to Sentry as-is, the SDK serializes it into
// extra.__serialized__ (to depth 3) — the raw IncomingMessage: rawHeaders (cookie, Bearer) and
// the polling URL with its sid. Driven here for real: a real socket.io server built by
// createSocketServer, a real poll for an unknown sid (Engine.IO answers 400 and emits
// connection_error), the app's own captureException wrapper, and a real Sentry client whose
// transport captures the envelope that would ship.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.SENTRY_DSN     = 'https://public@o0.ingest.sentry.io/0'; // never contacted: transport captured

const mockSent = [];
jest.mock('@sentry/node', () => {
  const real = jest.requireActual('@sentry/node');
  const client = new real.NodeClient({
    dsn: 'https://public@o0.ingest.sentry.io/0',
    integrations: [],
    transport: () => ({ send: async (envelope) => { mockSent.push(envelope); return {}; }, flush: async () => true }),
    stackParser: real.defaultStackParser,
    sendDefaultPii: false,
  });
  client.init();
  return {
    init: jest.fn(),
    httpIntegration: jest.fn(() => ({ name: 'Http' })),
    setupExpressErrorHandler: jest.fn(),
    // What the SDK's top-level captureException does: apply the capture context to a scope and
    // hand the value, unchanged, to the client.
    captureException: (value, captureContext) => {
      const scope = new real.Scope();
      scope.setClient(client);
      if (captureContext?.extra) scope.setExtras(captureContext.extra);
      return client.captureException(value, {}, scope);
    },
    mockClient: client,
  };
});
jest.mock('../app/utils/tokenDenylist', () => ({ isRevoked: jest.fn().mockResolvedValue(false), revoke: jest.fn() }));
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/sockets/biometricHandler', () => ({ registerBiometricHandler: jest.fn() }));

const http = require('http');
const Sentry = require('@sentry/node');
const { initSentry } = require('../app/config/sentry');
const { createSocketServer } = require('../app/sockets/index');

function poll(port, path, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

describe('Engine.IO connection_error reaches Sentry without the raw request', () => {
  let server;
  let io;

  beforeAll(async () => {
    initSentry(null);
    server = http.createServer();
    io = createSocketServer(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    io.close();
    await new Promise((resolve) => server.close(resolve));
    await Sentry.mockClient.close(100);
  });

  it('an unknown-sid poll produces an event with no rawHeaders, no sid and no header values', async () => {
    const status = await poll(server.address().port, '/socket.io/?EIO=4&transport=polling&sid=CANARY-SID', {
      authorization: 'Bearer CANARY-JWT',
      cookie: 'io=CANARY-COOKIE',
    });
    await Sentry.mockClient.flush(2000);

    expect(status).toBe(400); // Engine.IO rejected the unknown session — the real error path ran
    const events = mockSent.flatMap(([, items]) => items).filter(([h]) => h.type === 'event').map(([, e]) => e);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.extra).toMatchObject({ scope: 'socket.engine', code: 1 });
    expect(event.exception.values[0].value).toBe('engine.io 1: Session ID unknown');

    const wire = JSON.stringify(mockSent);
    expect(wire).not.toMatch(/CANARY/);
    expect(wire).not.toContain('rawHeaders');
    expect(wire).not.toContain('sid=');
    expect(wire).not.toContain('__serialized__');
  });
});
