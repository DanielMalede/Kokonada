'use strict';

const { Queue } = require('bullmq');
const { QUEUES, QUEUE_NAMES } = require('./definitions');
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

// J2 (BE-084, DT-3 E1): how many entries a queue's event log (`bull:<queue>:events`) keeps, for a queue
// that must keep fewer than BullMQ's 10000. The state-recompute log names every job by its id and records
// when it was queued, run and finished, so it keeps only about its last 100: BullMQ trims whole stream
// nodes, so about 100 to 200 entries are held. BullMQ stores the bound in the queue's meta hash when a
// Queue is built, and every script that appends to the log reads it there. So getQueue below is the one
// place that may build a Queue that writes the meta; every other Queue passes `skipMetasUpdate: true`
// (tests/queueMetaWriters.structural.test.js), or it would put BullMQ's 10000 back.
const QUEUE_EVENTS_MAX_LEN = Object.freeze({ [QUEUES.STATE_VECTOR_RECOMPUTE]: 100 });

function queueOptions(queueName, connection) {
  const maxLen = QUEUE_EVENTS_MAX_LEN[queueName];
  return {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    ...(maxLen ? { streams: { events: { maxLen } } } : {}),
  };
}

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
    entry = { queue: new Queue(queueName, queueOptions(queueName, connection)), connection };
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

module.exports = { enqueue, scheduleRepeatable, closeQueues, QUEUE_EVENTS_MAX_LEN };
