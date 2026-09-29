'use strict';

process.env.NODE_ENV = 'test';

// HX-2 M2 — the ServeEvent TTL, read back from a REAL server with getIndexes, and the reason the
// production change is a manual collMod rather than a deploy.
//
// Mongoose builds indexes on boot, but it will not CHANGE an existing index's options: asking for
// servedAt_1 with a new expireAfterSeconds against a collection that already holds servedAt_1 is
// an IndexOptionsConflict, and the old 90-day window silently stays. So "the model says 30 days"
// proves nothing about production. These tests pin both halves: a fresh collection gets 2592000,
// an existing one keeps 7776000 until the collMod the PR body lists, and the read-only verifier
// tells the two apart.

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const ServeEvent = require('../app/models/ServeEvent');
const { checkTtlIndex, runTtlIndexCheck, TTL_INDEX_RUNBOOKS } = require('../scripts/verifyProdRunbooks');

jest.setTimeout(120000);

let mem;
let db;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  // autoIndex off: each test decides when (and against what) the model's indexes are built.
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_retention_indexes_it', autoIndex: false });
  db = mongoose.connection.db;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
});

const servedAtTtl = async () => (await db.collection('serveevents').indexes())
  .find((ix) => ix.key && ix.key.servedAt === 1 && Object.keys(ix.key).length === 1);

describe('ServeEvent TTL on a real server (getIndexes)', () => {
  it('a fresh collection gets servedAt_1 with expireAfterSeconds 2592000 (30 days)', async () => {
    await ServeEvent.createIndexes();

    const ix = await servedAtTtl();
    expect(ix).toBeDefined();
    expect(ix.expireAfterSeconds).toBe(2592000);
  });

  it('an EXISTING 90-day index is not changed by the deploy — Mongoose cannot alter index options', async () => {
    await db.collection('serveevents').createIndex({ servedAt: 1 }, { expireAfterSeconds: 7776000 });

    // What a production boot does. It must not be mistaken for the change.
    await ServeEvent.createIndexes().catch(() => { /* IndexOptionsConflict — the point of this test */ });

    expect((await servedAtTtl()).expireAfterSeconds).toBe(7776000);
  });

  it('the runbook collMod moves an existing index to 2592000, and the verifier reads the difference', async () => {
    await db.collection('serveevents').createIndex({ servedAt: 1 }, { expireAfterSeconds: 7776000 });
    const spec = TTL_INDEX_RUNBOOKS.find((r) => r.collection === 'serveevents');

    const before = await runTtlIndexCheck(db, spec);
    expect(before.status).toBe('FAIL');
    expect(before.message).toContain('7776000');
    expect(before.message).toContain('collMod');

    await db.command({ collMod: 'serveevents', index: { keyPattern: { servedAt: 1 }, expireAfterSeconds: 2592000 } });

    const after = await runTtlIndexCheck(db, spec);
    expect(after.status).toBe('PASS');
    expect((await servedAtTtl()).expireAfterSeconds).toBe(2592000);
  });
});

describe('checkTtlIndex — pure verdicts', () => {
  const spec = { collection: 'serveevents', field: 'servedAt', expectedSeconds: 2592000 };

  it('PASS when the single-field TTL index carries exactly the expected seconds', () => {
    expect(checkTtlIndex([{ name: 'servedAt_1', key: { servedAt: 1 }, expireAfterSeconds: 2592000 }], spec).status).toBe('PASS');
  });

  it('FAIL (never PASS) when the index is missing, and says how to create it', () => {
    const r = checkTtlIndex([{ name: '_id_', key: { _id: 1 } }], spec);
    expect(r.status).toBe('FAIL');
    expect(r.message).toMatch(/missing/i);
  });

  it('FAIL when the index exists without a TTL', () => {
    expect(checkTtlIndex([{ name: 'servedAt_1', key: { servedAt: 1 } }], spec).status).toBe('FAIL');
  });

  it('a compound index on the same field is not mistaken for the TTL index', () => {
    const r = checkTtlIndex([{ name: 'userId_1_servedAt_-1', key: { userId: 1, servedAt: -1 } }], spec);
    expect(r.status).toBe('FAIL');
  });

  it('the ServeEvent runbook expects the value the model declares', () => {
    const spec2 = TTL_INDEX_RUNBOOKS.find((r) => r.collection === 'serveevents');
    const [, opts] = ServeEvent.schema.indexes().find(([keys, o]) => keys.servedAt === 1 && o.expireAfterSeconds != null);
    expect(spec2.field).toBe('servedAt');
    expect(spec2.expectedSeconds).toBe(opts.expireAfterSeconds);
  });
});
