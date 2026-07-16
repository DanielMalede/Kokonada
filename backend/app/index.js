// override:true makes the local .env authoritative over inherited shell vars
// (e.g. a global NODE_ENV=production leaking into dev, which would force
// secure:true cookies that browsers drop over http://localhost). In real
// deployments there is no .env file, so platform env vars still win.
require('dotenv').config({ override: true });
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initSentry } = require('./config/sentry');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { apiLimiter } = require('./middleware/rateLimiter');
const csrfOriginGuard = require('./middleware/csrf');
const errorHandler = require('./middleware/errorHandler');
const authRouter         = require('./routes/auth');
const integrationsRouter = require('./routes/integrations');
const sessionsRouter     = require('./routes/sessions');
const pulseRouter        = require('./routes/pulse');
const discoveryRouter    = require('./routes/discovery');
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
// and CORP — appropriate for this JSON-only API. The browser-facing CSP that
// matters for XSS is set on the frontend (frontend/vercel.json — audit F4).
app.use(helmet());

// CORS: fail closed. Single trusted origin, credentials on. In production an
// unset FRONTEND_URL is a misconfiguration we refuse to start with, rather than
// degrade to a permissive/credentialed policy. (audit F9)
const FRONTEND_URL = process.env.FRONTEND_URL;
if (!FRONTEND_URL && process.env.NODE_ENV === 'production') {
  throw new Error('FRONTEND_URL must be set in production — refusing to start with unsafe CORS');
}

// A vetted LLM provider (Groq LLM_API_KEY) is mandatory in production — we refuse to
// start rather than silently degrade to an unvetted, training-eligible endpoint with
// special-category signals. (Wave-0 egress containment)
require('./config/llmProvider').assertVettedLlmProvider();
app.use(cors({
  origin: FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

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
app.use('/api/', csrfOriginGuard); // Origin-based CSRF defense (audit F6)

app.use('/api/auth',         authRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/sessions',     sessionsRouter);
app.use('/api/pulse',        pulseRouter);
app.use('/api/discovery',    discoveryRouter);
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

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
