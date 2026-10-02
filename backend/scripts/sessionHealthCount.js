'use strict';

// BE-016 (DEC-111, DEC-118 K1) — the owner-run count of what the session-health erasure still owes:
// the daily sweep's dry run (`healthErasures=`, services/privacy/sessionHealthSweep.js) and the record
// of the backlog. The owner runs it after the merge is deployed and BEFORE the sweep's first run (the
// counts are the record; after the sweep the live database no longer shows them). STRICTLY READ-ONLY:
// it never writes, deletes, creates an index or a collection, loads no Mongoose model (a model builds
// its indexes on connect) and sends Redis nothing but SCAN.
//
// OUTPUT IS COUNTS ONLY: never a value, a time or an id (the owner's ruling for HX-1's count, kept
// here). Accounts are numbered in a stable order; the only things said about each are whether the
// operator controls it, a closed consent status and whether an erasure is recorded as owed.
//
// Run from backend/, with the ids of the accounts YOU control (comma-separated) in the environment:
//   SESSION_HEALTH_OPERATOR_USER_IDS=<id>[,<id>...] railway run node scripts/sessionHealthCount.js
// Exit 0: counted (see the RESULT line). Exit 2: STOP — an account with a withdrawal is not the
// operator's, so nothing in S1–S3 is counted; keep the sweep off and take it to counsel. Exit 1: an
// error.
//
// The rule is the erasure's own (services/privacy/sessionHealthPolicy.js): the same windows and the
// same steps, so the count cannot drift from what the withdrawal and the sweep change.
//   S0  accounts with any `withdrawn` row for the health purpose, plus each operator account that has
//       none (listed so the operator can read their own account's "before"); STOP if any account
//       with a withdrawal is not the operator's.
//   S1  per account: status `withdrawn` (the latest row is a withdrawal), `re-granted`,
//       `no-grant-before-withdrawal` (never erased here: DAN-016) or `no-withdrawal` (an operator
//       account counted as if it withdrew now); and whether `User.healthErasurePendingAt` is set.
//   S2  per account and per erasure step, the rows the step would change, in the order the steps run
//       (a row a step already cleared is not counted again by a later step it covers):
//         playlistsessions  heart-sessions (a band in `moodKey`), heart-rates (any other session with
//                           a heart rate), trimmed-activities (an activity on a session past the 30-day
//                           trim that is not provably a chip), targets (tempo, energy, valence on a
//                           session made before the withdrawal);
//         serveevents       bio-keys (a band in the serve's `moodKey`), bands (a band or activity).
//   S3  per account, the user-scoped Redis keys (the registry the withdrawal's strict purge deletes)
//       and how many of them name a band. `redis=n/a` without REDIS_URL; `redis=unavailable` when it
//       cannot be read. The sweep deletes these only for an account with an owed record.
//   RESULT  non-zero when the sweep would still change something: an owed record, or any S2 count above
//       zero for a `withdrawn` or `re-granted` account. `no-withdrawal` accounts are left out of it.

const mongoose = require('mongoose');
const { assertDbName } = require('../app/config/db');
const { patternsFor } = require('../app/utils/userRedisPurge');
const { windowsFor, latestIsWithdrawn, erasureSteps } = require('../app/services/privacy/sessionHealthPolicy');
const { parseOperatorIds, UsageError, errorType } = require('./hx1SurvivorCount');

const OPERATOR_ENV = 'SESSION_HEALTH_OPERATOR_USER_IDS';
const PURPOSE = 'health_biometric_processing';

// The collections the models write to, keyed as the policy names its step models (pinned in the test).
const COLLECTIONS = Object.freeze({
  consent: 'consentrecords',
  users: 'users',
  PlaylistSession: 'playlistsessions',
  ServeEvent: 'serveevents',
});

// The S2 token for each policy step, in the order the steps run.
const STEP_TOKENS = Object.freeze({
  heartSessions: 'heart-sessions',
  heartRates: 'heart-rates',
  trimmedActivities: 'trimmed-activities',
  targets: 'targets',
  serveBioKeys: 'bio-keys',
  serveBands: 'bands',
});

// A key under ledger:/pool:/buffer: that names a heart-rate band (`…:bio:<band>:…`).
const BAND_NAMED = /:bio:[a-z]/;

const HEADER = 'session-health-count read-only counts-only';
const STOP = "STOP an account with a withdrawal is not the operator's: nothing in S1–S3 was counted and nothing was erased. Keep the daily sweep off (HEALTH_ERASURE_SWEEP_DISABLED=true) and take this result to counsel.";

const redisPatterns = (id) => patternsFor(id);

// A step's `set` covers another's when it writes every field the other writes, to the same value: a
// row the first step changed then no longer holds what the second step's filter looks for.
const covers = (a, b) => Object.entries(b.set).every(([k, v]) => k in a.set && JSON.stringify(a.set[k]) === JSON.stringify(v));

/** The steps with read-only filters that count each row where the sequential erasure would change it. */
function countingSteps(userId, windows) {
  const steps = erasureSteps(userId, windows);
  return steps.map((step, i) => {
    const earlier = steps.slice(0, i).filter((p) => p.model === step.model && covers(p, step));
    return { ...step, filter: earlier.length ? { $and: [step.filter, { $nor: earlier.map((p) => p.filter) }] } : step.filter };
  });
}

function statusOf(history, windows) {
  if (!history.some((r) => r.status === 'withdrawn')) return 'no-withdrawal';
  if (!windows) return 'no-grant-before-withdrawal';
  return latestIsWithdrawn(history) ? 'withdrawn' : 're-granted';
}

// Every user-scoped key of the account, by SCAN; a key SCAN returns twice is counted once.
async function countKeys(redis, hex) {
  const keys = new Set();
  for (const pattern of redisPatterns(hex)) {
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      for (const k of batch) keys.add(k);
    } while (cursor !== '0');
  }
  return { keys: keys.size, bandNamed: [...keys].filter((k) => BAND_NAMED.test(k)).length };
}

/**
 * S0–S3 against a connected database and, when given, a Redis client. Read-only. Returns the lines to
 * print and the exit code: 0 when counted, 2 on STOP.
 */
async function countSessionHealth(db, { operatorIds, now = new Date(), redis = null }) {
  const operators = new Set(operatorIds.map((id) => String(id).toLowerCase()));
  const col = (name) => db.collection(COLLECTIONS[name]);
  const lines = [HEADER];

  const withdrawn = new Set((await col('consent').distinct('userId', { purpose: PURPOSE, status: 'withdrawn' }))
    .map((id) => String(id).toLowerCase()));
  const probes = [...operators].filter((hex) => !withdrawn.has(hex));
  const accounts = [...withdrawn, ...probes].sort().map((hex) => ({ hex, id: new mongoose.Types.ObjectId(hex) }));

  lines.push(`S0 withdrawn-accounts=${withdrawn.size} listed-without-withdrawal=${probes.length}`);
  accounts.forEach((a, i) => lines.push(`S0 account-${i + 1} operator=${operators.has(a.hex) ? 'yes' : 'no'}`));
  if ([...withdrawn].some((hex) => !operators.has(hex))) {
    lines.push(STOP);
    return { lines, exitCode: 2 };
  }

  const s1 = [];
  const s2 = [];
  const s3 = [];
  let nonZero = false;

  for (const [i, { hex, id }] of accounts.entries()) {
    const n = i + 1;
    const history = await col('consent').find({ userId: id, purpose: PURPOSE }).toArray();
    let windows = windowsFor(history, now);
    const status = statusOf(history, windows);
    // An operator account that never withdrew is counted as if it withdrew now.
    if (status === 'no-withdrawal') windows = { heartRateBefore: now, targetsBefore: now };
    const user = await col('users').findOne({ _id: id }, { projection: { healthErasurePendingAt: 1 } });
    const owed = user?.healthErasurePendingAt != null;
    if (owed) nonZero = true;
    s1.push(`S1 account-${n} status=${status} owed-record=${owed ? 'yes' : 'no'}`);

    if (status === 'no-grant-before-withdrawal') {
      s2.push(`S2 account-${n} playlistsessions=n/a serveevents=n/a`);
      s3.push(`S3 account-${n} redis=n/a`);
      continue;
    }

    const counted = {};
    for (const step of countingSteps(id, windows)) {
      counted[step.name] = await col(step.model).countDocuments(step.filter);
    }
    if (status !== 'no-withdrawal' && Object.values(counted).some((c) => c > 0)) nonZero = true;
    const tokens = (model) => erasureSteps(id, windows).filter((s) => s.model === model)
      .map((s) => `${STEP_TOKENS[s.name]}=${counted[s.name]}`).join(' ');
    s2.push(`S2 account-${n} playlistsessions ${tokens('PlaylistSession')}`);
    s2.push(`S2 account-${n} serveevents ${tokens('ServeEvent')}`);

    if (!redis) {
      s3.push(`S3 account-${n} redis=n/a`);
      continue;
    }
    try {
      const { keys, bandNamed } = await countKeys(redis, hex);
      s3.push(`S3 account-${n} redis keys=${keys} band-named=${bandNamed}`);
    } catch {
      s3.push(`S3 account-${n} redis=unavailable`);
    }
  }

  lines.push(...s1, ...s2, ...s3, `RESULT ${nonZero ? 'non-zero' : 'all-zero'}`);
  return { lines, exitCode: 0 };
}

// A Redis that could not be reached: every SCAN fails, so each account reads `redis=unavailable`.
const UNREACHABLE = Object.freeze({ async scan() { throw new Error('unreachable'); } });

// The client is the script's own, silent one: the app's connectRedis prints to stdout, and nothing but
// closed lines may be printed. No retries and no offline queue, so an unreachable Redis fails fast.
async function openRedis(url) {
  if (!url) return { redis: null, close: async () => {} };
  const IORedis = require('ioredis');
  const client = new IORedis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 10000,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  try {
    await client.connect();
  } catch {
    // No retries, so a failed connect has already ended the client. Disconnecting it again would arm
    // ioredis's 2 s close timer on a socket that has already closed, and nothing would clear it.
    return { redis: UNREACHABLE, close: async () => {} };
  }
  return { redis: client, close: async () => { client.disconnect(); } };
}

async function main({ env = process.env, out = (line) => console.log(line) } = {}) {
  let operatorIds;
  try {
    operatorIds = parseOperatorIds(env[OPERATOR_ENV], OPERATOR_ENV);
  } catch (e) {
    out(`ERROR ${e instanceof UsageError ? e.message : errorType(e)}`);
    return 1;
  }
  if (!env.MONGO_URI) {
    out('ERROR MONGO_URI is not set: run it through railway run');
    return 1;
  }

  let conn;
  try {
    conn = await mongoose.createConnection(env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      autoIndex: false,
      autoCreate: false,
      readPreference: 'primary',
    }).asPromise();
  } catch (e) {
    out(`ERROR could not connect (${errorType(e)})`);
    return 1;
  }
  const { redis, close } = await openRedis(env.REDIS_URL);
  try {
    try {
      assertDbName(conn.name);
    } catch {
      out('ERROR the connected database is not the expected one (MONGO_DB_NAME check)');
      return 1;
    }
    const { lines, exitCode } = await countSessionHealth(conn.db, { operatorIds, now: new Date(), redis });
    lines.forEach((line) => out(line));
    return exitCode;
  } catch (e) {
    out(`ERROR the count failed (${errorType(e)})`);
    return 1;
  } finally {
    await close().catch(() => {});
    await conn.close().catch(() => {});
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => {
    console.log(`ERROR ${errorType(e)}`);
    process.exit(1);
  });
}

module.exports = {
  OPERATOR_ENV, COLLECTIONS, STEP_TOKENS,
  redisPatterns, countingSteps, countSessionHealth, main,
};
