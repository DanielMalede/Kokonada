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
const { createSocketServer } = require('./sockets');
const { startGarminPoller } = require('./services/wearable/garminPoller');

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
app.use(express.json({ limit: '10kb' }));

app.use('/api/', apiLimiter);
app.use('/api/', csrfOriginGuard); // Origin-based CSRF defense (audit F6)

app.use('/api/auth',         authRouter);
app.use('/api/integrations', integrationsRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  await connectRedis();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);
  startGarminPoller(io);
  httpServer.listen(PORT, () =>
    console.log(`Kokonada backend on port ${PORT} [${process.env.NODE_ENV}] routes:ok`)
  );
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
