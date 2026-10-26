'use strict';

// The Garmin Connect Personal API client (T3): the owner-only Phase 1 lane's only way to Garmin.
//
// Every test runs the client's production code path against a stateful fake of Garmin's service: a
// real HTTP server, reached through an https.Agent whose sockets connect to it, so axios's native
// https transport, real headers, real streamed bodies and real timeouts are all in play for
// https://personal.connectapi.garmin.com. The rate policy runs on a fake clock that sleeping moves,
// so a six-hour backoff costs nothing. No byte leaves the machine: the global agents are blocked for
// the whole file, so a request that bypassed the fake would fail loudly instead of reaching Garmin.

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const util = require('util');
const fc = require('fast-check');

const {
  createGarminPersonalClient,
  getGarminPersonalClient,
  keyExpiryStatus,
  assertAllowedRequest,
  backoffDelay,
  GarminPersonalError,
  GARMIN_PERSONAL_ENDPOINT_IDS,
  GARMIN_PERSONAL_ERROR_CODES,
  RETRY_POLICY,
  BASE_URL,
  TOKEN_PATH,
  TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
} = require('../app/services/wearable/garminPersonal/client');
const { startFakeGarmin, HOST } = require('./fixtures/garminPersonal/fakeGarminServer');
const { fakeClock } = require('./fixtures/garminPersonal/clock');
const { SENTINEL_KEY, makeJwt, signatureOf, base64url } = require('./fixtures/garminPersonal/sentinels');

const START = '2026-10-26T06:00:00.000Z';
const HOUR = 60 * 60 * 1000;
const hrvPath = (date) => `/hrv-service/hrv/${date}`;

const blocked = [];
beforeAll(() => {
  for (const agent of [http.globalAgent, https.globalAgent]) {
    blocked.push([agent, agent.createConnection]);
    agent.createConnection = () => { throw new Error('a real network connection was attempted in a test'); };
  }
});
afterAll(() => {
  for (const [agent, original] of blocked) agent.createConnection = original;
});

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((garmin) => garmin.close()));
});

async function setup({ fixtures, timeoutMs = 5000, getApiKey } = {}) {
  const clock = fakeClock(START);
  const garmin = await startFakeGarmin({ apiKey: SENTINEL_KEY, now: clock.now, fixtures });
  servers.push(garmin);
  const keyReads = { count: 0 };
  const client = createGarminPersonalClient({
    getApiKey: getApiKey || (() => { keyReads.count += 1; return SENTINEL_KEY; }),
    httpsAgent: garmin.agent,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    timeoutMs,
  });
  return { client, garmin, clock, keyReads };
}

const gaps = (requests) => requests.slice(1).map((r, i) => r.at - requests[i].at);

describe('the fake Garmin behaves like the service (self-test)', () => {
  it('issues a token only for the right ApiKey and echoes the Authorization header in an error body', async () => {
    const { garmin } = await setup();
    const call = (headers, method = 'POST') => new Promise((resolve, reject) => {
      // agent: false — a fresh agent for this one call; the global ones are blocked for the file.
      const req = http.request({ host: '127.0.0.1', port: garmin.port, path: TOKEN_PATH, method, headers, agent: false }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end();
    });

    const refused = await call({ Authorization: 'ApiKey not-the-key' });
    const issued = await call({ Authorization: `ApiKey ${SENTINEL_KEY}` });

    expect(refused.status).toBe(401);
    expect(refused.body).toContain('ApiKey not-the-key'); // a careless server: the secret is in the body
    expect(issued.status).toBe(200);
    expect(issued.body).toBe(garmin.state.issuedTokens[0]);
  });
});

describe('the key-for-token exchange', () => {
  // The headers Garmin's own client sends: auth.py posts `Accept: */*` and the ApiKey with no body
  // (requests adds `Content-Length: 0`), client.py gets with `Accept: application/json` and the Bearer.
  it('posts the key as `Authorization: ApiKey <key>` to the token path, then sends `Bearer <jwt>`', async () => {
    const { client, garmin } = await setup();

    await expect(client.get('hrv', { date: '2026-10-25' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-25') });

    const [token] = garmin.tokenRequests();
    expect(token).toMatchObject({
      method: 'POST', path: TOKEN_PATH, host: HOST, authorization: `ApiKey ${SENTINEL_KEY}`, accept: '*/*', contentLength: '0',
    });
    const [data] = garmin.dataRequests();
    expect(data).toMatchObject({
      method: 'GET', path: hrvPath('2026-10-25'), host: HOST, authorization: `Bearer ${garmin.state.issuedTokens[0]}`, accept: 'application/json',
    });
  });

  it('exchanges once and reuses the token for every request until one hour before it expires', async () => {
    const { client, garmin, clock } = await setup();

    await client.get('hrv', { date: '2026-10-25' });
    const exchangedAt = garmin.tokenRequests()[0].at;
    clock.set(exchangedAt + 1 * HOUR);
    await client.get('hrv', { date: '2026-10-24' });
    clock.set(exchangedAt + 23 * HOUR - 60 * 1000);
    await client.get('hrv', { date: '2026-10-23' });
    expect(garmin.tokenRequests()).toHaveLength(1);

    clock.set(exchangedAt + 23 * HOUR + 1000);
    await client.get('hrv', { date: '2026-10-22' });

    expect(garmin.tokenRequests()).toHaveLength(2);
    const [first, second] = garmin.state.issuedTokens;
    expect(garmin.dataRequests().map((r) => r.authorization)).toEqual([
      `Bearer ${first}`, `Bearer ${first}`, `Bearer ${first}`, `Bearer ${second}`,
    ]);
  });

  it('never trusts a token for more than 24 h, whatever its exp claims', async () => {
    const { client, garmin, clock } = await setup();
    garmin.scriptToken(makeJwt({ exp: Math.floor(clock.now() / 1000) + 72 * 3600, marker: 'LONG-LIVED' }));

    await client.get('hrv', { date: '2026-10-25' });
    const exchangedAt = garmin.tokenRequests()[0].at;
    clock.set(exchangedAt + 23 * HOUR + 1000);
    await client.get('hrv', { date: '2026-10-24' });

    expect(garmin.tokenRequests()).toHaveLength(2);
  });

  it('shares one exchange between two requests that start together', async () => {
    const { client, garmin } = await setup();

    await Promise.all([client.get('hrv', { date: '2026-10-25' }), client.get('hrv', { date: '2026-10-24' })]);

    expect(garmin.tokenRequests()).toHaveLength(1);
    expect(garmin.dataRequests()).toHaveLength(2);
  });

  it('reads the key only when it exchanges, never when the client is made', async () => {
    const { client, keyReads } = await setup();
    expect(keyReads.count).toBe(0);

    await client.get('hrv', { date: '2026-10-25' });
    await client.get('hrv', { date: '2026-10-24' });

    expect(keyReads.count).toBe(1);
  });

  it.each([
    ['not a JWT at all', () => 'not-a-jwt'],
    ['a JWT whose payload is not JSON', () => [base64url({ alg: 'HS256' }), base64url('not json'), base64url('sig')].join('.')],
    ['a JWT with no exp claim', () => [base64url({ alg: 'HS256' }), base64url({ sub: 'x' }), base64url('sig')].join('.')],
    ['a JWT that has already expired', (nowMs) => makeJwt({ exp: Math.floor(nowMs / 1000) - 10 })],
    ['a JWT with no signature', () => [base64url({ alg: 'none' }), base64url({ exp: 9999999999 }), ''].join('.')],
  ])('refuses a token response that is %s, and never sends it', async (_label, body) => {
    const { client, garmin, clock } = await setup();
    garmin.script(TOKEN_PATH, { status: 200, headers: { 'Content-Type': 'text/plain' }, body: body(clock.now()) });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_token_invalid' });
    expect(garmin.dataRequests()).toHaveLength(0);
  });

  it('with no key configured refuses with garmin_personal_key_missing and sends nothing', async () => {
    const { client, garmin } = await setup({ getApiKey: () => undefined });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_key_missing' });
    expect(garmin.state.requests).toHaveLength(0);
  });

  it('refuses a key with whitespace or control characters (garmin_personal_key_invalid) and sends nothing', async () => {
    const { client, garmin } = await setup({ getApiKey: () => `${SENTINEL_KEY}\r\nX-Injected: 1` });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_key_invalid' });
    expect(garmin.state.requests).toHaveLength(0);
  });
});

describe('the JWT stays inside the client', () => {
  it('is never returned, never on the client object and never in status()', async () => {
    const { client, garmin } = await setup();

    const result = await client.get('hrv', { date: '2026-10-25' });

    const jwt = garmin.state.issuedTokens[0];
    expect(Object.keys(client).sort()).toEqual(['get', 'status']);
    const seen = [
      util.inspect(client, { showHidden: true, depth: Infinity }),
      JSON.stringify(result),
      JSON.stringify(client.status()),
    ].join('\n');
    expect(seen).not.toContain(jwt);
    expect(seen).not.toContain(signatureOf(jwt));
  });

  it('is never persisted: the client requires nothing that could write it anywhere', () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/services/wearable/garminPersonal/client.js'), 'utf8');
    const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]).sort();

    expect(required).toEqual(['./ratePolicy', 'axios', 'https']);
    expect(source).not.toMatch(/process\.env\.[A-Z_]+\s*=[^=]/);
  });
});

describe('only https://personal.connectapi.garmin.com, with a timeout and a size cap', () => {
  it('connects only to the Garmin host on port 443 over TLS (SNI) and sends that Host header', async () => {
    const { client, garmin } = await setup();

    await client.get('hrv', { date: '2026-10-25' });

    expect(garmin.state.connections.length).toBeGreaterThanOrEqual(2);
    for (const connection of garmin.state.connections) expect(connection).toEqual({ host: HOST, port: 443, servername: HOST });
    for (const request of garmin.state.requests) expect(request.host).toBe(HOST);
    expect(BASE_URL).toBe('https://personal.connectapi.garmin.com');
    expect(TOKEN_PATH).toBe('/personalapitoken-service/personal-api/personal-api-key/token');
  });

  it('ignores HTTPS_PROXY and HTTP_PROXY: the credential goes straight to Garmin, never through a proxy', async () => {
    const net = require('net');
    const proxyConnections = [];
    const proxy = net.createServer((socket) => { proxyConnections.push(socket.remotePort); socket.destroy(); });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    const names = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    for (const n of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) process.env[n] = proxyUrl;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    try {
      const { client, garmin } = await setup();

      await expect(client.get('hrv', { date: '2026-10-25' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-25') });
      expect(proxyConnections).toEqual([]);
      for (const connection of garmin.state.connections) expect(connection).toEqual({ host: HOST, port: 443, servername: HOST });
    } finally {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
      await new Promise((resolve) => proxy.close(resolve));
    }
  });

  it('a request interceptor another module adds to the shared axios never sees this traffic', async () => {
    const axios = require('axios');
    const seen = [];
    const id = axios.interceptors.request.use((config) => { seen.push(String(config.url)); return config; });
    try {
      const { client } = await setup();

      await client.get('hrv', { date: '2026-10-25' });

      expect(seen).toEqual([]);
    } finally {
      axios.interceptors.request.eject(id);
    }
  });

  it('follows no redirect: a 302 is garmin_personal_unexpected_status and nothing connects to its Location', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 302, headers: { Location: 'https://evil.example/steal' } });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_unexpected_status', status: 302 });
    expect(garmin.state.connections.every((c) => c.host === HOST)).toBe(true);
    expect(garmin.dataRequests()).toHaveLength(1);
  });

  it('ends a request that never answers, retries it as transient up to 5 attempts, then garmin_personal_timeout', async () => {
    const { client, garmin, clock } = await setup({ timeoutMs: 200 });
    garmin.script(hrvPath('2026-10-25'), ...Array.from({ length: 5 }, () => ({ hang: true })));

    const err = await client.get('hrv', { date: '2026-10-25' }).catch((e) => e);

    expect(err).toMatchObject({ code: 'garmin_personal_timeout' });
    expect(err).not.toHaveProperty('status');
    expect(garmin.dataRequests()).toHaveLength(5);
    expect(gaps(garmin.dataRequests())).toEqual([45000, 90000, 180000, 360000]);
    expect(clock.sleeps.length).toBeGreaterThan(0);
  });

  it('the deadline covers the whole exchange: a body that trickles forever is a timeout too', async () => {
    const { client, garmin } = await setup({ timeoutMs: 300 });
    garmin.script(hrvPath('2026-10-25'), ...Array.from({ length: 5 }, () => ({ status: 200, trickleMs: 50 })));

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_timeout' });
    expect(garmin.dataRequests()).toHaveLength(5);
  });

  it('a dropped connection is a network failure: retried up to 5 attempts, then garmin_personal_network', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), ...Array.from({ length: 5 }, () => ({ reset: true })));

    const err = await client.get('hrv', { date: '2026-10-25' }).catch((e) => e);

    expect(err).toMatchObject({ code: 'garmin_personal_network' });
    expect(err).not.toHaveProperty('status');
    expect(garmin.dataRequests()).toHaveLength(5);
    expect(gaps(garmin.dataRequests())).toEqual([45000, 90000, 180000, 360000]);
  });

  it('a dropped connection followed by an answer returns the data', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { reset: true });

    await expect(client.get('hrv', { date: '2026-10-25' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-25') });
  });

  it('defaults to a 30 s timeout and a 5 MB response cap', () => {
    expect(TIMEOUT_MS).toBe(30000);
    expect(MAX_RESPONSE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('accepts a body of exactly 5 MB', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 200, bytes: MAX_RESPONSE_BYTES });

    await expect(client.get('hrv', { date: '2026-10-25' })).resolves.toEqual([]);
  });

  it.each([
    ['streamed with no length', false],
    ['declared in Content-Length', true],
  ])('refuses a body one byte over 5 MB (%s): garmin_personal_response_too_large, no retry', async (_label, declareLength) => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 200, bytes: MAX_RESPONSE_BYTES + 1, declareLength });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_response_too_large', status: 200 });
    expect(garmin.dataRequests()).toHaveLength(1);
  });

  it('refuses a body whose Content-Length is over the cap at once, without waiting for a byte of it', async () => {
    const { client, garmin } = await setup({ timeoutMs: 1500 });
    garmin.script(hrvPath('2026-10-25'), { status: 200, headersOnly: true, headers: { 'Content-Length': String(MAX_RESPONSE_BYTES + 1) } });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_response_too_large', status: 200 });
    expect(garmin.dataRequests()).toHaveLength(1);
  });

  it('a body that is not JSON is garmin_personal_malformed_response, never retried', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 200, body: '{"lastNightAvg": 5' });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_malformed_response', status: 200 });
    expect(garmin.dataRequests()).toHaveLength(1);
  });

  it.each([
    ['204 No Content', { status: 204 }],
    ['an empty 200', { status: 200, body: '' }],
  ])('%s is no data (null)', async (_label, step) => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), step);

    await expect(client.get('hrv', { date: '2026-10-25' })).resolves.toBeNull();
  });
});

describe('401: one re-exchange, then stop', () => {
  it('re-exchanges once when a token stops working, and the request succeeds with the new token', async () => {
    const { client, garmin } = await setup();
    await client.get('hrv', { date: '2026-10-25' });
    garmin.revokeAll();

    await expect(client.get('hrv', { date: '2026-10-24' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-24') });

    expect(garmin.tokenRequests()).toHaveLength(2);
    expect(garmin.dataRequests().map((r) => r.authorization)).toEqual([
      `Bearer ${garmin.state.issuedTokens[0]}`,
      `Bearer ${garmin.state.issuedTokens[0]}`,
      `Bearer ${garmin.state.issuedTokens[1]}`,
    ]);
  });

  it('a second 401 after the re-exchange stops the lane: garmin_personal_unauthorized, and later calls send nothing', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 401 }, { status: 401 });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_unauthorized', status: 401 });
    expect(garmin.tokenRequests()).toHaveLength(2);
    expect(garmin.dataRequests()).toHaveLength(2);

    await expect(client.get('hrv', { date: '2026-10-24' })).rejects.toMatchObject({ code: 'garmin_personal_unauthorized', status: 401 });
    expect(garmin.state.requests).toHaveLength(4);
    expect(client.status().stopped).toBe('garmin_personal_unauthorized');
  });

  it('a key the token endpoint refuses stops at once, with no second exchange', async () => {
    const { client, garmin } = await setup({ getApiKey: () => `${SENTINEL_KEY}-REVOKED` });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_unauthorized', status: 401 });
    expect(garmin.tokenRequests()).toHaveLength(1);
    expect(garmin.dataRequests()).toHaveLength(0);
  });
});

describe('403: stop, no retry (Garmin suspended the key)', () => {
  it('a 403 on data is garmin_personal_forbidden, never retried, and later calls send nothing', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 403 });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_forbidden', status: 403 });
    expect(garmin.dataRequests()).toHaveLength(1);

    await expect(client.get('hrv', { date: '2026-10-24' })).rejects.toMatchObject({ code: 'garmin_personal_forbidden' });
    expect(garmin.state.requests).toHaveLength(2);
    expect(client.status().stopped).toBe('garmin_personal_forbidden');
  });

  it('a 403 from the token endpoint stops the same way', async () => {
    const { client, garmin } = await setup();
    garmin.script(TOKEN_PATH, { status: 403 });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_forbidden', status: 403 });
    expect(garmin.tokenRequests()).toHaveLength(1);
    expect(garmin.dataRequests()).toHaveLength(0);
  });
});

describe('429: Retry-After, else jittered backoff 60 s..6 h; three in a row pause the lane for 24 h', () => {
  it('honours a Retry-After in seconds', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 429, headers: { 'Retry-After': '120' } });

    await expect(client.get('hrv', { date: '2026-10-25' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-25') });
    expect(gaps(garmin.dataRequests())).toEqual([120000]);
  });

  it('honours a Retry-After that is an HTTP date', async () => {
    const { client, garmin } = await setup();
    const retryAt = Date.parse(START) + 10 * 60 * 1000;
    garmin.script(hrvPath('2026-10-25'), { status: 429, headers: { 'Retry-After': new Date(retryAt).toUTCString() } });

    await client.get('hrv', { date: '2026-10-25' });

    expect(garmin.dataRequests()[1].at).toBe(retryAt);
  });

  it('never waits less than 60 s, even when Retry-After asks for less', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 429, headers: { 'Retry-After': '2' } });

    await client.get('hrv', { date: '2026-10-25' });

    expect(gaps(garmin.dataRequests())).toEqual([60000]);
  });

  it('without Retry-After backs off exponentially with jitter (random 0.5: 90 s, then 180 s)', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 429 }, { status: 429 });

    await expect(client.get('hrv', { date: '2026-10-25' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-25') });
    expect(gaps(garmin.dataRequests())).toEqual([90000, 180000]);
  });

  it('three 429s in a row: garmin_personal_paused, and every call for 24 h is refused without a request', async () => {
    const { client, garmin, clock } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 429 }, { status: 429 }, { status: 429 });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_paused', status: 429 });
    expect(garmin.dataRequests()).toHaveLength(3);
    expect(client.status().paused).toBe(true);
    const pausedAt = clock.now();

    clock.set(pausedAt + 24 * HOUR - 1000);
    await expect(client.get('hrv', { date: '2026-10-24' })).rejects.toMatchObject({ code: 'garmin_personal_paused' });
    expect(garmin.dataRequests()).toHaveLength(3);

    clock.set(pausedAt + 24 * HOUR);
    await expect(client.get('hrv', { date: '2026-10-24' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-24') });
    expect(client.status().paused).toBe(false);
  });

  it('a Retry-After longer than 6 h pauses at once', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 429, headers: { 'Retry-After': String(7 * 3600) } });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_paused', status: 429 });
    expect(garmin.dataRequests()).toHaveLength(1);
  });

  it('a response that is not a 429 ends the run of 429s', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 429 }, { status: 429 });
    garmin.script(hrvPath('2026-10-24'), { status: 429 });

    await client.get('hrv', { date: '2026-10-25' });
    await expect(client.get('hrv', { date: '2026-10-24' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-24') });
    expect(client.status().paused).toBe(false);
  });

  it('counts 429s from the token endpoint in the same run', async () => {
    const { client, garmin } = await setup();
    garmin.script(TOKEN_PATH, { status: 429 }, { status: 429 }, { status: 429 });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_paused' });
    expect(garmin.tokenRequests()).toHaveLength(3);
  });
});

describe('5xx: jittered backoff 30 s..1 h, at most 5 attempts', () => {
  it('five 5xx in a row: garmin_personal_unavailable with the last status (random 0.5: 45, 90, 180, 360 s)', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 500 }, { status: 502 }, { status: 503 }, { status: 500 }, { status: 504 });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_unavailable', status: 504 });
    expect(garmin.dataRequests()).toHaveLength(5);
    expect(gaps(garmin.dataRequests())).toEqual([45000, 90000, 180000, 360000]);
  });

  it('a 5xx followed by a success returns the data', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 503 });

    await expect(client.get('hrv', { date: '2026-10-25' })).resolves.toEqual({ ok: true, path: hrvPath('2026-10-25') });
    expect(gaps(garmin.dataRequests())).toEqual([45000]);
  });

  it.each([400, 404, 409])('any other status (%i) is garmin_personal_unexpected_status, never retried', async (status) => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status });

    await expect(client.get('hrv', { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_unexpected_status', status });
    expect(garmin.dataRequests()).toHaveLength(1);
  });

  it('refuses the request past 150 in a UTC day with garmin_personal_daily_cap, the token exchange counted', async () => {
    const { client, garmin } = await setup();

    for (let i = 0; i < 149; i += 1) await client.get('hrv', { date: '2026-10-25' });
    expect(garmin.tokenRequests()).toHaveLength(1);
    expect(garmin.state.requests).toHaveLength(150);

    const err = await client.get('hrv', { date: '2026-10-25' }).catch((e) => e);
    expect(err).toBeInstanceOf(GarminPersonalError);
    expect(err).toMatchObject({ code: 'garmin_personal_daily_cap' });
    expect(garmin.state.requests).toHaveLength(150);
    expect(client.status().requestsToday).toBe(150);
  });

  it('the retry windows are the compliance numbers', () => {
    expect(RETRY_POLICY.rateLimited).toEqual({ minMs: 60 * 1000, maxMs: 6 * HOUR, maxConsecutive: 3, pauseMs: 24 * HOUR });
    expect(RETRY_POLICY.transient).toEqual({ minMs: 30 * 1000, maxMs: 1 * HOUR, maxAttempts: 5 });
  });

  it('every backoff delay lies inside its window, for any attempt and any jitter', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 60 }),
      fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
      fc.constantFrom(RETRY_POLICY.rateLimited, RETRY_POLICY.transient),
      (attempt, jitter, window) => {
        const delay = backoffDelay(attempt, window, () => jitter);
        return Number.isInteger(delay) && delay >= window.minMs && delay <= window.maxMs;
      },
    ));
  });
});

describe('the endpoint allowlist: five in-scope endpoints, nothing else reachable', () => {
  it('exposes exactly sleep, sleep summaries, HRV, daily heart rate and Body Battery', () => {
    expect([...GARMIN_PERSONAL_ENDPOINT_IDS].sort()).toEqual(['bodyBattery', 'dailyHeartRate', 'dailySleep', 'dailySleepSummaries', 'hrv']);
  });

  it.each([
    ['dailySleep', { date: '2026-10-25' }, '/sleep-service/sleep/dailySleep?date=2026-10-25'],
    ['dailySleepSummaries', { startDate: '2026-09-25', endDate: '2026-10-25' }, '/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-09-25&endDate=2026-10-25'],
    ['hrv', { date: '2026-10-25' }, '/hrv-service/hrv/2026-10-25'],
    ['dailyHeartRate', { date: '2026-10-25' }, '/wellness-service/wellness/dailyHeartRate?date=2026-10-25'],
    ['bodyBattery', { startDate: '2026-10-01', endDate: '2026-10-25' }, '/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-10-01&endDate=2026-10-25'],
  ])('%s requests %s', async (endpoint, params, expectedPath) => {
    const { client, garmin } = await setup();

    await client.get(endpoint, params);

    expect(garmin.dataRequests().map((r) => r.path)).toEqual([expectedPath]);
  });

  // Every other operation in Garmin's Personal API Swagger, plus names a caller might try.
  it.each([
    'activityDownload', 'activities', 'activity', 'activityWorkouts', 'menstrualCycleSummary', 'menstrualCycleDayView',
    'foodLogs', 'weight', 'weightMeasurements', 'hydration', 'weightGoals', 'fitnessAge', 'profileSettings', 'steps',
    'stress', 'heartRateZones', 'spo2', 'wellnessActivitySummaries', 'userSummary', 'dailySummaries', 'hrvSummaries',
    'constructor', '__proto__', 'toString', 'hasOwnProperty', '', undefined,
  ])('%p is refused with garmin_personal_endpoint_not_allowed and sends nothing', async (endpoint) => {
    const { client, garmin } = await setup();

    await expect(client.get(endpoint, { date: '2026-10-25' })).rejects.toMatchObject({ code: 'garmin_personal_endpoint_not_allowed' });
    expect(garmin.state.requests).toHaveLength(0);
  });

  const SWAGGER_PATHS_OUT_OF_SCOPE = [
    '/activity-service/activity/123456789',
    '/activity-service/activity/123456789/workouts',
    '/activitylist-service/activities/search/activities?start=0&limit=20',
    '/biometric-service/heartRateZones/v2',
    '/download-service/files/activity/123456789',
    '/fitnessage-service/fitnessage/v2/2026-10-25',
    '/goal-service/goal/user/effective/weightgoal/2026-10-01/2026-10-25',
    '/hrv-service/hrv/daily/2026-10-01/2026-10-25',
    '/nutrition-service/food/logs/2026-10-25',
    '/periodichealth-service/menstrualcycle/summary/2026-10-25',
    '/periodichealth-service/menstrualcycle/dayview/2026-10-25?todayDate=2026-10-25',
    '/userprofile-service/userprofile/settings',
    '/usersummary-service/stats/hydration/daily/2026-10-01/2026-10-25',
    '/usersummary-service/stats/steps/daily/2026-10-01/2026-10-25',
    '/usersummary-service/stats/stress/daily/2026-10-01/2026-10-25',
    '/usersummary-service/usersummary/daily?calendarDate=2026-10-25',
    '/usersummary-service/v2/dailysummaries?startDate=2026-10-01&endDate=2026-10-25',
    '/weight-service/weight/all/2026-10-01/2026-10-25',
    '/weight-service/weight/range/2026-10-01/2026-10-25?includeAll=true',
    '/wellness-service/wellness/daily/spo2acclimation/2026-10-25',
    '/wellnessactivity-service/activity/summary/range/2026-10-01/2026-10-25',
  ];

  it.each(SWAGGER_PATHS_OUT_OF_SCOPE)('the transport guard refuses GET %s', (outOfScope) => {
    expect(() => assertAllowedRequest('GET', `${BASE_URL}${outOfScope}`)).toThrow(expect.objectContaining({ code: 'garmin_personal_endpoint_not_allowed' }));
  });

  it.each([
    ['a traversal out of an allowed path', 'GET', `${BASE_URL}/hrv-service/hrv/2026-10-25/../../download-service/files/activity/1`],
    ['an encoded traversal', 'GET', `${BASE_URL}/hrv-service/hrv/%2e%2e/%2e%2e/download-service/files/activity/1`],
    ['an extra query parameter', 'GET', `${BASE_URL}/hrv-service/hrv/2026-10-25?x=1`],
    ['a repeated parameter', 'GET', `${BASE_URL}/sleep-service/sleep/dailySleep?date=2026-10-25&date=2026-10-26`],
    ['plain http', 'GET', 'http://personal.connectapi.garmin.com/hrv-service/hrv/2026-10-25'],
    ['another host', 'GET', 'https://connectapi.garmin.com/hrv-service/hrv/2026-10-25'],
    ['a look-alike host', 'GET', 'https://personal.connectapi.garmin.com.evil.example/hrv-service/hrv/2026-10-25'],
    ['another port', 'GET', 'https://personal.connectapi.garmin.com:8443/hrv-service/hrv/2026-10-25'],
    ['credentials in the URL', 'GET', 'https://user:pass@personal.connectapi.garmin.com/hrv-service/hrv/2026-10-25'],
    ['a user name in the URL', 'GET', 'https://user@personal.connectapi.garmin.com/hrv-service/hrv/2026-10-25'],
    ['a traversal that resolves to an allowed path', 'GET', `${BASE_URL}/hrv-service/x/../hrv/2026-10-25`],
    ['an upper-case host', 'GET', 'https://PERSONAL.connectapi.garmin.com/hrv-service/hrv/2026-10-25'],
    ['a fragment', 'GET', `${BASE_URL}/hrv-service/hrv/2026-10-25#x`],
    ['POST to a data path', 'POST', `${BASE_URL}/hrv-service/hrv/2026-10-25`],
    ['GET to the token path', 'GET', `${BASE_URL}${TOKEN_PATH}`],
    ['DELETE', 'DELETE', `${BASE_URL}/hrv-service/hrv/2026-10-25`],
  ])('the transport guard refuses %s', (_label, method, url) => {
    expect(() => assertAllowedRequest(method, url)).toThrow(expect.objectContaining({ code: 'garmin_personal_endpoint_not_allowed' }));
  });

  it.each([
    ['POST', `${BASE_URL}${TOKEN_PATH}`],
    ['GET', `${BASE_URL}/sleep-service/sleep/dailySleep?date=2026-10-25`],
    ['GET', `${BASE_URL}/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-10-01&endDate=2026-10-25`],
    ['GET', `${BASE_URL}/hrv-service/hrv/2026-10-25`],
    ['GET', `${BASE_URL}/wellness-service/wellness/dailyHeartRate?date=2026-10-25`],
    ['GET', `${BASE_URL}/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-10-01&endDate=2026-10-25`],
  ])('the transport guard admits %s %s', (method, url) => {
    expect(() => assertAllowedRequest(method, url)).not.toThrow();
  });

  it.each([
    ['hrv', { date: '2026-02-30' }],
    ['hrv', { date: '2026-1-05' }],
    ['hrv', { date: '2026-10-25/../../download-service/files/activity/1' }],
    ['hrv', { date: 20261025 }],
    ['hrv', {}],
    ['hrv', null],
    ['dailySleep', { date: '2026-10-25T00:00:00Z' }],
    ['dailySleepSummaries', { startDate: '2026-10-25', endDate: '2026-10-24' }],
    ['dailySleepSummaries', { startDate: '2026-09-24', endDate: '2026-10-25' }],
    ['bodyBattery', { startDate: '2026-09-24', endDate: '2026-10-25' }],
    ['bodyBattery', { startDate: '2026-10-01' }],
  ])('%s with %p is garmin_personal_invalid_params, and nothing is sent', async (endpoint, params) => {
    const { client, garmin } = await setup();

    await expect(client.get(endpoint, params)).rejects.toMatchObject({ code: 'garmin_personal_invalid_params' });
    expect(garmin.state.requests).toHaveLength(0);
  });

  it('admits a range of exactly 31 days', async () => {
    const { client, garmin } = await setup();

    await client.get('dailySleepSummaries', { startDate: '2026-09-25', endDate: '2026-10-25' });

    expect(garmin.dataRequests()).toHaveLength(1);
  });
});

describe('errors are closed codes with an HTTP status at most', () => {
  it('every rejection is a GarminPersonalError whose message is its code, carrying nothing but name, code and status', async () => {
    const outcomes = [];
    const run = async (script, { getApiKey } = {}) => {
      const { client, garmin } = await setup({ getApiKey });
      script(garmin);
      outcomes.push(await client.get('hrv', { date: '2026-10-25' }).catch((e) => e));
    };
    await run((g) => g.script(hrvPath('2026-10-25'), { status: 403 }));
    await run((g) => g.script(hrvPath('2026-10-25'), { status: 418 }));
    await run((g) => g.script(hrvPath('2026-10-25'), { status: 200, body: 'nope' }));
    await run(() => {}, { getApiKey: () => '' });

    for (const err of outcomes) {
      expect(err).toBeInstanceOf(GarminPersonalError);
      expect(err).toBeInstanceOf(Error);
      expect(GARMIN_PERSONAL_ERROR_CODES).toContain(err.code);
      expect(err.message).toBe(err.code);
      expect(err.name).toBe('GarminPersonalError');
      expect(Object.keys(err).every((k) => ['name', 'code', 'status'].includes(k))).toBe(true);
      expect(err).not.toHaveProperty('cause');
    }
    expect(outcomes.map((e) => [e.code, e.status])).toEqual([
      ['garmin_personal_forbidden', 403],
      ['garmin_personal_unexpected_status', 418],
      ['garmin_personal_malformed_response', 200],
      ['garmin_personal_key_missing', undefined],
    ]);
  });

  it('the codes are a closed, frozen list', () => {
    expect(Object.isFrozen(GARMIN_PERSONAL_ERROR_CODES)).toBe(true);
    expect(GARMIN_PERSONAL_ERROR_CODES.every((code) => /^garmin_personal_[a-z_]+$/.test(code))).toBe(true);
  });
});

describe('one client per process: the token is reused across runs', () => {
  it('getGarminPersonalClient returns the same client every time, and making it sends nothing', () => {
    const first = getGarminPersonalClient();

    expect(getGarminPersonalClient()).toBe(first);
    expect(Object.keys(first).sort()).toEqual(['get', 'status']);
  });
});

describe('the key-expiry warning (no key material involved)', () => {
  const DAY = 24 * HOUR;
  const EXPIRES = '2027-01-24';
  const expiresMs = Date.parse('2027-01-24T00:00:00.000Z');

  it.each([
    ['ok more than 14 days out', expiresMs - 15 * DAY, { status: 'ok', daysLeft: 15 }],
    ['expiring exactly 14 days out', expiresMs - 14 * DAY, { status: 'expiring', daysLeft: 14 }],
    ['expiring the day before', expiresMs - DAY + 1, { status: 'expiring', daysLeft: 0 }],
    ['expired at the expiry moment', expiresMs, { status: 'expired', daysLeft: 0 }],
    ['expired after it', expiresMs + 3 * DAY, { status: 'expired', daysLeft: 0 }],
  ])('%s', (_label, now, expected) => {
    expect(keyExpiryStatus({ expiresAt: EXPIRES, now })).toEqual(expected);
  });

  it('reads a date as 00:00 UTC and a date-time with an explicit zone as written', () => {
    const now = Date.parse('2027-01-01T00:00:00.000Z');
    expect(keyExpiryStatus({ expiresAt: '2027-01-24T00:00:00Z', now })).toEqual({ status: 'ok', daysLeft: 23 });
    expect(keyExpiryStatus({ expiresAt: '2027-01-24T02:00:00+02:00', now })).toEqual({ status: 'ok', daysLeft: 23 });
  });

  it.each([undefined, '', 'soon', '2027-02-30', '2027-01-24T00:00:00', 1790000000000])('an absent or unreadable expiry (%p) is unknown, even with the variable set', (expiresAt) => {
    // An explicit value, undefined included, is what is judged: the variable is only the default.
    const before = process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT;
    process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT = '2027-01-24';
    try {
      expect(keyExpiryStatus({ expiresAt, now: Date.parse('2027-01-01T00:00:00Z') })).toEqual({ status: 'unknown', daysLeft: null });
    } finally {
      if (before === undefined) delete process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT;
      else process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT = before;
    }
  });

  it('reads GARMIN_PERSONAL_KEY_EXPIRES_AT by default', () => {
    const before = process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT;
    process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT = '2027-01-24';
    try {
      expect(keyExpiryStatus({ now: expiresMs - 2 * DAY })).toEqual({ status: 'expiring', daysLeft: 2 });
    } finally {
      if (before === undefined) delete process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT;
      else process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT = before;
    }
  });

  it('returns a status and a day count only, and never reads the key', () => {
    const before = process.env.GARMIN_PERSONAL_API_KEY;
    process.env.GARMIN_PERSONAL_API_KEY = SENTINEL_KEY;
    try {
      const result = keyExpiryStatus({ expiresAt: EXPIRES, now: expiresMs - 20 * DAY });
      expect(Object.keys(result).sort()).toEqual(['daysLeft', 'status']);
      expect(JSON.stringify(result)).not.toContain(SENTINEL_KEY);
    } finally {
      if (before === undefined) delete process.env.GARMIN_PERSONAL_API_KEY;
      else process.env.GARMIN_PERSONAL_API_KEY = before;
    }
  });
});

describe('backend/.env.example declares the personal lane by name only', () => {
  const lines = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8').split(/\r?\n/);

  it.each([
    'GARMIN_PERSONAL_LANE_ENABLED',
    'GARMIN_PERSONAL_OWNER_USER_ID',
    'GARMIN_PERSONAL_CONNECT_AT_VERSION',
    'GARMIN_PERSONAL_API_KEY',
    'GARMIN_PERSONAL_KEY_EXPIRES_AT',
  ])('%s is declared once, with no value', (name) => {
    const declared = lines.filter((line) => line.startsWith(`${name}=`));
    expect(declared).toEqual([`${name}=`]);
  });

  it('marks the key as a sealed Railway variable on the worker service only, never committed', () => {
    const at = lines.indexOf('GARMIN_PERSONAL_API_KEY=');
    const comment = lines.slice(Math.max(0, at - 4), at).join(' ');
    expect(comment).toMatch(/sealed/i);
    expect(comment).toMatch(/Railway/);
    expect(comment).toMatch(/worker/i);
    expect(comment).toMatch(/never commit/i);
  });
});
