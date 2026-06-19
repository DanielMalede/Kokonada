require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initSentry } = require('./config/sentry');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { apiLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const authRouter         = require('./routes/auth');
const integrationsRouter = require('./routes/integrations');

const app = express();

// Sentry must be initialized before routes
initSentry(app);

// Security headers
app.use(helmet());

// CORS — allow mobile WebView and web origins, with credentials for HTTP-only cookies
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: '10kb' })); // cap payload size — prevents large-body DoS

// Global rate limit on all /api routes
app.use('/api/', apiLimiter);

// Routes
app.use('/api/auth',         authRouter);
app.use('/api/integrations', integrationsRouter);

// Health probe for Docker / load balancer
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// Must be last — catches all unhandled errors
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  await connectRedis();
  app.listen(PORT, () => console.log(`Kokonada backend on port ${PORT} [${process.env.NODE_ENV}]`));
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
