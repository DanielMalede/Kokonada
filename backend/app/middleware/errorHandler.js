const isDev = process.env.NODE_ENV === 'development';
const { captureException } = require('../config/sentry');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || err.response?.status || 500;

  // Report genuine server faults (5xx) to Sentry — 4xx are client errors (bad input,
  // auth) and would just be noise. Sentry.setupExpressErrorHandler only fires for errors
  // that reach Express's default handler; capturing here guarantees coverage even though
  // this middleware terminates the response itself.
  if (status >= 500) {
    captureException(err, { scope: 'http', method: req.method, path: req.originalUrl });
  }

  // Never leak internal details in production
  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
    ...(isDev && { detail: err.message, stack: err.stack }),
  });
};
