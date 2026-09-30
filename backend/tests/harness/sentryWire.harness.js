'use strict';

// TEST HARNESS — not production code; run only by tests/sentryWire.integration.test.js.
//
// Boots the REAL assembled app (app/index.js, which calls the app's own initSentry) in a fresh
// Node process — real module loading, real SDK instrumentation, nothing mocked but the transport.
// Sentry.init is wrapped ONLY to swap the transport for an in-memory one (nothing leaves the
// machine) and to PROBE the events the app's own beforeSend / beforeSendTransaction receive; every
// other option is the app's own. It drives real HTTP requests, flushes, and writes every envelope
// the SDK would have put on the wire to the file named by SENTRY_WIRE_OUT.
//
// Layer-1 probe: counts events that still carry `request.data` BEFORE the app's scrub hook runs.
// With the app's `maxIncomingRequestBodySize: 'none'` there must be none — proving the SDK never
// buffered a body, not merely that scrubEvent deleted it afterwards. SENTRY_WIRE_LAYER1_OFF=1
// (harness only) drops the app's Http override so the test can show the probe does see bodies.
//
// A separate process because the SDK subscribes to process-global diagnostics channels and
// installs OpenTelemetry hooks: inside a jest worker those would outlive this test and observe
// every later suite's HTTP traffic.

const fs = require('fs');
const http = require('http');
const path = require('path');

const Sentry = require('@sentry/node');

const envelopes = [];
const probe = { eventsSeen: 0, withBodyBeforeScrub: 0 };
// A body VALUE, not the key: RequestData always writes `request.data = normalizedRequest.data`
// (@sentry/core requestdata.js:138-139), so the key exists — holding undefined — on every event.
const probing = (hook) => (event, hint) => {
  probe.eventsSeen += 1;
  const data = event?.request?.data;
  if (data != null && data !== '') probe.withBodyBeforeScrub += 1;
  return hook ? hook(event, hint) : event;
};

const realInit = Sentry.init;
Sentry.init = (options) => realInit({
  ...options,
  ...(process.env.SENTRY_WIRE_LAYER1_OFF === '1' ? { integrations: [] } : {}),
  beforeSend: probing(options.beforeSend),
  beforeSendTransaction: probing(options.beforeSendTransaction),
  transport: () => ({
    send: async (envelope) => { envelopes.push(envelope); return {}; },
    flush: async () => true,
  }),
});

// No database in this process: fail DB calls at once instead of buffering them for 10 s, so the
// login request reaches the app's error handler as a genuine 5xx.
require('mongoose').set('bufferCommands', false);

const { app } = require(path.join(__dirname, '..', '..', 'app', 'index'));
const { createSocketServer } = require(path.join(__dirname, '..', '..', 'app', 'sockets'));

// JSON `body`, or a raw text `raw` body. Resolves { status, text }.
function send(port, { method, path: urlPath, headers = {}, body, raw }) {
  return new Promise((resolve, reject) => {
    let payload = null;
    let contentType = null;
    if (body != null) { payload = Buffer.from(JSON.stringify(body)); contentType = 'application/json'; }
    if (raw != null) { payload = Buffer.from(raw); contentType = 'text/plain;charset=UTF-8'; }
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: {
        ...headers,
        ...(payload ? { 'content-type': contentType, 'content-length': payload.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  // Exactly as app/index.js start() wires production: the Express app plus the socket.io server
  // on the same HTTP server (Engine.IO answers /socket.io/ ahead of Express).
  const server = http.createServer(app);
  createSocketServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const common = { 'x-forwarded-for': process.env.CANARY_IP, 'user-agent': 'sentry-wire-harness' };

  // A log line like the app's own (biometricHandler logs emotion taps and HR-derived targets,
  // integrationsController logs user ids). The Console integration would turn it into a breadcrumb
  // on the shared scope that every later request's scope copies.
  console.log('[harness] CANARY-BREADCRUMB user=CANARY-USER-ID taps=[{"x":0.4,"y":-0.2}]');

  const statuses = [];
  // A VALID Garmin push (the secret matches GARMIN_WEBHOOK_SECRET): 200, and a sampled transaction.
  statuses.push((await send(port, {
    method: 'POST',
    path: '/api/integrations/garmin/webhook?secret=CANARY-SECRET',
    headers: common,
    body: { dailies: [], note: 'CANARY-WEBHOOK-BODY' },
  })).status);
  // A login that fails server-side (no DB): the app's errorHandler reports a 5xx to Sentry.
  statuses.push((await send(port, {
    method: 'POST',
    path: '/api/auth/login',
    headers: { ...common, authorization: 'Bearer CANARY-JWT', cookie: 'sid=CANARY-COOKIE' },
    body: { email: 'canary@example.com', password: 'CANARY-PW' },
  })).status);
  // An engine.io poll for an unknown session: 400, a sampled transaction, and Engine.IO's
  // connection_error — which app/sockets/index.js reports to Sentry.
  statuses.push((await send(port, {
    method: 'GET',
    path: '/socket.io/?EIO=4&transport=polling&sid=CANARY-SID',
    headers: { ...common, authorization: 'Bearer CANARY-SOCKET-JWT', cookie: 'io=CANARY-IO-COOKIE' },
  })).status);
  // A real Engine.IO handshake, then the socket.io CONNECT packet exactly as the mobile client's
  // first polling POST carries it: `40{"token":"<app JWT>"}` (mobile socketFactory auth.token).
  const handshake = await send(port, { method: 'GET', path: '/socket.io/?EIO=4&transport=polling', headers: common });
  statuses.push(handshake.status);
  const { sid } = JSON.parse(handshake.text.slice(1)); // "0{...}" — Engine.IO OPEN packet
  statuses.push((await send(port, {
    method: 'POST',
    path: `/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`,
    headers: common,
    raw: '40{"token":"CANARY-CONNECT-JWT"}',
  })).status);

  await new Promise((resolve) => setTimeout(resolve, 300)); // server spans end after the response
  await Sentry.flush(5000);
  await new Promise((resolve) => server.close(resolve));
  fs.writeFileSync(process.env.SENTRY_WIRE_OUT, JSON.stringify({ statuses, sid, probe, envelopes }));
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
