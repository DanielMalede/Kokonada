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
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    /* swallow — a failing monitor must not cascade */
  }
}

module.exports = { initSentry, getSentry, captureException };