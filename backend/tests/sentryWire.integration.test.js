'use strict';

// Closing evidence for the Sentry credential scrub: what the REAL app, with its own initSentry and
// tracesSampleRate 1 (NODE_ENV=test), would put on the wire. The harness boots app/index.js in a
// separate Node process and swaps only the transport for an in-memory capture. Real requests:
//   • a VALID Garmin push, `?secret=` in the URL and a body          → 200 + transaction
//   • a login POST with a password body, Bearer and cookie, 5xx       → error event + transaction
//   • an engine.io poll for an unknown `sid=`, Bearer and cookie      → 400: connection_error + transaction
//   • a real Engine.IO handshake, then the socket.io CONNECT POST
//     `40{"token":"<JWT>"}` with the real sid in the query           → 200 + 200, two transactions
// plus an app-style console line before them. Nothing in any envelope may carry a CANARY value, the
// client IP, `sid=` or the real session id, and no console line may ride along as a breadcrumb.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const HARNESS = path.join(__dirname, 'harness', 'sentryWire.harness.js');
const CLIENT_IP = '203.0.113.77'; // TEST-NET-3, sent as X-Forwarded-For

function runHarness(extraEnv = {}) {
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
        ...extraEnv,
      },
    });
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const itemsOf = (wire) => wire.envelopes.flatMap(([, envelopeItems]) => envelopeItems);
const ofType = (wire, type) => itemsOf(wire).filter(([header]) => header.type === type).map(([, payload]) => payload);

describe('Sentry wire — the real app sends no credential, body, client IP or session id', () => {
  let wire;
  beforeAll(() => { wire = runHarness(); }, 120_000);

  it('(precondition) the requests really ran and the SDK really captured them', () => {
    expect(wire.statuses).toEqual([200, 500, 400, 200, 200]);
    expect(typeof wire.sid).toBe('string');

    expect(ofType(wire, 'transaction').map((t) => t.transaction)).toEqual(expect.arrayContaining([
      'POST /api/integrations/garmin/webhook',
      'POST /api/auth/login',
      'GET /socket.io/',
      'POST /socket.io/',
    ]));
    const loginError = ofType(wire, 'event').find((e) => e.request?.url?.includes('/api/auth/login'));
    expect(loginError).toBeDefined();
    expect(loginError.request.method).toBe('POST');
    // Engine.IO's connection_error for the unknown sid reached Sentry as an event too.
    expect(ofType(wire, 'event').some((e) => JSON.stringify(e.extra ?? {}).includes('socket.engine'))).toBe(true);
  });

  it('no envelope carries a CANARY value, the client IP, sid= or the real session id', () => {
    const text = JSON.stringify(wire.envelopes);
    expect(text).not.toMatch(/CANARY/);
    expect(text).not.toContain(CLIENT_IP);
    expect(text).not.toContain('sid=');
    expect(text).not.toContain(wire.sid);
  });

  it('the socket.io CONNECT POST (JWT in the body, sid in the query) is a clean transaction', () => {
    const connect = ofType(wire, 'transaction').find((t) => t.transaction === 'POST /socket.io/');
    expect(connect).toBeDefined();
    const text = JSON.stringify(connect);
    expect(text).not.toMatch(/CANARY|sid=/);
    expect(text).not.toContain(wire.sid);
    expect(connect.request).not.toHaveProperty('data');
  });

  it('no console line rides along as a breadcrumb', () => {
    const crumbs = itemsOf(wire).flatMap(([, payload]) => payload.breadcrumbs ?? []);
    expect(crumbs.filter((b) => b.category === 'console')).toEqual([]);
  });

  it('no span carries a query or a client address attribute', () => {
    const spanData = ofType(wire, 'transaction').flatMap((t) => [t.contexts?.trace?.data ?? {}, ...(t.spans ?? []).map((s) => s.data ?? {})]);
    for (const data of spanData) {
      for (const key of ['http.query', 'url.query', 'http.client_ip', 'net.peer.ip']) {
        expect(data).not.toHaveProperty([key]);
      }
      for (const key of ['http.url', 'http.target', 'url.full']) {
        if (typeof data[key] === 'string') expect(data[key]).not.toContain('?');
      }
    }
  });

  // Layer 1 on its own: the SDK never buffered a body (maxIncomingRequestBodySize: 'none'), so no
  // event reached the app's scrub hook carrying request.data — scrubEvent's delete is the backstop.
  it('layer 1: no event carries request.data even BEFORE scrubEvent runs', () => {
    expect(wire.probe.eventsSeen).toBeGreaterThan(0);
    expect(wire.probe.withBodyBeforeScrub).toBe(0);
  });
});

// The probe has teeth: with the app's Http override removed (harness-only switch), the SDK buffers
// bodies again and the probe sees them — while layer 2 alone still keeps them off the wire.
describe('Sentry wire control — layer 1 removed', () => {
  let wire;
  beforeAll(() => { wire = runHarness({ SENTRY_WIRE_LAYER1_OFF: '1' }); }, 120_000);

  it('the probe sees bodies before the scrub, and scrubEvent still keeps every one off the wire', () => {
    expect(wire.probe.withBodyBeforeScrub).toBeGreaterThan(0);
    expect(JSON.stringify(wire.envelopes)).not.toMatch(/CANARY/);
  });
});
