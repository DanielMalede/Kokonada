const IORedis = require('ioredis');

let client;

async function connectRedis() {
  client = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  client.on('error', err => console.error('Redis error:', err.message));
  client.on('reconnecting', () => console.warn('Redis reconnecting...'));
  client.on('ready', () => console.log('Redis connected'));

  await client.connect();
  return client;
}

function getRedis() {
  if (!client) throw new Error('Redis client not initialized');
  return client;
}

module.exports = { connectRedis, getRedis };