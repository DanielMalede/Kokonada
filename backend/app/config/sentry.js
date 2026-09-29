const { types: { isNativeError } } = require('util');

let Sentry = null;

// Request headers that carry a credential the app accepts: the app JWT and the watch `whr_` token
// (Authorization — middleware/auth.js, integrationsController watch ingest), session cookies, and
// the webhook credentials (x-garmin-webhook-secret, x-suunto-signature). proxy-authorization and
// x-api-key are standard credential carriers, stripped even though no route reads them today.
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-garmin-webhook-secret',
  'x-suunto-signature',
]);

// Span / breadcrumb attributes. URL-valued ones keep their path and lose everything from `?` or
// `#` on; the rest are deleted outright. The server span (node-core httpServerSpansIntegration)
// puts the full URL WITH its query in http.url / http.target, the client address from
// X-Forwarded-For in http.client_ip and the socket peer in net.peer.ip — the IP despite
// sendDefaultPii:false. Outgoing spans and breadcrumbs carry url.full and http.query.
const URL_ATTRIBUTES = ['url', 'http.url', 'http.target', 'url.full'];
const DROPPED_ATTRIBUTES = [
  'http.query', 'url.query', 'http.fragment', 'url.fragment',
  'http.client_ip', 'net.peer.ip', 'client.address',
];

// The SDK also copies request/response headers into span attributes: `http.request.header.<name>`
// (with `-` → `_`), and cookies one per name as `http.request.header.cookie.<cookie>`. Its own
// filter masks only names on its sensitive-snippet list — a cookie named `io`, or
// x-suunto-signature, ships raw. Every attribute for a credential header goes, whatever its value.
const HEADER_ATTRIBUTE = /^http\.(?:request|response)\.header\.([^.]+)/;
const CREDENTIAL_HEADER_ATTRIBUTES = new Set(
  [...CREDENTIAL_HEADERS, 'set-cookie'].map((name) => name.replace(/-/g, '_')),
);

const _withoutQuery = (url) => url.split(/[?#]/)[0];

function _scrubAttributes(data) {
  if (!data || typeof data !== 'object') return;
  for (const key of URL_ATTRIBUTES) {
    if (typeof data[key] === 'string') data[key] = _withoutQuery(data[key]);
  }
  for (const key of DROPPED_ATTRIBUTES) delete data[key];
  for (const key of Object.keys(data)) {
    const header = HEADER_ATTRIBUTE.exec(key)?.[1];
    if (header && CREDENTIAL_HEADER_ATTRIBUTES.has(header.toLowerCase())) delete data[key];
  }
}

// Strip credentials, bodies, query strings and client addresses from every event before it leaves
// the process — error events (beforeSend) AND sampled transactions (beforeSendTransaction).
//  • event.request: the SDK's RequestData integration attaches the incoming request to any event
//    captured inside an HTTP request — headers, parsed cookies and the BODY included, even with
//    sendDefaultPii:false (@sentry/core integrations/requestdata.js; the SDK's own header deny-list
//    applies to span attributes only). Credential headers (case-insensitive), cookies, the body
//    (`data`) and the query string go.
//  • contexts.trace.data / spans[].data / breadcrumbs[].data: URLs lose their query, and query /
//    client-address attributes go (see URL_ATTRIBUTES / DROPPED_ATTRIBUTES).
// Without this an error on an authenticated route ships the caller's Bearer token and login body,
// and a sampled Garmin push ships the webhook's permanent ?secret=. FAILS CLOSED: if scrubbing
// throws, the event is dropped (null) rather than sent half-scrubbed. (compliance C2)
function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;
  try {
    const req = event.request;
    if (req && typeof req === 'object') {
      if (typeof req.url === 'string') req.url = _withoutQuery(req.url);
      delete req.query_string;
      delete req.cookies;
      delete req.data;
      const headers = req.headers;
      if (headers && typeof headers === 'object') {
        for (const name of Object.keys(headers)) {
          if (CREDENTIAL_HEADERS.has(name.toLowerCase())) delete headers[name];
        }
      }
    }
    _scrubAttributes(event.contexts?.trace?.data);
    if (Array.isArray(event.spans)) for (const span of event.spans) _scrubAttributes(span?.data);
    if (Array.isArray(event.breadcrumbs)) for (const crumb of event.breadcrumbs) _scrubAttributes(crumb?.data);
    return event;
  } catch {
    return null;
  }
}

function initSentry(app) {
  if (!process.env.SENTRY_DSN) {
    console.log('Sentry DSN not set — skipping error monitoring');
    return;
  }
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // Withholds the user's IP address from event.user only. It does NOT keep request headers,
    // cookies, bodies, query strings or the span IP attributes out of events — scrubEvent strips
    // those, and the Http integration below never buffers bodies at all (compliance C2).
    sendDefaultPii: false,
    // The SDK buffers every incoming request body (default 'medium', 10 kB) regardless of
    // sendDefaultPii: @sentry/node integrations/http.js:21 maps maxIncomingRequestBodySize to the
    // server integration's maxRequestBodySize, and @sentry/core integrations/http/
    // server-subscription.js:54 skips the body patch only when it is 'none'. This instance replaces
    // the default `Http` integration (a user instance wins by name — core integration.js).
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })],
    // beforeSend sees ERROR events only; sampled transactions reach Sentry through
    // beforeSendTransaction and carry the same request data, so both hooks scrub.
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
  // Must be called after all routes are registered
  if (app) Sentry.setupExpressErrorHandler(app);
}

function getSentry() {
  return Sentry;
}

// Defence in depth: an AxiosError carries its outbound request — config.headers (an OAuth Bearer
// or the Groq key), config.data (the body) and the request/response objects. The SDK does not
// serialize arbitrary error properties today, but extraErrorDataIntegration or a deeper
// normalizeDepth would. Sentry gets a COPY keeping name, message, code, status and stack (so issue
// grouping is unchanged); the caller's error is not mutated. Detected by the flag axios sets
// (the same check as axios.isAxiosError), so this module needs no axios import.
function _withoutAxiosRequest(err) {
  if (!err || err.isAxiosError !== true) return err;
  const copy = new Error(err.message);
  copy.name = err.name;
  copy.stack = err.stack;
  if (err.code != null) copy.code = err.code;
  const status = err.response?.status ?? err.status;
  if (status != null) copy.status = status;
  return copy;
}

// Only Errors reach the SDK. A non-Error value is serialized by the SDK into extra.__serialized__
// to depth 3 — for Engine.IO's {req, code, message, context} that is the raw request (rawHeaders,
// the URL with its sid). It is wrapped in an Error keeping only a string message and a code.
function _asError(value) {
  if (value instanceof Error || isNativeError(value)) return _withoutAxiosRequest(value);
  let message;
  if (typeof value === 'string') message = value;
  else if (typeof value?.message === 'string') message = value.message;
  else message = `Non-Error ${value === null ? 'null' : typeof value} captured`;
  const wrapped = new Error(message);
  const code = value?.code;
  if (typeof code === 'string' || typeof code === 'number') wrapped.code = code;
  return wrapped;
}

/**
 * Report a caught error to Sentry with optional structured context. A NO-OP when
 * Sentry isn't configured (no DSN), so call sites can wrap any silent `catch` without
 * guarding. Never throws — telemetry must never break the request/socket it observes.
 * @param {Error} err
 * @param {Record<string, unknown>} [context] extra fields (scope, userId, model, …)
 */
function captureException(err, context) {
  if (!Sentry) return;
  try {
    Sentry.captureException(_asError(err), context ? { extra: context } : undefined);
  } catch {
    /* swallow — a failing monitor must not cascade */
  }
}

module.exports = { initSentry, getSentry, captureException, scrubEvent };
