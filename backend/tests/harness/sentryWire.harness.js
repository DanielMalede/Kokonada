'use strict';

// TEST HARNESS — not production code; run only by tests/sentryWire.integration.test.js.
//
// Boots the REAL assembled app (app/index.js, which calls the app's own initSentry) in a fresh
// Node process — real module loading, real SDK instrumentation, nothing mocked but the transport.
// Sentry.init is wrapped ONLY to swap the transport for an in-memory one (nothing leaves the
// machine); every other option is the app's own. It drives real HTTP requests, flushes, and writes
// every envelope the SDK would have put on the wire to the file named by SENTRY_WIRE_OUT.
//
// A separate process because the SDK subscribes to process-global diagnostics channels and
// installs OpenTelemetry hooks: inside a jest worker those would outlive this test and observe
// every later suite's HTTP traffic.

const fs = require('fs');
const http = require('http');
const path = require('path');

const Sentry = require('@sentry/node');

const envelopes = [];
const realInit = Sentry.init;
Sentry.init = (options) => realInit({
  ...options,
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

function send(port, { method, path: urlPath, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: {
        ...headers,
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
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

  const statuses = [];
  // A VALID Garmin push (the secret matches GARMIN_WEBHOOK_SECRET): 200, and a sampled transaction.
  statuses.push(await send(port, {
    method: 'POST',
    path: '/api/integrations/garmin/webhook?secret=CANARY-SECRET',
    headers: common,
    body: { dailies: [], note: 'CANARY-WEBHOOK-BODY' },
  }));
  // A login that fails server-side (no DB): the app's errorHandler reports a 5xx to Sentry.
  statuses.push(await send(port, {
    method: 'POST',
    path: '/api/auth/login',
    headers: { ...common, authorization: 'Bearer CANARY-JWT', cookie: 'sid=CANARY-COOKIE' },
    body: { email: 'canary@example.com', password: 'CANARY-PW' },
  }));
  // An engine.io poll for an unknown session: 400, a sampled transaction, and Engine.IO's
  // connection_error — which app/sockets/index.js reports to Sentry.
  statuses.push(await send(port, {
    method: 'GET',
    path: '/socket.io/?EIO=4&transport=polling&sid=CANARY-SID',
    headers: { ...common, authorization: 'Bearer CANARY-SOCKET-JWT', cookie: 'io=CANARY-IO-COOKIE' },
  }));

  await new Promise((resolve) => setTimeout(resolve, 300)); // server spans end after the response
  await Sentry.flush(5000);
  await new Promise((resolve) => server.close(resolve));
  fs.writeFileSync(process.env.SENTRY_WIRE_OUT, JSON.stringify({ statuses, envelopes }));
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
