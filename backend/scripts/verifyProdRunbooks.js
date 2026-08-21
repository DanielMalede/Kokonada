'use strict';

// Read-only production runbook verifier. STRICTLY READ-ONLY — it never creates,
// drops, or writes anything. Run with `node scripts/verifyProdRunbooks.js`.
// Prints a PASS/FAIL/SKIP checklist and exits non-zero if ANY check FAILs.
//
//   Runbook 1: Atlas Vector Search index `track_embedding_index` exists on
//              `trackembeddings`, path `vector`, numDimensions 70, cosine.
//   Runbook 4: the v2 vector index `track_embedding_index_v2` on `trackembeddings`,
//              path `vectorV2`, numDimensions 135, cosine - SKIPPED while v2 is dark.
//   Runbook 2: the legacy compound index on `playlistsessions` is DROPPED.
//   Runbook 3: Redis is reachable (PING) so the three queues can be consumed.

const { QUEUES } = require('../app/queues/definitions');
// Bind the expected dimension to the REAL embedding contract rather than a magic
// number — if buildVector's DIM ever changes, this verifier follows it and the
// dedicated test fails loudly instead of silently checking the wrong value.
const { DIM, DIM_V2 } = require('../app/services/vector/embedding');
const embeddingSpace = require('../app/services/vector/embeddingSpace');

const EXPECTED_DIM = DIM; // 6 feature dims + 64-dim genre bag = 70
const EXPECTED_DIM_V2 = DIM_V2; // 7-dim audio block + 128-dim IDF genre block = 135 (W4-014)
const DEFAULT_VECTOR_INDEX = 'track_embedding_index';
const DEFAULT_VECTOR_INDEX_V2 = 'track_embedding_index_v2';
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
function checkVectorIndex(searchIndexes, { indexName = DEFAULT_VECTOR_INDEX, expectedDim = EXPECTED_DIM, expectedPath = 'vector' } = {}) {
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
  if (vectorField.path !== expectedPath) {
    problems.push(`path is "${vectorField.path}" (expected "${expectedPath}")`);
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
    message: `index "${indexName}" is a vector index on path "${expectedPath}" with ${expectedDim} dims (cosine)`,
  };
}

// Runbook 4 (W4-014) - the v2 vector index. Deliberately NOT the same check as Runbook 1,
// because a MISSING v2 index means something completely different from a missing v1 one.
//
//   v2 is dark by default: EMBEDDING_V2_READ is off, nothing serves from that index, and it does
//   not exist until Daniel performs the H13 portal action. Reporting FAIL for a deliberately
//   absent index would teach the operator that this verifier is red in normal operation - which
//   is how a genuinely red check gets ignored. So: absent + read OFF is SKIPPED (with the
//   instruction), absent + read ON is a FAIL, because then discovery is querying an index that
//   is not there and the adapter's catch is silently returning nothing.
//
//   An index that EXISTS but is wrong is ALWAYS a FAIL, flag or no flag: that is not an absence,
//   it is a mistake, and it is cheapest to catch before the cutover rather than after.
function checkVectorIndexV2(searchIndexes, { indexName = embeddingSpace.indexNameFor('v2'), expectedDim = EXPECTED_DIM_V2 } = {}) {
  const readingV2 = embeddingSpace.readVersion() === 'v2';
  if (searchIndexes == null) {
    return { status: 'SKIPPED', message: `listSearchIndexes unsupported here (non-Atlas / older Mongo) - cannot verify "${indexName}"` };
  }
  const present = searchIndexes.some((i) => i && i.name === indexName);
  if (!present && !readingV2) {
    return {
      status: 'SKIPPED',
      message: `v2 index "${indexName}" is absent and EMBEDDING_V2_READ is OFF - embedding v2 is shipped dark, so this is expected. Create it (H13) before turning the read on.`,
    };
  }
  const r = checkVectorIndex(searchIndexes, { indexName, expectedDim, expectedPath: embeddingSpace.V2.path });
  if (r.status === 'FAIL' && !present) {
    return { ...r, message: `${r.message} - EMBEDDING_V2_READ is ON, so discovery is querying an index that does not exist and is silently returning nothing.` };
  }
  return r;
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

async function runVectorIndexV2Check(db) {
  const indexName = embeddingSpace.indexNameFor('v2');
  let searchIndexes = null;
  try {
    searchIndexes = await db.collection(EMBEDDINGS_COLLECTION).listSearchIndexes().toArray();
  } catch (err) {
    searchIndexes = null;
  }
  const r = checkVectorIndexV2(searchIndexes, { indexName });
  return { name: `Runbook 4 - Atlas v2 vector index "${indexName}" on ${EMBEDDINGS_COLLECTION}`, ...r };
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
  for (const runner of [() => runVectorIndexCheck(db), () => runVectorIndexV2Check(db), () => runLegacyIndexCheck(db)]) {
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
  checkVectorIndexV2,
  checkLegacyIndexAbsent,
  checkRedis,
  runVectorIndexCheck,
  runVectorIndexV2Check,
  runLegacyIndexCheck,
  runRedisCheck,
  EXPECTED_DIM,
  EXPECTED_DIM_V2,
  DEFAULT_VECTOR_INDEX,
  DEFAULT_VECTOR_INDEX_V2,
  LEGACY_PLAYLIST_INDEX,
  EMBEDDINGS_COLLECTION,
  PLAYLIST_COLLECTION,
};
