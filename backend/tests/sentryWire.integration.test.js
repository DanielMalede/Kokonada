'use strict';

// Closing evidence for the Sentry credential scrub: what the REAL app, with its own initSentry and
// tracesSampleRate 1 (NODE_ENV=test), would put on the wire. The harness boots app/index.js in a
// separate Node process and swaps only the transport for an in-memory capture. Three real requests:
//   • a VALID Garmin push, `?secret=` in the URL and a body          → 200 + transaction
//   • a login POST with a password body, Bearer and cookie, 5xx       → error event + transaction
//   • an engine.io poll for an unknown `sid=`, Bearer and cookie      → 400: connection_error + transaction
// Nothing in any envelope may carry a CANARY value, the client IP or `sid=`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const HARNESS = path.join(__dirname, 'harness', 'sentryWire.harness.js');
const CLIENT_IP = '203.0.113.77'; // TEST-NET-3, sent as X-Forwarded-For

function runHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-wire-'));
  const out = path.join(dir, 'wire.json');
  try {
    execFileSync(process.execPath, [HARNESS], {
      cwd: BACKEND,
      stdio: 'pipe',
      timeout: 90_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ENCRYPTION_KEY: 'a'.repeat(64),
        JWT_SECRET: 'test-jwt-secret-for-tests-only',
        SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0', // never contacted: the transport is swapped
        GARMIN_WEBHOOK_SECRET: 'CANARY-SECRET',
        CANARY_IP: CLIENT_IP,
        SENTRY_WIRE_OUT: out,
      },
    });
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Sentry wire — the real app sends no credential, body, client IP or session id', () => {
  let wire;
  beforeAll(() => { wire = runHarness(); }, 120_000);

  const items = () => wire.envelopes.flatMap(([, envelopeItems]) => envelopeItems);
  const ofType = (type) => items().filter(([header]) => header.type === type).map(([, payload]) => payload);

  it('(precondition) the requests really ran and the SDK really captured them', () => {
    expect(wire.statuses).toEqual([200, 500, 400]);

    const transactions = ofType('transaction');
    expect(transactions.map((t) => t.transaction)).toEqual(expect.arrayContaining([
      'POST /api/integrations/garmin/webhook',
      'POST /api/auth/login',
      'GET /socket.io/',
    ]));
    const loginError = ofType('event').find((e) => e.request?.url?.includes('/api/auth/login'));
    expect(loginError).toBeDefined();
    expect(loginError.request.method).toBe('POST');
    // Engine.IO's connection_error for the unknown sid reached Sentry as an event too.
    expect(ofType('event').some((e) => JSON.stringify(e.extra ?? {}).includes('socket.engine'))).toBe(true);
  });

  it('no envelope carries a CANARY value, the client IP or sid=', () => {
    const text = JSON.stringify(wire.envelopes);
    expect(text).not.toMatch(/CANARY/);
    expect(text).not.toContain(CLIENT_IP);
    expect(text).not.toContain('sid=');
  });

  it('no span carries a query or a client address attribute', () => {
    const spanData = ofType('transaction').flatMap((t) => [t.contexts?.trace?.data ?? {}, ...(t.spans ?? []).map((s) => s.data ?? {})]);
    for (const data of spanData) {
      for (const key of ['http.query', 'url.query', 'http.client_ip', 'net.peer.ip']) {
        expect(data).not.toHaveProperty([key]);
      }
      for (const key of ['http.url', 'http.target', 'url.full']) {
        if (typeof data[key] === 'string') expect(data[key]).not.toContain('?');
      }
    }
  });
});
