'use strict';

// Read-only production runbook verifier. STRICTLY READ-ONLY — it never creates,
// drops, or writes anything. Run with `node scripts/verifyProdRunbooks.js`.
// Prints a PASS/FAIL/SKIP checklist and exits non-zero if ANY check FAILs.
//
//   Runbook 1: Atlas Vector Search index `track_embedding_index` exists on
//              `trackembeddings`, path `vector`, numDimensions 70, cosine.
//   Runbook 2: the legacy compound index on `playlistsessions` is DROPPED.
//   Runbook 3: Redis is reachable (PING) so the three queues can be consumed.

const { QUEUES } = require('../app/queues/definitions');
// Bind the expected dimension to the REAL embedding contract rather than a magic
// number — if buildVector's DIM ever changes, this verifier follows it and the
// dedicated test fails loudly instead of silently checking the wrong value.
const { DIM } = require('../app/services/vector/embedding');

const EXPECTED_DIM = DIM; // 6 feature dims + 64-dim genre bag = 70
const DEFAULT_VECTOR_INDEX = 'track_embedding_index';
const LEGACY_PLAYLIST_INDEX = 'userId_1_moodKey_1_createdAt_-1';
const EMBEDDINGS_COLLECTION = 'trackembeddings';
const PLAYLIST_COLLECTION = 'playlistsessions';

// ── Pure check functions (unit-tested) ────────────────────────────────────────

// searchIndexes: the array from collection.listSearchIndexes().toArray(), OR
// `null` when listSearchIndexes is UNSUPPORTED (non-Atlas / older Mongo).
//   null           → SKIPPED (cannot verify — never a false PASS)
//   [] or no match  → FAIL (index genuinely missing; distinct from empty docs)
//   present+valid   → PASS (holds even for an empty collection — we inspect index
//                     metadata, not documents, so there is no [] false-green)
function checkVectorIndex(searchIndexes, { indexName = DEFAULT_VECTOR_INDEX, expectedDim = EXPECTED_DIM } = {}) {
  if (searchIndexes == null) {
    return {
      status: 'SKIPPED',
      message: `listSearchIndexes unsupported here (non-Atlas / older Mongo) — cannot verify "${indexName}"`,
    };
  }
  const idx = searchIndexes.find((i) => i && i.name === indexName);
  if (!idx) {
    return {
      status: 'FAIL',
      message: `search index "${indexName}" is MISSING (listSearchIndexes returned ${searchIndexes.length} index(es), none named "${indexName}")`,
    };
  }
  const def = idx.latestDefinition || idx.definition || {};
  const fields = Array.isArray(def.fields) ? def.fields : [];
  const vectorField = fields.find((f) => f && f.type === 'vector');
  if (!vectorField) {
    return { status: 'FAIL', message: `index "${indexName}" exists but declares no vector-type field` };
  }
  const problems = [];
  if (vectorField.path !== 'vector') {
    problems.push(`path is "${vectorField.path}" (expected "vector")`);
  }
  if (Number(vectorField.numDimensions) !== Number(expectedDim)) {
    problems.push(`numDimensions is ${vectorField.numDimensions} (expected ${expectedDim})`);
  }
  if (String(vectorField.similarity).toLowerCase() !== 'cosine') {
    problems.push(`similarity is "${vectorField.similarity}" (expected "cosine")`);
  }
  if (problems.length) {
    return { status: 'FAIL', message: `index "${indexName}" definition invalid: ${problems.join('; ')}` };
  }
  return {
    status: 'PASS',
    message: `index "${indexName}" is a vector index on path "vector" with ${expectedDim} dims (cosine)`,
  };
}

// indexes: the array from collection.indexes(). The legacy compound index must be
// ABSENT (its per-mood blacklist reads moved to the ServeLedger).
function checkLegacyIndexAbsent(indexes = [], { legacyName = LEGACY_PLAYLIST_INDEX } = {}) {
  const present = (indexes || []).some((ix) => ix && ix.name === legacyName);
  return present
    ? {
        status: 'FAIL',
        message: `legacy index "${legacyName}" is STILL PRESENT on ${PLAYLIST_COLLECTION} — drop it: db.${PLAYLIST_COLLECTION}.dropIndex('${legacyName}')`,
      }
    : { status: 'PASS', message: `legacy index "${legacyName}" is absent` };
}

// client: the ioredis client from connectRedis() (may be null when unreachable).
async function checkRedis(client, { queues = Object.values(QUEUES) } = {}) {
  if (!client) {
    return { status: 'FAIL', message: 'Redis client is null/unreachable — queues will never be consumed', queues };
  }
  try {
    const pong = await client.ping();
    if (String(pong).toUpperCase() !== 'PONG') {
      return { status: 'FAIL', message: `Redis PING returned "${pong}" (expected PONG)`, queues };
    }
    return {
      status: 'PASS',
      message: `Redis reachable (PING ok) — will consume: ${queues.join(', ')}`,
      queues,
    };
  } catch (err) {
    return { status: 'FAIL', message: `Redis PING failed: ${err.message}`, queues };
  }
}

// ── Runners (thin I/O wrappers around the pure checks) ─────────────────────────

async function runVectorIndexCheck(db) {
  const indexName = process.env.ATLAS_VECTOR_INDEX || DEFAULT_VECTOR_INDEX;
  let searchIndexes = null;
  try {
    // CRITICAL: listSearchIndexes distinguishes "index missing" from "collection
    // empty" — never use a queryNear that returns [] in both cases.
    searchIndexes = await db.collection(EMBEDDINGS_COLLECTION).listSearchIndexes().toArray();
  } catch (err) {
    // Command unsupported off-Atlas (or older Mongo) → report SKIPPED, not PASS.
    searchIndexes = null;
  }
  const r = checkVectorIndex(searchIndexes, { indexName, expectedDim: EXPECTED_DIM });
  return { name: `Runbook 1 — Atlas vector index "${indexName}" on ${EMBEDDINGS_COLLECTION}`, ...r };
}

async function runLegacyIndexCheck(db) {
  const indexes = await db.collection(PLAYLIST_COLLECTION).indexes();
  const r = checkLegacyIndexAbsent(indexes);
  return { name: `Runbook 2 — legacy index dropped on ${PLAYLIST_COLLECTION}`, ...r };
}

async function runRedisCheck(client) {
  const r = await checkRedis(client, { queues: Object.values(QUEUES) });
  return { name: 'Runbook 3 — Redis reachable + queues consumable', ...r };
}

// ── Entrypoint ─────────────────────────────────────────────────────────────────

async function main() {
  require('dotenv').config({ override: true });
  const mongoose = require('mongoose');
  const connectDB = require('../app/config/db');
  const { connectRedis, getRedis } = require('../app/config/redis');

  const results = [];

  await connectDB();
  const db = mongoose.connection.db;

  // Each runbook is isolated so one failure still reports the others.
  for (const runner of [() => runVectorIndexCheck(db), () => runLegacyIndexCheck(db)]) {
    try {
      results.push(await runner());
    } catch (err) {
      results.push({ name: 'Runbook (error)', status: 'FAIL', message: err.message });
    }
  }

  let redisClient = null;
  try {
    redisClient = await connectRedis();
    results.push(await runRedisCheck(redisClient));
  } catch (err) {
    results.push({ name: 'Runbook 3 — Redis reachable + queues consumable', status: 'FAIL', message: err.message });
  }

  console.log('\n=== Production Runbook Verification (READ-ONLY) ===');
  let failed = false;
  for (const r of results) {
    const tag = r.status === 'PASS' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'SKIP';
    console.log(`[${tag}] ${r.name}: ${r.message}`);
    if (r.status === 'FAIL') failed = true;
  }
  console.log('==================================================\n');

  const activeRedis = getRedis();
  if (activeRedis) {
    try { activeRedis.disconnect(); } catch { /* best-effort */ }
  }
  await mongoose.disconnect().catch(() => {});

  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal verifier error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  checkVectorIndex,
  checkLegacyIndexAbsent,
  checkRedis,
  runVectorIndexCheck,
  runLegacyIndexCheck,
  runRedisCheck,
  EXPECTED_DIM,
  DEFAULT_VECTOR_INDEX,
  LEGACY_PLAYLIST_INDEX,
  EMBEDDINGS_COLLECTION,
  PLAYLIST_COLLECTION,
};
