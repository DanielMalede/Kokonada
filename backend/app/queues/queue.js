'use strict';

const { Queue } = require('bullmq');
const { QUEUE_NAMES } = require('./definitions');
const { createConnection } = require('../config/redis');

// Queues activate only when REDIS_URL is explicitly set; without it every
// enqueue is a graceful no-op so dev/test environments run without Redis.
// name -> { queue, connection }
const queues = new Map();

// J1 (BE-074): every job is deleted once it has run, whether it succeeded or failed. Nothing in the
// app reads a finished job, and a kept one is a copy of its payload in an unencrypted Redis blob
// (state-vector jobs name the user; reward jobs carry health-derived values). A producer may still
// pass its own options; the worker side covers a job queued without any (workers/index.js).
const DEFAULT_JOB_OPTIONS = Object.freeze({ removeOnComplete: true, removeOnFail: true });

function assertKnown(queueName) {
  if (!QUEUE_NAMES.has(queueName)) {
    throw new Error(`unknown queue "${queueName}"`);
  }
}

function getQueue(queueName) {
  let entry = queues.get(queueName);
  if (!entry) {
    // Producers fail fast: without an offline queue, add() rejects immediately when
    // Redis is down instead of buffering commands (and their pending promises)
    // unboundedly until reconnect. Workers keep the resilient default.
    const connection = createConnection({ enableOfflineQueue: false });
    entry = { queue: new Queue(queueName, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }), connection };
    queues.set(queueName, entry);
  }
  return entry.queue;
}

// Closes every producer queue this process opened, AND its connection: BullMQ treats a connection
// it is handed as shared and never closes it, so closing the queue alone leaves the socket open.
// For a script's exit and a test's teardown; a later enqueue opens a fresh queue.
async function closeQueues() {
  const open = [...queues.values()];
  queues.clear();
  await Promise.all(open.map(async ({ queue, connection }) => {
    try {
      await queue.close();
    } catch {
      /* the connection is closed below either way */
    }
    connection.disconnect();
  }));
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

module.exports = { enqueue, scheduleRepeatable, closeQueues };
