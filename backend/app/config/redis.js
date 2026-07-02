const IORedis = require('ioredis');

let client;

async function connectRedis() {
  client = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  client.on('error', () => {}); // suppress noisy reconnect logs in dev
  client.on('ready', () => console.log('Redis connected'));

  try {
    await client.connect();
  } catch {
    console.warn('Redis unavailable — LLM caching disabled, continuing without it');
    client = null;
  }
  return client;
}

function getRedis() {
  return client; // callers must handle null (cache miss) gracefully
}

// BullMQ needs dedicated connections with maxRetriesPerRequest: null (blocking
// commands) — the shared getRedis() client must never be reused for queues.
// Producers pass { enableOfflineQueue: false } to fail fast instead of buffering.
function createConnection(overrides = {}) {
  return new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
    ...overrides,
  });
}

module.exports = { connectRedis, getRedis, createConnection };