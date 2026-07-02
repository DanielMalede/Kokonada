'use strict';

const { Queue } = require('bullmq');
const { QUEUE_NAMES } = require('./definitions');
const { createConnection } = require('../config/redis');

// Queues activate only when REDIS_URL is explicitly set; without it every
// enqueue is a graceful no-op so dev/test environments run without Redis.
const queues = new Map();

function assertKnown(queueName) {
  if (!QUEUE_NAMES.has(queueName)) {
    throw new Error(`unknown queue "${queueName}"`);
  }
}

function getQueue(queueName) {
  let queue = queues.get(queueName);
  if (!queue) {
    // Producers fail fast: without an offline queue, add() rejects immediately when
    // Redis is down instead of buffering commands (and their pending promises)
    // unboundedly until reconnect. Workers keep the resilient default.
    queue = new Queue(queueName, { connection: createConnection({ enableOfflineQueue: false }) });
    queues.set(queueName, queue);
  }
  return queue;
}

async function enqueue(queueName, payload, opts = {}) {
  assertKnown(queueName);
  if (!process.env.REDIS_URL) return { queued: false, reason: 'redis-unavailable' };
  try {
    await getQueue(queueName).add(queueName, payload, opts);
    return { queued: true };
  } catch (e) {
    console.error(`[queue] enqueue ${queueName} failed:`, e.message);
    return { queued: false, reason: 'redis-error' };
  }
}

async function scheduleRepeatable(queueName, cronExpr, payload) {
  assertKnown(queueName);
  if (!process.env.REDIS_URL) return { scheduled: false, reason: 'redis-unavailable' };
  try {
    await getQueue(queueName).add(queueName, payload, { repeat: { pattern: cronExpr } });
    return { scheduled: true };
  } catch (e) {
    console.error(`[queue] scheduleRepeatable ${queueName} failed:`, e.message);
    return { scheduled: false, reason: 'redis-error' };
  }
}

module.exports = { enqueue, scheduleRepeatable };
