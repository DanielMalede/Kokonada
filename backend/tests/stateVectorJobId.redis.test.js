'use strict';

// J2 (BE-084; Plan B T2) — a burst of health-data syncs queues ONE state-recompute job, named by its keyed
// pseudonym, and the queue's event log never holds the user id. On a REAL Redis (the lane in
// tests/helpers/realRedis.js) and a REAL MongoDB (mongodb-memory-server).
//
// Why real: coalescing is BullMQ's duplicate check on the custom id, inside its add script, and the event
// log entries (`added`, `delayed`, `duplicated`) are written by the same scripts (addDelayedJob-6.lua,
// handleDuplicatedJob.lua). A fake would show neither.
//
// Real: the ingest path (`wearable/metricStore.persistMetrics`), the producer seam, BullMQ, Redis, MongoDB.
// No worker runs, so the job stays delayed: what the log holds before the job has run.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { QUEUES } = require('../app/queues/definitions');
const { closeQueues } = require('../app/queues/queue');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const { stateVectorJobId } = require('../app/queues/stateVectorJob');

jest.setTimeout(120000);

const S = `bull:${QUEUES.STATE_VECTOR_RECOMPUTE}:`;
const field = (fields, name) => fields[fields.indexOf(name) + 1];

describeRealRedis('J2 T2: a sync burst queues one job under a pseudonymous id', (url) => {
  let mem;
  let redis;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri(), { dbName: 'kokonada_j2_job_id' });
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url;
  });
  afterAll(async () => {
    await closeQueues();
    redis?.disconnect();
    delete process.env.REDIS_URL;
    await mongoose.disconnect();
    await mem?.stop();
  });
  beforeEach(() => flushTestDb(redis));

  it('five persistMetrics calls give one delayed job; no added, delayed or duplicated entry holds 24 hex', async () => {
    const userId = new mongoose.Types.ObjectId();
    for (let i = 0; i < 5; i += 1) {
      await persistMetrics(userId, [{
        metric: 'restingHeartRate', value: 58 + i, unit: 'bpm', recordedAt: new Date(Date.UTC(2026, 8, 20 + i, 6)), source: 'health_connect',
      }]);
    }

    expect(await redis.zrange(`${S}delayed`, 0, -1)).toEqual([stateVectorJobId(userId)]);
    expect(JSON.parse(await redis.hget(`${S}${stateVectorJobId(userId)}`, 'data'))).toEqual({ userId: String(userId) });

    const entries = await redis.xrange(`${S}events`, '-', '+');
    const byType = entries.reduce((acc, [, f]) => ({ ...acc, [field(f, 'event')]: (acc[field(f, 'event')] || 0) + 1 }), {});
    expect(byType).toEqual({ added: 1, delayed: 1, duplicated: 4 });
    expect(JSON.stringify(entries)).not.toMatch(/[0-9a-fA-F]{24}/);
    expect(JSON.stringify(entries)).not.toContain(String(userId));
  });
});
