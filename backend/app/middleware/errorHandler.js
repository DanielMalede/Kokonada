const isDev = process.env.NODE_ENV === 'development';
const { captureException } = require('../config/sentry');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  // RA-3 (#320): an upstream provider's answer (an axios error carries its status on `response` and,
  // from axios 1.x, on `status`) is never sent as our own status: a provider's 401 would read, to the
  // mobile client, as a refused Kokonada token and end the session. It is a bad gateway. A typed error
  // that names its own `statusCode` keeps it.
  const upstream = !err.statusCode && (err.isAxiosError || err.response !== undefined);
  const status = upstream ? 502 : (err.statusCode || err.status || 500);

  // Report genuine server faults (5xx) to Sentry — 4xx are client errors (bad input,
  // auth) and would just be noise. Sentry.setupExpressErrorHandler only fires for errors
  // that reach Express's default handler; capturing here guarantees coverage even though
  // this middleware terminates the response itself.
  if (status >= 500) {
    // Capture the PATH ONLY — never the query string. Some endpoints carry secrets in the
    // query (the webhook `?secret=`, OAuth `?code=`/`?state=`); shipping req.originalUrl to
    // Sentry would leak those standing/one-time credentials to a third-party service.
    const path = (req.originalUrl || req.url || '').split('?')[0];
    captureException(err, { scope: 'http', method: req.method, path });
  }

  // Never leak internal details in production
  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
    // A typed client error keeps its code on the wire (`reconnect_required`); a 5xx never sends one.
    ...(status < 500 && typeof err.code === 'string' && { code: err.code }),
    ...(isDev && { detail: err.message, stack: err.stack }),
  });
};
