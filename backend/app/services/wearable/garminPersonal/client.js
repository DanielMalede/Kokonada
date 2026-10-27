'use strict';

/**
 * The Garmin Connect Personal API client: the owner-only Phase 1 lane's only way to Garmin (T3).
 *
 * SOURCES, read on 2026-10-26:
 *   · Garmin's own client, github.com/garmin/connect-personal-api-python at ac111a0 (Apache-2.0):
 *     constants.py (the base URL, the token path, a 30 s timeout), auth.py (POST the token path with
 *     an Accept of any type and `Authorization: ApiKey <key>`; the response body IS the JWT, not JSON; its
 *     expiry is the JWT's `exp`; a cached token is reused only while more than one hour remains),
 *     client.py (every data request is a GET with `Accept: application/json` and
 *     `Authorization: Bearer <jwt>`).
 *   · Garmin's Personal API Swagger (OpenAPI 3.0.1, "Garmin Connect Personal API" 1.0.0, at
 *     developer.garmin.com/gc-developer-program/personal/swagger-docs/): the five paths below, their
 *     parameters, and the ranges (sleep summaries and Body Battery reports: 31 days at most). It
 *     documents no rate limit, no Retry-After and no history depth, so the cadence is ours
 *     (ratePolicy.js, compliance C12).
 *
 * WHAT IT GUARANTEES
 *   · ALLOWLIST. A caller names an endpoint id, never a path, and five ids exist: sleep (one day, or
 *     a range of up to 31 days), HRV (one day, the only HRV endpoint that carries the night's
 *     window), daily heart rate (resting HR and the day's series) and Body Battery reports (mapped
 *     for Phase 1c, and refused, on the transport too, unless the client is built with
 *     allowBodyBattery: true, which nothing does before its consent gate, T10 and T11). Activities and
 *     their FIT download (which carries GPS), women's health, nutrition, weight, hydration, goals,
 *     fitness age, the user profile, steps, stress aggregates, SpO2 and the user summaries are
 *     unreachable: no id builds them, and assertAllowedRequest refuses every URL that is not one of
 *     the enabled endpoints (or the token POST) on the transport, before a byte is sent.
 *   · THE KEY is read (GARMIN_PERSONAL_API_KEY by default) only at the moment of an exchange. It is
 *     never stored by this module, never returned and never part of an error.
 *   · THE JWT lives in this module's memory only: a closure no caller can reach, never returned,
 *     never persisted (this file requires nothing that writes), never in an error. It is exchanged
 *     once and reused until one hour before it expires (its `exp`, capped at 24 h), or until half of
 *     what it had left has passed when that was under two hours, and two requests that need one
 *     share a single exchange. At most 3 exchanges start in a UTC day; a 4th is refused with
 *     garmin_personal_exchange_budget, without reading the key. getGarminPersonalClient keeps one
 *     client per process, so a job that runs every 6 h exchanges about once a day.
 *   · THE WIRE: https://personal.connectapi.garmin.com only, port 443, no redirect is followed (one
 *     would carry the Bearer elsewhere), no proxy is used (an environment variable cannot route the
 *     credential through one), a deadline on every request, and at most 5 MB of body, counted after
 *     decompression. An error response's body is never read: a server that echoes a request's
 *     headers back cannot hand the credential to anything here.
 *   · ERRORS are GarminPersonalError: the message is the code, one of GARMIN_PERSONAL_ERROR_CODES,
 *     and the only other field is the HTTP status when there was one. Never a URL, a header, a body
 *     or a cause.
 *   · RETRIES (compliance C12): 401 re-exchanges once, then stops the lane; 403 stops it at once
 *     (Garmin suspended the key); a 429 waits for Retry-After (60 s at least) or a jittered backoff
 *     of 60 s..6 h, and three 429s in a row pause the lane for 24 h; a 5xx, a timeout or a network
 *     failure waits a jittered 30 s..1 h, at most 5 attempts. A stop or a pause is remembered: later
 *     calls are refused without a request, and so is a request already waiting in the queue when it
 *     lands, at the moment its turn comes (unsent, uncounted). The process's memory is all it has, so
 *     the caller keeps its own persisted record of a stop or a pause.
 */

const https = require('https');
const axios = require('axios');
const { createRatePolicy, DAILY_CAP_CODE } = require('./ratePolicy');

const HOST = 'personal.connectapi.garmin.com';
const BASE_URL = `https://${HOST}`;
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

const TIMEOUT_MS = 30 * 1000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_TOKEN_BYTES = 16 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TOKEN_LIFETIME_CAP_MS = DAY_MS;
const TOKEN_REFRESH_WINDOW_MS = HOUR_MS;
// Each exchange sends the key. Garmin's token lasts 24 h, so a day needs one, and one more after a 401.
const MAX_EXCHANGES_PER_UTC_DAY = 3;
const KEY_EXPIRY_WARNING_MS = 14 * DAY_MS;

const RETRY_POLICY = Object.freeze({
  rateLimited: Object.freeze({ minMs: 60 * 1000, maxMs: 6 * HOUR_MS, maxConsecutive: 3, pauseMs: DAY_MS }),
  transient: Object.freeze({ minMs: 30 * 1000, maxMs: HOUR_MS, maxAttempts: 5 }),
});

const GARMIN_PERSONAL_ERROR_CODES = Object.freeze([
  'garmin_personal_key_missing',
  'garmin_personal_key_invalid',
  'garmin_personal_endpoint_not_allowed',
  'garmin_personal_invalid_params',
  'garmin_personal_unauthorized',
  'garmin_personal_forbidden',
  'garmin_personal_paused',
  DAILY_CAP_CODE,
  'garmin_personal_unavailable',
  'garmin_personal_timeout',
  'garmin_personal_network',
  'garmin_personal_unexpected_status',
  'garmin_personal_response_too_large',
  'garmin_personal_malformed_response',
  'garmin_personal_token_invalid',
  'garmin_personal_exchange_budget',
  'garmin_personal_internal',
]);

const TRANSIENT_CODES = Object.freeze({
  timeout: 'garmin_personal_timeout',
  network: 'garmin_personal_network',
  unavailable: 'garmin_personal_unavailable',
});

class GarminPersonalError extends Error {
  /** @param {string} code one of GARMIN_PERSONAL_ERROR_CODES  @param {number} [status] the HTTP status, if any */
  constructor(code, status) {
    super(code);
    this.name = 'GarminPersonalError';
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
  }
}

// ── The allowlist ────────────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const D = '\\d{4}-\\d{2}-\\d{2}';

function isCalendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

const invalidParams = () => new GarminPersonalError('garmin_personal_invalid_params');

const oneDay = (build) => (params) => {
  const date = params?.date;
  if (!isCalendarDate(date)) throw invalidParams();
  return build(date);
};

const dayRange = (maxDays, build) => (params) => {
  const startDate = params?.startDate;
  const endDate = params?.endDate;
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) throw invalidParams();
  const days = (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / DAY_MS + 1;
  if (days < 1 || days > maxDays) throw invalidParams();
  return build(startDate, endDate);
};

const ENDPOINTS = Object.freeze({
  dailySleep: Object.freeze({
    build: oneDay((date) => `/sleep-service/sleep/dailySleep?date=${date}`),
    pattern: new RegExp(`^/sleep-service/sleep/dailySleep\\?date=${D}$`),
  }),
  dailySleepSummaries: Object.freeze({
    build: dayRange(31, (start, end) => `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${start}&endDate=${end}`),
    pattern: new RegExp(`^/sleep-service/sleep/dailySleepSummariesByDate\\?startDate=${D}&endDate=${D}$`),
  }),
  hrv: Object.freeze({
    build: oneDay((date) => `/hrv-service/hrv/${date}`),
    pattern: new RegExp(`^/hrv-service/hrv/${D}$`),
  }),
  dailyHeartRate: Object.freeze({
    build: oneDay((date) => `/wellness-service/wellness/dailyHeartRate?date=${date}`),
    pattern: new RegExp(`^/wellness-service/wellness/dailyHeartRate\\?date=${D}$`),
  }),
  bodyBattery: Object.freeze({
    build: dayRange(31, (start, end) => `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${start}&endDate=${end}`),
    pattern: new RegExp(`^/wellness-service/wellness/bodyBattery/reports/daily\\?startDate=${D}&endDate=${D}$`),
  }),
});

const GARMIN_PERSONAL_ENDPOINT_IDS = Object.freeze(Object.keys(ENDPOINTS));
// Behind a consent gate (Body Battery: T10, T11), so unreachable unless a client is built to fetch it.
const CONSENT_GATED_ENDPOINT_IDS = Object.freeze(['bodyBattery']);

const isEnabled = (endpointId, allowBodyBattery) => allowBodyBattery === true || !CONSENT_GATED_ENDPOINT_IDS.includes(endpointId);
const dataPatterns = (allowBodyBattery) => Object.freeze(
  Object.entries(ENDPOINTS).filter(([id]) => isEnabled(id, allowBodyBattery)).map(([, endpoint]) => endpoint.pattern),
);
const OPEN_DATA_PATTERNS = dataPatterns(false);
const ALL_DATA_PATTERNS = dataPatterns(true);

/**
 * The transport's own check, run on every URL before it is sent: https, the Garmin host on the
 * default port, no credentials or fragment, already canonical (nothing for a URL parser to resolve),
 * and either POST to the token path or GET of one of the allowlisted paths, the Body Battery path
 * only when `allowBodyBattery` is exactly true.
 * @param {{allowBodyBattery?: boolean}} [options]
 * @throws {GarminPersonalError} garmin_personal_endpoint_not_allowed
 */
function assertAllowedRequest(method, url, { allowBodyBattery = false } = {}) {
  const patterns = allowBodyBattery === true ? ALL_DATA_PATTERNS : OPEN_DATA_PATTERNS;
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  const target = parsed ? parsed.pathname + parsed.search : '';
  const allowed = parsed !== null
    && parsed.href === url
    && parsed.protocol === 'https:'
    && parsed.hostname === HOST
    && parsed.port === ''
    && parsed.username === ''
    && parsed.password === ''
    && parsed.hash === ''
    && (method === 'POST' ? target === TOKEN_PATH : method === 'GET' && patterns.some((pattern) => pattern.test(target)));
  if (!allowed) throw new GarminPersonalError('garmin_personal_endpoint_not_allowed');
}

// ── The wire ─────────────────────────────────────────────────────────────────────────────────────

// An instance of its own: interceptors another module adds to the default axios never see this traffic.
const httpClient = axios.create();

const WIRE = Object.freeze({
  maxRedirects: 0,
  proxy: false,
  decompress: true,
  responseType: 'stream',
  maxContentLength: -1, // the cap is enforced below, on the decompressed stream
  validateStatus: () => true,
  transformResponse: [(data) => data],
});

const TOO_LARGE = Symbol('too large');

async function readCapped(stream, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) return TOO_LARGE;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

function headerValue(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One HTTP exchange. Resolves to { status, retryAfter?, body?, tooLarge? } or { failure: 'timeout'|'network' };
 * never rejects with anything that carries the request.
 *
 * The deadline is one wall-clock limit on the whole exchange (connect, headers and body), so a server
 * that trickles a byte at a time cannot hold a request open. A failure is classified by what this
 * side knows (did the deadline end it?), never by reading the axios error, which carries the request
 * it failed on, headers included, and is dropped here.
 */
function createTransport({ httpsAgent, timeoutMs, allowBodyBattery }) {
  return async function send(method, path, headers, maxBytes) {
    const url = `${BASE_URL}${path}`;
    assertAllowedRequest(method, url, { allowBodyBattery });
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();
    const failure = () => ({ failure: controller.signal.aborted ? 'timeout' : 'network' });
    let response;
    try {
      response = await httpClient.request({ method, url, headers, httpsAgent, signal: controller.signal, ...WIRE });
    } catch {
      clearTimeout(deadline);
      return failure();
    }
    const { status } = response;
    const stream = response.data;
    try {
      if (status < 200 || status >= 300 || status === 204) {
        return { status, retryAfter: headerValue(response.headers, 'retry-after') };
      }
      const declared = Number(headerValue(response.headers, 'content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) return { status, tooLarge: true };
      const body = await readCapped(stream, maxBytes);
      return body === TOO_LARGE ? { status, tooLarge: true } : { status, body };
    } catch {
      return failure();
    } finally {
      clearTimeout(deadline);
      if (stream && typeof stream.destroy === 'function') stream.destroy();
    }
  };
}

// ── The policy ───────────────────────────────────────────────────────────────────────────────────

/**
 * Exponential backoff with jitter, inside [minMs, maxMs]: attempt n waits between minMs·2^(n-1) and
 * twice that, never more than maxMs.
 */
function backoffDelay(attempt, { minMs, maxMs }, random = Math.random) {
  const floor = minMs * 2 ** (Math.max(1, attempt) - 1);
  return Math.min(maxMs, Math.round(floor * (1 + random())));
}

/** Retry-After as delay-seconds or an HTTP date, in ms from now; null when absent or unreadable. */
function parseRetryAfterMs(value, nowMs) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// The token endpoint's body is the JWT itself. Its signature is Garmin's to check; this side reads
// only `exp`, and never trusts a lifetime longer than the 24 h Garmin documents. It is refreshed an
// hour before it expires, or halfway through what it had left when that was under two hours (RA-3):
// a fixed hour early would re-exchange, and send the key, on every call once a token came with less.
function parseToken(body, nowMs) {
  const value = typeof body === 'string' ? body.trim() : '';
  if (!JWT_SHAPE.test(value)) return null;
  let exp;
  try {
    exp = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'))?.exp;
  } catch {
    return null;
  }
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  const expiresAt = Math.min(exp * 1000, nowMs + TOKEN_LIFETIME_CAP_MS);
  if (expiresAt <= nowMs) return null;
  return { value, refreshAt: expiresAt - Math.min(TOKEN_REFRESH_WINDOW_MS, (expiresAt - nowMs) / 2) };
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function readKey(getApiKey) {
  const raw = getApiKey();
  if (typeof raw !== 'string' || raw.trim() === '') throw new GarminPersonalError('garmin_personal_key_missing');
  const key = raw.trim();
  // Visible ASCII only: a space, CR or LF in a header value would split or inject headers.
  if (!/^[\x21-\x7E]+$/.test(key)) throw new GarminPersonalError('garmin_personal_key_invalid');
  return key;
}

// ── The client ───────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} [options]
 * @param {() => (string|undefined)} [options.getApiKey]  read at each exchange; GARMIN_PERSONAL_API_KEY by default
 * @param {import('https').Agent} [options.httpsAgent]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random]  the backoff jitter, in [0, 1)
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxResponseBytes]
 * @param {boolean} [options.allowBodyBattery]  exactly true to reach Body Battery, which waits for
 *   its consent gate (T10, T11); off by default
 */
function createGarminPersonalClient({
  getApiKey = () => process.env.GARMIN_PERSONAL_API_KEY,
  // Certificate checks and TLS 1.2+ pinned here: NODE_TLS_REJECT_UNAUTHORIZED=0 or --tls-min-v1.0
  // would otherwise loosen them for the one connection that carries the key (RA-12).
  httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 1, rejectUnauthorized: true, minVersion: 'TLSv1.2' }),
  now = Date.now,
  sleep,
  random = Math.random,
  timeoutMs = TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  allowBodyBattery = false,
} = {}) {
  const bodyBattery = allowBodyBattery === true;
  const policy = createRatePolicy(sleep ? { now, sleep } : { now });
  const send = createTransport({ httpsAgent, timeoutMs, allowBodyBattery: bodyBattery });
  let token = null; // { value, refreshAt, generation }: never leaves this closure
  let generation = 0;
  let pendingExchange = null;
  let halted = null; // { code, status } once a 401 outlived its re-exchange, or a 403
  let pausedUntil = -Infinity;
  let consecutive429 = 0;
  let exchangeDay = null;
  let exchangesToday = 0;

  const fail = (code, status) => new GarminPersonalError(code, status);

  function assertUsable() {
    if (halted) throw fail(halted.code, halted.status);
    if (now() < pausedUntil) throw fail('garmin_personal_paused', 429);
  }

  function halt(code, status) {
    halted = { code, status };
    token = null;
    return fail(code, status);
  }

  function pause() {
    pausedUntil = now() + RETRY_POLICY.rateLimited.pauseMs;
    consecutive429 = 0;
    return fail('garmin_personal_paused', 429);
  }

  // assertUsable runs again at the request's turn (RA-2): a request can wait behind another, or behind
  // a backoff, and a 403, a second 401 or a third 429 that lands meanwhile refuses it unsent.
  async function attempt(method, path, headers, maxBytes) {
    try {
      return await policy.schedule(() => send(method, path, headers, maxBytes), assertUsable);
    } catch (err) {
      if (err instanceof GarminPersonalError) throw err;
      if (err?.code === DAILY_CAP_CODE) throw fail(DAILY_CAP_CODE);
      throw fail('garmin_personal_internal');
    }
  }

  // A 5xx, a timeout or a network failure: wait, unless this was the last of the attempts.
  function afterTransient(failures, kind, status) {
    const count = failures + 1;
    if (count >= RETRY_POLICY.transient.maxAttempts) throw fail(TRANSIENT_CODES[kind], status);
    policy.deferUntil(now() + backoffDelay(count, RETRY_POLICY.transient, random));
    return count;
  }

  function afterRateLimited(res) {
    consecutive429 += 1;
    if (consecutive429 >= RETRY_POLICY.rateLimited.maxConsecutive) throw pause();
    const retryAfter = parseRetryAfterMs(res.retryAfter, now());
    const delay = retryAfter === null
      ? backoffDelay(consecutive429, RETRY_POLICY.rateLimited, random)
      : Math.max(retryAfter, RETRY_POLICY.rateLimited.minMs);
    if (delay > RETRY_POLICY.rateLimited.maxMs) throw pause();
    policy.deferUntil(now() + delay);
  }

  // At most MAX_EXCHANGES_PER_UTC_DAY exchanges start in a UTC day (the retries inside one are part of
  // it); the count starts again at UTC midnight.
  function exchangeAllowedToday() {
    const today = utcDay(now());
    if (today !== exchangeDay) {
      exchangeDay = today;
      exchangesToday = 0;
    }
    return exchangesToday < MAX_EXCHANGES_PER_UTC_DAY;
  }

  async function exchange() {
    // Past the day's budget the key is not even read.
    if (!exchangeAllowedToday()) throw fail('garmin_personal_exchange_budget');
    const key = readKey(getApiKey);
    exchangesToday += 1;
    let failures = 0;
    for (;;) {
      assertUsable();
      const res = await attempt('POST', TOKEN_PATH, { Accept: '*/*', Authorization: `ApiKey ${key}`, 'Content-Length': '0' }, MAX_TOKEN_BYTES);
      if (res.failure) { failures = afterTransient(failures, res.failure); continue; }
      if (res.status !== 429) consecutive429 = 0;
      // A 401 here is the key itself refused: exchanging again would send the same key again.
      if (res.status === 401) throw halt('garmin_personal_unauthorized', 401);
      if (res.status === 403) throw halt('garmin_personal_forbidden', 403);
      if (res.status === 429) { afterRateLimited(res); continue; }
      if (res.status >= 500) { failures = afterTransient(failures, 'unavailable', res.status); continue; }
      if (res.status < 200 || res.status >= 300) throw fail('garmin_personal_unexpected_status', res.status);
      if (res.tooLarge) throw fail('garmin_personal_response_too_large', res.status);
      const parsed = parseToken(res.body, now());
      if (!parsed) throw fail('garmin_personal_token_invalid', res.status);
      generation += 1;
      token = { ...parsed, generation };
      return token;
    }
  }

  function currentToken() {
    if (token && now() < token.refreshAt) return Promise.resolve(token);
    if (!pendingExchange) pendingExchange = exchange().finally(() => { pendingExchange = null; });
    return pendingExchange;
  }

  async function getJson(endpointId, params) {
    if (typeof endpointId !== 'string' || !Object.hasOwn(ENDPOINTS, endpointId) || !isEnabled(endpointId, bodyBattery)) {
      throw fail('garmin_personal_endpoint_not_allowed');
    }
    const path = ENDPOINTS[endpointId].build(params);
    let reexchanged = false;
    let failures = 0;
    for (;;) {
      assertUsable();
      const { value, generation: used } = await currentToken();
      const res = await attempt('GET', path, { Accept: 'application/json', Authorization: `Bearer ${value}` }, maxResponseBytes);
      if (res.failure) { failures = afterTransient(failures, res.failure); continue; }
      if (res.status !== 429) consecutive429 = 0;
      if (res.status === 401) {
        if (reexchanged) throw halt('garmin_personal_unauthorized', 401);
        reexchanged = true;
        if (token && token.generation === used) token = null; // a request that already refreshed keeps its token
        continue;
      }
      if (res.status === 403) throw halt('garmin_personal_forbidden', 403);
      if (res.status === 429) { afterRateLimited(res); continue; }
      if (res.status >= 500) { failures = afterTransient(failures, 'unavailable', res.status); continue; }
      if (res.status < 200 || res.status >= 300) throw fail('garmin_personal_unexpected_status', res.status);
      if (res.tooLarge) throw fail('garmin_personal_response_too_large', res.status);
      if (res.status === 204 || typeof res.body !== 'string' || res.body.trim() === '') return null;
      try {
        return JSON.parse(res.body);
      } catch {
        // The parser's own message quotes the body; it stays here.
        throw fail('garmin_personal_malformed_response', res.status);
      }
    }
  }

  /**
   * GET one allowlisted endpoint.
   * @param {'dailySleep'|'dailySleepSummaries'|'hrv'|'dailyHeartRate'|'bodyBattery'} endpointId
   * @param {{date?: string, startDate?: string, endDate?: string}} params  YYYY-MM-DD calendar dates
   * @returns {Promise<unknown>} the decoded JSON, or null for no data (204 or an empty body)
   * @throws {GarminPersonalError}
   */
  async function get(endpointId, params) {
    try {
      return await getJson(endpointId, params);
    } catch (err) {
      if (err instanceof GarminPersonalError) throw err;
      throw fail('garmin_personal_internal');
    }
  }

  /** Counts and flags only, for a run summary. */
  function status() {
    return {
      requestsToday: policy.snapshot().requestsToday,
      paused: now() < pausedUntil,
      stopped: halted ? halted.code : null,
    };
  }

  return Object.freeze({ get, status });
}

let processClient = null;

/** The process's one client, so its token outlives a single run of the pull job. */
function getGarminPersonalClient() {
  if (!processClient) processClient = createGarminPersonalClient();
  return processClient;
}

// ── The key's own expiry ─────────────────────────────────────────────────────────────────────────

const EXPIRY_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// A date is read as 00:00 UTC, the earliest reading of it; a date-time must carry its zone.
function parseExpiry(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (ISO_DATE.test(text)) return isCalendarDate(text) ? Date.parse(`${text}T00:00:00.000Z`) : null;
  if (!EXPIRY_DATE_TIME.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Where the personal API key stands against its own expiry date (GARMIN_PERSONAL_KEY_EXPIRES_AT by
 * default). Garmin issues keys with an expiry the owner chooses; the lane warns 14 days ahead. No
 * key material is involved: only the date.
 * @param {{expiresAt?: string, now?: number}} [options]
 * @returns {{status: 'ok'|'expiring'|'expired'|'unknown', daysLeft: number|null}}
 */
function keyExpiryStatus(options = {}) {
  const expiresAt = Object.hasOwn(options, 'expiresAt') ? options.expiresAt : process.env.GARMIN_PERSONAL_KEY_EXPIRES_AT;
  const now = Object.hasOwn(options, 'now') ? options.now : Date.now();
  const expiry = parseExpiry(expiresAt);
  // A clock or an expiry that is not a finite number is unknown, never ok: NaN compares false both
  // ways, and the warning would fail open (RA-7).
  if (!Number.isFinite(expiry) || !Number.isFinite(now)) return { status: 'unknown', daysLeft: null };
  const left = expiry - now;
  if (left <= 0) return { status: 'expired', daysLeft: 0 };
  return { status: left <= KEY_EXPIRY_WARNING_MS ? 'expiring' : 'ok', daysLeft: Math.floor(left / DAY_MS) };
}

module.exports = {
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
};
