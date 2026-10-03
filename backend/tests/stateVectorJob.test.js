'use strict';

// J2 (BE-084; Plan B T2, DT-1) — the state-recompute job id is a keyed pseudonym of the user id.
//
// The id reaches places the payload does not: the queue's event log (`bull:state-vector-recompute:events`)
// names every job by it, and a failed job's log line prints it. It used to be `state-vector-<userId>`, so
// the log held every user id that ever had a recompute. Now it is `sv-` plus 22 base64url characters of an
// HMAC-SHA256 of the user id, under a subkey HKDF derives from ENCRYPTION_KEY for this one purpose:
//   • deterministic, so a burst of syncs for one user still coalesces into ONE job across replicas;
//   • not the user id, not an unkeyed hash of it (ObjectIds are enumerable), and not the blind index;
//   • base64url, so it has no `:` (BullMQ forbids it in a custom id), is not an integer (BullMQ refuses
//     those too), and never holds a run of 24 hex characters, so a count that looks for user ids in the
//     log (`hold-24hex`) reads 0 once the old entries are gone.
// Pure: no Redis, no Mongo. The burst on a real Redis is stateVectorJobId.redis.test.js.

process.env.NODE_ENV = 'test';
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
process.env.ENCRYPTION_KEY = KEY_A;

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { blindIndex } = require('../app/utils/encryption');
const {
  stateVectorJobId, stateVectorJobOptions, STATE_JOB_ID_INFO,
} = require('../app/queues/stateVectorJob');

afterEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A;
});

const A = '64f0c0ffee00000000000a0a';
const B = '64f0c0ffee00000000000b0b';
const SHAPE = /^sv-[A-Za-z0-9_-]{22}$/;

/** DT-1, written out: HMAC-SHA256 under HKDF(ENCRYPTION_KEY, info), base64url, first 22 characters. */
function expected(userId, keyHex = KEY_A) {
  const subkey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(keyHex, 'hex'), Buffer.alloc(0), STATE_JOB_ID_INFO, 32));
  return `sv-${crypto.createHmac('sha256', subkey).update(String(userId)).digest('base64url').slice(0, 22)}`;
}

describe('stateVectorJobId', () => {
  it('is the DT-1 construction, under its own versioned purpose', () => {
    expect(STATE_JOB_ID_INFO).toBe('kokonada:job-id:state-vector-recompute:v1');
    expect(stateVectorJobId(A)).toBe(expected(A));
  });

  it('is deterministic per user, different across users, and the same for an ObjectId and its hex', () => {
    expect(stateVectorJobId(A)).toBe(stateVectorJobId(A));
    expect(stateVectorJobId(A)).not.toBe(stateVectorJobId(B));
    expect(stateVectorJobId(new mongoose.Types.ObjectId(A))).toBe(stateVectorJobId(A));
  });

  it('is sv- and 22 base64url characters: no colon, not an integer, never 24 hex in a row, never the user id', () => {
    for (let i = 0; i < 2000; i += 1) {
      const id = String(new mongoose.Types.ObjectId());
      const jobId = stateVectorJobId(id);
      expect(jobId).toMatch(SHAPE);
      expect(jobId).not.toMatch(/[0-9a-fA-F]{24}/);
      expect(jobId).not.toContain(id);
    }
  });

  it('is not the blind index, nor an HMAC under the encryption key itself: the key is a derived subkey', () => {
    const plain = crypto.createHmac('sha256', Buffer.from(KEY_A, 'hex')).update(A).digest();
    expect(stateVectorJobId(A).slice(3)).not.toBe(plain.toString('base64url').slice(0, 22));
    expect(stateVectorJobId(A)).not.toContain(blindIndex(A).slice(0, 22));
    expect(stateVectorJobId(A)).not.toBe(`sv-${crypto.createHash('sha256').update(A).digest('base64url').slice(0, 22)}`);
  });

  it('changes with the key', () => {
    const underA = stateVectorJobId(A);
    process.env.ENCRYPTION_KEY = KEY_B;
    expect(stateVectorJobId(A)).not.toBe(underA);
    expect(stateVectorJobId(A)).toBe(expected(A, KEY_B));
  });

  it('throws without a usable ENCRYPTION_KEY, so a producer queues nothing rather than a guessable id', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => stateVectorJobId(A)).toThrow(/ENCRYPTION_KEY/);
  });
});

describe('stateVectorJobOptions', () => {
  it('carries the pseudonymous id, the delay and removal once the job has run', () => {
    expect(stateVectorJobOptions(A, 5000)).toEqual({
      jobId: stateVectorJobId(A), delay: 5000, removeOnComplete: true, removeOnFail: true,
    });
  });
});

// Plan B T2: the producers call the helper. Comments are stripped; only code counts.
describe('both producers queue the job through the helper', () => {
  const APP = path.join(__dirname, '../app');
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
  const rel = (f) => path.relative(APP, f).split(path.sep).join('/');
  const code = files(APP).map((f) => ({ file: rel(f), src: stripComments(fs.readFileSync(f, 'utf8')) }));

  it('every enqueue of the state-recompute queue passes stateVectorJobOptions(userId, <delay>)', () => {
    const calls = code.flatMap(({ file, src }) => [...src.matchAll(/enqueue\(\s*QUEUES\.STATE_VECTOR_RECOMPUTE\b([^;]*)/g)]
      .map((m) => ({ file, rest: m[1].replace(/\s+/g, ' ') })));
    expect(calls.map((c) => c.file).sort()).toEqual(['services/biosonic/baselines.js', 'services/wearable/metricStore.js']);
    for (const call of calls) expect(call.rest).toMatch(/^, \{ userId \}, stateVectorJobOptions\(userId, (?:5000|60_000)\)\)/);
  });

  it('no module builds a state-recompute job id of its own', () => {
    const own = code.filter(({ src }) => /state-vector-\$\{|['"`]state-vector-['"`]\s*\+/.test(src)).map((c) => c.file);
    expect(own).toEqual([]);
  });
});
