let Sentry = null;

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
  });
  // Must be called after all routes are registered
  if (app) Sentry.setupExpressErrorHandler(app);
}

function getSentry() {
  return Sentry;
}

module.exports = { initSentry, getSentry };