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

// Strip credentials and query strings from every event before it leaves the process. The SDK's
// RequestData integration attaches the incoming request to any event captured inside an HTTP
// request — its headers and parsed cookies INCLUDED, even with sendDefaultPii:false (@sentry/core
// integrations/requestdata.js; the SDK's own deny-list applies to span attributes only). Without
// this an error on an authenticated route would ship the caller's Bearer token, and one on the
// webhook route its ?secret= (or an OAuth ?code=/?state=). Header names are matched
// case-insensitively. Never throws — telemetry must not break on a malformed event.
// (compliance C2)
function scrubEvent(event) {
  if (!event || !event.request) return event;
  const req = event.request;
  if (typeof req.url === 'string') req.url = req.url.split('?')[0];
  if ('query_string' in req) delete req.query_string;
  if ('cookies' in req) delete req.cookies;
  if (req.headers && typeof req.headers === 'object') {
    for (const name of Object.keys(req.headers)) {
      if (CREDENTIAL_HEADERS.has(name.toLowerCase())) delete req.headers[name];
    }
  }
  return event;
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
    // Withholds the user's IP and request bodies. It does NOT keep request headers or cookies
    // out of events — scrubEvent strips those (compliance C2).
    sendDefaultPii: false,
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
    Sentry.captureException(_withoutAxiosRequest(err), context ? { extra: context } : undefined);
  } catch {
    /* swallow — a failing monitor must not cascade */
  }
}

module.exports = { initSentry, getSentry, captureException, scrubEvent };
