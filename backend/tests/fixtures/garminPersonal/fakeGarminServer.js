'use strict';

// A stateful stand-in for Garmin's Connect Personal API, for the client's tests.
//
// It is a real HTTP server on 127.0.0.1, and the client reaches it through an https.Agent whose
// sockets connect here. The client therefore runs its production path unchanged (axios's native
// https transport, real headers, a real streamed body, real timeouts) against
// https://personal.connectapi.garmin.com, and no byte leaves the machine. It behaves like the
// service, not like a stub:
//   · the token endpoint issues a JWT only to `Authorization: ApiKey <the key it was started with>`,
//     with an `exp` 24 h after the injected clock's now, and remembers every token it issued;
//   · a data endpoint answers only `Authorization: Bearer <a token it issued and has not revoked>`;
//   · scripted steps (a status with headers, a hang, a body of a given size, an echo) are served in
//     order, per path, before that default behaviour;
//   · every error body echoes the request's Authorization header and URL, as a careless server
//     might, so a client that ever surfaced a response body would hand the secret to the caller.
// Synthetic only: the key and the tokens are sentinels made at run time.

const http = require('http');
const https = require('https');
const net = require('net');
const { makeJwt } = require('./sentinels');

const HOST = 'personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

async function startFakeGarmin({ apiKey, now = Date.now, fixtures = {} } = {}) {
  const state = {
    requests: [], // { method, path, pathname, host, authorization, at }
    connections: [], // { host, port, servername } as the agent was asked to connect
    issuedTokens: [],
    revoked: new Set(),
  };
  const scripts = new Map(); // pathname -> [step, ...]
  const sockets = new Set();

  const echoOf = (req) => `${req.headers.authorization || ''} ${req.url}`;

  function serve(req, res, step) {
    if (step.hang) return; // never answer: only the client's own timeout ends this request
    const status = step.status || 200;
    const headers = { 'Content-Type': 'application/json', ...(step.headers || {}) };
    if (step.headersOnly) {
      // The status line and headers, then silence: a body that never comes.
      res.writeHead(status, headers);
      res.flushHeaders();
      return;
    }
    if (step.reset) {
      // The connection drops before any response: a network failure, not an HTTP status.
      req.socket.destroy();
      return;
    }
    if (step.trickleMs) {
      // A body that keeps coming, one byte at a time, and never ends.
      res.writeHead(status, headers);
      const timer = setInterval(() => res.write(' '), step.trickleMs);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (step.bytes) {
      // A valid JSON array of exactly `bytes` bytes, streamed in chunks ('[', spaces, ']').
      if (step.declareLength) headers['Content-Length'] = String(step.bytes);
      res.writeHead(status, headers);
      const parts = [Buffer.from('['), step.bytes - 2, Buffer.from(']')];
      const space = Buffer.alloc(64 * 1024, 0x20);
      let pending = parts[1];
      res.write(parts[0]);
      const pump = () => {
        while (pending > 0) {
          const n = Math.min(pending, space.length);
          pending -= n;
          if (!res.write(n === space.length ? space : space.subarray(0, n))) return res.once('drain', pump);
        }
        res.end(parts[2]);
      };
      res.on('close', () => { pending = 0; });
      return pump();
    }
    if (step.issue) state.issuedTokens.push(step.body);
    let body;
    if (step.echo) body = echoOf(req);
    else if (step.body !== undefined) body = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
    else body = status >= 400 ? JSON.stringify({ error: 'refused', authorization: req.headers.authorization || null, url: req.url }) : '';
    res.writeHead(status, headers);
    res.end(body);
  }

  const server = http.createServer((req, res) => {
    res.on('error', () => {});
    const url = new URL(req.url, `https://${HOST}`);
    state.requests.push({
      method: req.method,
      path: req.url,
      pathname: url.pathname,
      host: req.headers.host,
      authorization: req.headers.authorization,
      accept: req.headers.accept,
      contentLength: req.headers['content-length'],
      at: now(),
    });
    req.resume();
    const queue = scripts.get(url.pathname);
    if (queue && queue.length) return serve(req, res, queue.shift());
    if (url.pathname === TOKEN_PATH) {
      if (req.method !== 'POST' || req.headers.authorization !== `ApiKey ${apiKey}`) return serve(req, res, { status: 401 });
      const jwt = makeJwt({
        exp: Math.floor(now() / 1000) + TOKEN_TTL_SECONDS,
        marker: `SENTINEL-SIGNATURE-${state.issuedTokens.length + 1}`,
      });
      state.issuedTokens.push(jwt);
      return serve(req, res, { status: 200, headers: { 'Content-Type': 'text/plain' }, body: jwt });
    }
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    if (req.method !== 'GET' || !token || !state.issuedTokens.includes(token) || state.revoked.has(token)) {
      return serve(req, res, { status: 401 });
    }
    const body = Object.hasOwn(fixtures, url.pathname) ? fixtures[url.pathname] : { ok: true, path: url.pathname };
    return serve(req, res, { status: 200, body });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = (options) => {
    state.connections.push({ host: options.host, port: Number(options.port), servername: options.servername });
    return net.connect(port, '127.0.0.1');
  };

  return {
    agent,
    state,
    port,
    /** Queue steps for a pathname; each request to it takes the next step. */
    script(pathname, ...steps) {
      scripts.set(pathname, [...(scripts.get(pathname) || []), ...steps]);
    },
    /** The next exchange returns `jwt`, and the data endpoints accept it as a token this server issued. */
    scriptToken(jwt) {
      scripts.set(TOKEN_PATH, [...(scripts.get(TOKEN_PATH) || []), { status: 200, headers: { 'Content-Type': 'text/plain' }, body: jwt, issue: true }]);
    },
    /** Every token issued so far stops working, as a revoked or expired token does. */
    revokeAll() {
      for (const token of state.issuedTokens) state.revoked.add(token);
    },
    tokenRequests: () => state.requests.filter((r) => r.pathname === TOKEN_PATH),
    dataRequests: () => state.requests.filter((r) => r.pathname !== TOKEN_PATH),
    async close() {
      for (const socket of sockets) socket.destroy();
      agent.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { startFakeGarmin, HOST, TOKEN_PATH, TOKEN_TTL_SECONDS };
