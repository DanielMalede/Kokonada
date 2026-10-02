'use strict';

// J1 (BE-074, DT-8 T-b) — the real-Redis test lane.
//
// BullMQ keeps its rules in Lua scripts that run inside Redis. A fake cannot run them, so the trap J1
// exists to avoid — a Worker-level `removeOnComplete: true` that the finish script then reads as
// `keepJobs.count` — is invisible to every fake in this repo. These suites run against a real server.
//
// Every suite on this lane EMPTIES its database between tests, so the one thing this helper must make
// impossible is pointing it at a Redis that holds anything else. Opt in with
//   REDIS_TEST_URL=redis://127.0.0.1:<port>/15
// Unset, the lane's suites are skipped and say so. Set to any other host or database, they fail
// before they connect. The lane runs on a developer machine only; its output is pasted into the
// pull request.

const IORedis = require('ioredis');

const TEST_DB = 15;
const LOOPBACK_URL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_CLIENT_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function refuse(reason) {
  return new Error(`REDIS_TEST_URL refused: ${reason}. It must look like redis://127.0.0.1:<port>/${TEST_DB}.`);
}

/** The lane's URL, or null when it is not set. Throws for anything but a loopback host and database 15. */
function realRedisUrl(env = process.env) {
  const raw = env.REDIS_TEST_URL;
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw refuse('not a URL');
  }
  if (url.protocol !== 'redis:') throw refuse('only redis:// is accepted');
  if (!LOOPBACK_URL_HOSTS.has(url.hostname)) throw refuse('the host is not this machine');
  if (url.search || url.hash) throw refuse('a query or fragment could select another database');
  if (url.pathname !== `/${TEST_DB}`) throw refuse(`the database is not ${TEST_DB}`);
  return raw;
}

/** The same rule, read back from a live client before anything destructive is sent through it. */
function assertDisposable(client) {
  const { host, db } = client?.options ?? {};
  if (!LOOPBACK_CLIENT_HOSTS.has(host)) throw new Error('refusing a real-Redis test client that is not on this machine');
  if (Number(db) !== TEST_DB) throw new Error(`refusing a real-Redis test client that is not on database ${TEST_DB}`);
  return client;
}

/**
 * `describe` when the lane is configured, `describe.skip` (with the reason in the title) when it is
 * not. The body receives the URL. A bad REDIS_TEST_URL throws here, so the suite fails instead of
 * running against the wrong server.
 */
function describeRealRedis(title, body) {
  const url = realRedisUrl();
  if (!url) {
    // An evidence run (the output pasted into the PR) sets REQUIRE_REAL_REDIS=1, so a lane that would skip fails.
    if (process.env.REQUIRE_REAL_REDIS === '1') throw new Error('REQUIRE_REAL_REDIS=1 but REDIS_TEST_URL is not set');
    describe.skip(`${title} [real Redis: REDIS_TEST_URL is not set]`, () => body(null));
    return;
  }
  describe(`${title} [real Redis]`, () => body(url));
}

/** A plain client on the lane's database: no retries, so a stopped server fails the suite fast. */
async function openTestRedis(url = realRedisUrl()) {
  if (!url) throw new Error('REDIS_TEST_URL is not set');
  const client = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  await client.connect();
  return assertDisposable(client);
}

/** Empties the lane's database (and only if the client is still the lane's own). */
async function flushTestDb(client) {
  assertDisposable(client);
  await client.flushdb();
}

module.exports = {
  TEST_DB, realRedisUrl, assertDisposable, describeRealRedis, openTestRedis, flushTestDb,
};
