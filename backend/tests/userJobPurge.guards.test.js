'use strict';

// J1 (BE-074) — the structural guards around the job-queue purge. Pure source parsing: no Redis.
//
//   • every job a producer queues with a user id in its payload is on a queue the purge erases
//     (USER_JOB_QUEUES), or is listed below with the reason it is not;
//   • BullMQ is reached only through app/queues/ and the worker registry, so a job queue cannot
//     appear somewhere the registry does not see;
//   • ADR-0015: disconnecting a provider never erases learning, so no disconnect-side module calls
//     the purge. Only account deletion and a health-consent withdrawal do.

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../app');
const QUEUE_SRC = path.join(APP, 'queues/queue.js');
const { QUEUES } = require('../app/queues/definitions');
const { USER_JOB_QUEUES } = require('../app/queues/userJobPurge');

const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(APP, file).split(path.sep).join('/');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// Comments mention `enqueue()` in prose; only code counts. (A `//` after a colon is a URL, not a comment.)
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every `enqueue(…)` call in app/ (queue.js itself aside), under its own name or an alias, with its whole argument text. */
function enqueueCalls() {
  const calls = [];
  for (const file of sourceFiles(APP)) {
    if (file === QUEUE_SRC) continue;
    const src = stripComments(read(file));
    // The house's injectable default (`enqueueFn = enqueue`, app/scripts/reembedCorpus.js) and a destructuring
    // rename (`{ enqueue: add }`) call the same function under another name.
    const names = new Set(['enqueue']);
    for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*enqueue\b/g)) names.add(m[1]);
    for (const m of src.matchAll(/\benqueue\s*:\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    const call = new RegExp(`(?<![\\w$.])(?:${[...names].map((n) => n.replace(/\$/g, '\\$')).join('|')})\\(`, 'g');
    for (const match of src.matchAll(call)) {
      const open = match.index + match[0].length;
      let depth = 1;
      let i = open;
      while (depth > 0 && i < src.length) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') depth -= 1;
        i += 1;
      }
      const args = src.slice(open, i - 1);
      const queueArg = args.split(',')[0].trim();
      calls.push({ file: rel(file), queueArg, args });
    }
  }
  return calls;
}

// Queues whose jobs carry a user id but are NOT erased by the purge, each with its reason.
const NOT_PURGED = Object.freeze({});

describe('every job that carries a user id is on a queue the purge erases', () => {
  const calls = enqueueCalls();

  it('finds the producers (the guard is not vacuous)', () => {
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls.map((c) => c.queueArg)).toEqual(expect.arrayContaining(['QUEUES.REWARD_INGEST', 'QUEUES.STATE_VECTOR_RECOMPUTE']));
  });

  it('names its queue by a QUEUES constant, so the queue can be checked', () => {
    for (const call of calls) expect({ file: call.file, queue: call.queueArg }).toEqual({ file: call.file, queue: expect.stringMatching(/^QUEUES\.[A-Z_]+$/) });
  });

  it('is registered in USER_JOB_QUEUES, or listed with its reason', () => {
    const purged = new Set(USER_JOB_QUEUES.map((q) => q.name));
    const unregistered = calls
      .filter((c) => /\buserId\b/.test(c.args))
      .map((c) => ({ file: c.file, queue: QUEUES[c.queueArg.replace('QUEUES.', '')] }))
      .filter((c) => !purged.has(c.queue) && !NOT_PURGED[c.queue]);
    expect(unregistered).toEqual([]);
  });

  // J2 (P2): an exemption must name a queue the purge does NOT erase; one left behind after its queue was
  // registered would hide the next unregistered producer on that name.
  it('no exemption names a queue the purge erases', () => {
    const purged = new Set(USER_JOB_QUEUES.map((q) => q.name));
    expect(Object.keys(NOT_PURGED).filter((name) => purged.has(name))).toEqual([]);
  });

  it('the learning jobs are among the queued jobs that carry a user id', () => {
    const withUser = new Set(calls.filter((c) => /\buserId\b/.test(c.args)).map((c) => c.queueArg));
    expect(withUser.has('QUEUES.REWARD_INGEST')).toBe(true);
  });

  // A new producer file fails here until someone has checked whether its payload names a user.
  it('every module that imports the producer seam is a reviewed producer', () => {
    const importers = sourceFiles(APP)
      .filter((f) => /require\(\s*['"](?:\.{1,2}\/)+queues\/queue['"]\s*\)/.test(stripComments(read(f))))
      .map(rel)
      .sort();
    expect(importers).toEqual([
      'index.js',
      'scripts/backfillEmbeddingV2.js',
      'scripts/reembedCorpus.js',
      'services/biosonic/baselines.js',
      'services/discovery/corpusIngest.js',
      'services/features/featureService.js',
      'services/learning/rewardDispatch.js',
      'services/wearable/healthSampleReconciliation.js',
      'services/wearable/metricStore.js',
      'worker.js',
    ]);
  });
});

describe('the health-sample repair job is global rather than user-owned', () => {
  it('uses an empty repeatable payload and is not part of the per-user purge', () => {
    const index = stripComments(read(path.join(APP, 'index.js')));
    expect(index).toMatch(/scheduleRepeatable\(\s*QUEUES\.HEALTH_SAMPLE_RECONCILE,[\s\S]*?,\s*\{\}\s*,?\s*\)/);
    expect(USER_JOB_QUEUES.map((queue) => queue.name)).not.toContain(QUEUES.HEALTH_SAMPLE_RECONCILE);
  });
});

describe('BullMQ is reached only through app/queues/ and the worker registry', () => {
  it('no other module in app/ requires bullmq', () => {
    // An exact list, not a folder: a new file under queues/ could open its own Queue. A subpath, a template
    // literal or a dynamic import all name `bullmq`, so the word match catches them.
    const users = sourceFiles(APP)
      .filter((f) => /\bbullmq\b/.test(stripComments(read(f))))
      .map(rel)
      .sort();
    expect(users).toEqual(['queues/queue.js', 'queues/userJobPurge.js', 'workers/index.js']);
  });
});

// Account deletion has two doors that must stay in lockstep (erasure.js says so): the in-app delete and
// the operator script. Both remove the jobs FIRST, before any collection.
describe('account deletion: both paths purge the learning jobs first', () => {
  const ERASURE = read(path.join(APP, 'services/privacy/erasure.js'));
  const GDPR_DELETE = read(path.join(__dirname, '../scripts/gdpr-delete.js'));

  it('erasure.js calls the purge before the collection deletes', () => {
    const body = ERASURE.slice(ERASURE.indexOf('async function eraseUserChildData'));
    expect(body).toMatch(/purgeUserJobs\(userId\)/);
    expect(body.indexOf('purgeUserJobs(')).toBeLessThan(body.indexOf('.deleteMany('));
  });

  it('gdpr-delete.js counts them on a dry run, purges them before the collection deletes, audits the count and closes the queues', () => {
    expect(GDPR_DELETE).toMatch(/countUserJobs\(userId\)/);
    expect(GDPR_DELETE).toMatch(/purgeUserJobs\(userId\)/);
    const realRun = GDPR_DELETE.slice(GDPR_DELETE.indexOf('console.log(`GDPR deletion for userId'));
    expect(realRun.indexOf('purgeUserJobs(')).toBeGreaterThan(-1);
    expect(realRun.indexOf('purgeUserJobs(')).toBeLessThan(realRun.indexOf('.deleteMany('));
    expect(GDPR_DELETE).toMatch(/learningJobs/);
    expect(GDPR_DELETE).toMatch(/closeQueues\(\)/);
  });

  it('gdpr-delete.js reports a job queue it did not reach, never zero jobs, when REDIS_URL is not set', () => {
    expect(GDPR_DELETE.match(/if \(!process\.env\.REDIS_URL\)/g)).toHaveLength(2); // dry run and real run
    expect(GDPR_DELETE).toContain("learningJobs = 'not-reached';");
  });
});

// ADR-0015: a Spotify or wearable disconnect keeps the learned preferences (docs/privacy-declarations.md,
// Disconnect Spotify). Purging the learning jobs there would erase what they are about to write.
describe('ADR-0015: no disconnect-side module purges learning jobs', () => {
  const DISCONNECT_SIDE = [
    'services/privacy/spotifyErasure.js',
    'services/privacy/wearableErasure.js',
    'services/privacy/sessionHealthErasure.js',
    'services/privacy/sessionHealthSweep.js',
    'utils/userRedisPurge.js',
    'controllers/integrationsController.js',
  ];

  it.each(DISCONNECT_SIDE)('%s never calls or imports the job-queue purge', (file) => {
    const src = read(path.join(APP, file));
    expect(src).not.toMatch(/userJobPurge|purgeUserJobs/);
  });

  // The other direction, so a NEW disconnect-side module cannot slip past the list above.
  it('only account deletion and the health-consent withdrawal import the purge, each from its own controller', () => {
    const importers = sourceFiles(APP)
      .filter((f) => /require\(\s*['"](?:\.{1,2}\/)+(?:[\w-]+\/)*userJobPurge['"]\s*\)/.test(stripComments(read(f))))
      .map(rel)
      .sort();
    expect(importers).toEqual(['services/privacy/consent.js', 'services/privacy/erasure.js']);
    const callers = (name) => sourceFiles(APP).filter((f) => new RegExp(`\\b${name}\\b`).test(stripComments(read(f)))).map(rel).sort();
    expect(callers('eraseUserChildData')).toEqual(['controllers/authController.js', 'services/privacy/erasure.js', 'services/privacy/orphanSweep.js']);
    expect(callers('withdrawConsent')).toEqual(['controllers/consentController.js', 'services/privacy/consent.js']);
  });
});
