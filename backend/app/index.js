// override:true makes the local .env authoritative over inherited shell vars
// (e.g. a global NODE_ENV=production leaking into dev, which would force
// secure:true cookies that browsers drop over http://localhost). In real
// deployments there is no .env file, so platform env vars still win.
require('dotenv').config({ override: true });
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { initSentry } = require('./config/sentry');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { apiLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const authRouter         = require('./routes/auth');
const integrationsRouter = require('./routes/integrations');
const sessionsRouter     = require('./routes/sessions');
const pulseRouter        = require('./routes/pulse');
const discoveryRouter    = require('./routes/discovery');
const consentRouter      = require('./routes/consent');
const { startInProcessWorkers } = require('./workers');
const { createSocketServer } = require('./sockets');

const app = express();

// Behind Railway's reverse proxy: trust exactly ONE hop so req.ip resolves to the
// real client instead of the proxy. Without this, express-rate-limit keys every
// request on the proxy's IP — collapsing all users into one bucket and rendering
// the auth/brute-force limiter useless. `1` (not `true`) avoids trusting a
// spoofable X-Forwarded-For chain. (audit F2)
app.set('trust proxy', 1);

initSentry(app);

// helmet() defaults already set HSTS, a restrictive CSP, X-Frame-Options: DENY,
// and CORP — appropriate for this JSON-only API. (The browser-facing CSP that used to
// matter for XSS was set on the deleted web frontend; there is no browser surface now.)
app.use(helmet());

// NO CORS MIDDLEWARE, DELIBERATELY — and removing it made this API stricter, not looser.
//
// `cors()` is not a request filter. For any non-OPTIONS request it sets response headers and
// calls next() (cors/lib/index.js) — it never rejects. With a fixed origin it emits
// Access-Control-Allow-Origin unconditionally, even to an attacker's page; the BROWSER does the
// comparing. So what it bought was: a mismatching ACAO that makes a browser abort a preflighted
// cross-site write, and withheld ACAO on cross-origin reads. Removing it emits NO ACAO at all,
// which is the same posture as `origin: false` — both protections survive, now delivered by the
// plain same-origin policy. There is no configuration of this package that is safer than absent,
// short of `origin:'*'`, which nobody wants.
//
// The web surface it served is deleted; the only client is the React Native app, which is not a
// browser and has no origin to send. The `FRONTEND_URL` boot assertion went with it — an
// assertion guarding a middleware that no longer exists is a boot failure waiting for whoever
// next deploys without the variable.

// A vetted LLM provider (Groq LLM_API_KEY) is mandatory in production — we refuse to
// start rather than silently degrade to an unvetted, training-eligible endpoint with
// special-category signals. (Wave-0 egress containment)
require('./config/llmProvider').assertVettedLlmProvider();

app.use(cookieParser());

// The Suunto webhook needs the raw body for HMAC verification, so it bypasses
// express.json. Bound it hard (every other route is capped at 10kb below) to
// prevent a memory-exhaustion DoS via an oversized payload. (audit F5)
const SUUNTO_RAW_BODY_LIMIT = 64 * 1024; // 64 KB
app.use((req, res, next) => {
  if (req.path === '/api/integrations/suunto/webhook') {
    let data = '';
    let aborted = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (aborted) return;
      data += chunk;
      if (data.length > SUUNTO_RAW_BODY_LIMIT) {
        aborted = true;
        res.status(413).json({ error: 'Payload too large' });
        req.destroy();
      }
    });
    req.on('end', () => { if (!aborted) { req.rawBody = data; next(); } });
  } else {
    next();
  }
});
// The health-store batch endpoint (JWT-authenticated) carries up to 2000 biometric
// samples per chunk (~hundreds of KB) for the medical-profile backfill, so it needs a
// larger body than the global 10kb cap. Scoped to this one route and parsed BEFORE the
// global parser, so the global json() sees req._body already set and skips it.
app.use('/api/integrations/health/batch', express.json({ limit: '1mb' }));
// Garmin Health API push/backfill payloads (server-to-server) can be large; larger
// limit, scoped to the webhook only, parsed before the global 10kb cap.
app.use('/api/integrations/garmin/webhook', express.json({ limit: '5mb' }));
app.use(express.json({ limit: '10kb' }));

app.use('/api/', apiLimiter);
// The Origin-based CSRF guard (audit F6) is GONE, and deleted rather than inverted to deny-all.
//
// CSRF requires an AMBIENT credential — one a browser attaches by itself. BE-009 retired the
// cookie plane, so there is none: `middleware/auth.js` reads `Authorization: Bearer` only, which
// no cross-site page can cause a victim's browser to send. A guard against forged requests that
// cannot carry a credential defends nothing.
//
// Inverting it to deny-all-origins was the alternative and was rejected on evidence: React Native
// sends no `Origin` header (verified across the pinned RN 0.86.0 source — whatwg-fetch,
// Libraries/Network, the Android networking module, iOS RCTHTTPRequestHandler: zero occurrences),
// so the guard's fail-open at `if (!origin) return next()` is the ONLY reason the mobile app gets
// through today. A deny-all inversion would therefore have been either inert or app-breaking,
// depending on a header nobody could observe — the worst kind of security control.
// If cookie auth ever returns, this comes back WITH it, not before.

app.use('/api/auth',         authRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/sessions',     sessionsRouter);
app.use('/api/pulse',        pulseRouter);
app.use('/api/discovery',    discoveryRouter);
app.use('/api/consent',      consentRouter);
app.use('/api/webhooks',     require('./routes/webhooks'));

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// Standing Spotify-ToS leak monitor (ADR 0011): non-destructive count of any spotify:-keyed
// rows still in the global caches. Must read zero post-containment/purge; returns 503 (so an
// uptime check alerts) when a leak is present. Kept OFF the hot /health path, and short-TTL
// cached so repeated (unauthenticated) polls can't force repeated full collection scans.
app.get('/health/spotify-leak', async (req, res) => {
  try {
    const { checkSpotifyLeakCached, defaultCollections } = require('./services/monitoring/spotifyLeakMonitor');
    const result = await checkSpotifyLeakCached({ collections: defaultCollections() });
    res.status(result.ok ? 200 : 503).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Standing YouTube-ToS leak monitor: non-destructive count of any youtube:-keyed rows still in the
// global caches. Must read zero post-containment/purge; returns 503 (so an uptime check alerts)
// when a leak is present. Same short-TTL cached, off-hot-path shape as /health/spotify-leak.
app.get('/health/youtube-leak', async (req, res) => {
  try {
    const { checkYoutubeLeakCached, defaultCollections } = require('./services/monitoring/youtubeLeakMonitor');
    const result = await checkYoutubeLeakCached({ collections: defaultCollections() });
    res.status(result.ok ? 200 : 503).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  await connectRedis();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);
  // Historical Garmin data arrives via the Health API push webhook
  // (POST /api/integrations/garmin/webhook → garminIngest); real-time HR comes from
  // the sideloaded watch app. (The legacy 30s OAuth1 dailies poller was removed.)
  httpServer.listen(PORT, () =>
    console.log(`Kokonada backend on port ${PORT} [${process.env.NODE_ENV}] routes:ok`)
  );

  // FREE-TIER: with RUN_WORKERS_IN_PROCESS=true, drain the BullMQ queues in THIS
  // process instead of a separate (paid) worker service. No-op when the flag is off.
  const inProcessWorkers = startInProcessWorkers({ logger: console });

  // Periodically drain the unclassified-track pool (Groq-outage safety floor): a repeatable
  // job re-evaluates due rows and promotes music / hard-deletes non-music. Guarded to the
  // in-process worker path (there is a consumer) + REDIS_URL; scheduleRepeatable no-ops without it.
  if (inProcessWorkers.length) {
    const { scheduleRepeatable } = require('./queues/queue');
    const { QUEUES } = require('./queues/definitions');
    scheduleRepeatable(QUEUES.RECLASSIFY_UNCLASSIFIED, process.env.RECLASSIFY_CRON || '*/30 * * * *', {})
      .then((r) => console.log(`[reclassify] repeatable scheduled: ${JSON.stringify(r)}`))
      .catch((e) => console.error('[reclassify] schedule failed:', e.message));

    // Bounded retention: redact aged PlaylistSession sensitive fields daily (T3.1).
    scheduleRepeatable(QUEUES.SESSION_TRIM, process.env.SESSION_TRIM_CRON || '30 3 * * *', {})
      .then((r) => console.log(`[sessionTrim] repeatable scheduled: ${JSON.stringify(r)}`))
      .catch((e) => console.error('[sessionTrim] schedule failed:', e.message));

    // YouTube 30-day ToS retention: refresh connected / purge stale youtube_music data (T3.5).
    scheduleRepeatable(QUEUES.YOUTUBE_RETENTION, process.env.YOUTUBE_RETENTION_CRON || '0 4 * * *', {})
      .then((r) => console.log(`[youtubeRetention] repeatable scheduled: ${JSON.stringify(r)}`))
      .catch((e) => console.error('[youtubeRetention] schedule failed:', e.message));

    // Nightly per-user consolidation (W4-012, A6): baselines refresh, cosinor snapshot,
    // sleep-debt update, CUSUM change-point flags — persisted to MorningState.
    scheduleRepeatable(QUEUES.DAILY_ANALYSIS, process.env.DAILY_ANALYSIS_CRON || '0 5 * * *', {})
      .then((r) => console.log(`[dailyAnalysis] repeatable scheduled: ${JSON.stringify(r)}`))
      .catch((e) => console.error('[dailyAnalysis] schedule failed:', e.message));

    // Global seed ingestion — DARK by default (GLOBAL_SEED_INGEST_ENABLED). Grows the
    // provider-agnostic CC0 discovery corpus from AcousticBrainz records on a daily cron.
    if (process.env.GLOBAL_SEED_INGEST_ENABLED === 'true') {
      scheduleRepeatable(QUEUES.GLOBAL_SEED_INGEST, process.env.GLOBAL_SEED_CRON || '0 3 * * *', {})
        .then((r) => console.log(`[globalSeedIngest] repeatable scheduled: ${JSON.stringify(r)}`))
        .catch((e) => console.error('[globalSeedIngest] schedule failed:', e.message));
    }
  }

  // Graceful shutdown (Railway sends SIGTERM on redeploy): close the workers and the
  // HTTP server so in-flight jobs finish and the socket drains, with a hard cap so a
  // stuck close can't wedge the deploy.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} — closing ${inProcessWorkers.length} worker(s) + server`);
    const hardExit = setTimeout(() => process.exit(0), 10000);
    hardExit.unref();
    try { await Promise.all(inProcessWorkers.map((w) => w.close())); } catch { /* best-effort */ }
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// OPS-013 — the app is now EXPORTED and only auto-starts when this file is the entry point.
//
// Until this line, `require('./app/index')` connected the DB, connected Redis, opened a
// socket server and bound a port, so no test could ever assemble the real app. Every route
// test therefore mounted a router onto its own throwaway express instance — stated outright
// in tests/discovery.route.test.js. The consequence was not theoretical: real middleware
// ORDER, route-registration validity and the production boot assertions were covered by
// nothing, and five `router.post(path, undefined)` handlers could be wired in with the whole
// suite green, because `router.post()` throws at module load and nothing ever loaded it.
//
// `require.main === module` is true for `node app/index.js` (npm start, the Dockerfile) and
// false when a test requires it, so production behaviour is byte-identical.
module.exports = { app, start };

if (require.main === module) {
  start().catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
