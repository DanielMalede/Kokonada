require('dotenv').config();
const http = require('http');
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
const { createSocketServer } = require('./sockets');

const app = express();

initSentry(app);

app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));

app.use(cookieParser());

app.use((req, res, next) => {
  if (req.path === '/api/integrations/suunto/webhook') {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { req.rawBody = data; next(); });
  } else {
    next();
  }
});
app.use(express.json({ limit: '10kb' }));

app.use('/api/', apiLimiter);

app.use('/api/auth',         authRouter);
app.use('/api/integrations', integrationsRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  await connectRedis();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);
  httpServer.listen(PORT, () =>
    console.log(`Kokonada backend on port ${PORT} [${process.env.NODE_ENV}]`)
  );
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
