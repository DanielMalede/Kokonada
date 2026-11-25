'use strict';

// RA-8 (the resilience audit of #309) — a refresh the server could not answer must not read as a replay.
//
// rotate() claims the presented token (active → rotated) before it builds the answer: it signs the
// access token and stores the successor. When either throws, the route answers 500 and the phone,
// which keeps its session on a 5xx since #309, presents the SAME token again. A claim left standing
// read that retry as a replay of a spent token and revoked the whole family: one failed write signed
// the user out. A token is spent only once its rotation has answered.
//
// Out of scope on purpose: an answer the server DID build and the network lost. That token is spent,
// and presenting it again still burns the family (pinned below); a grace window for it is the
// security-auditor's decision, not this fix's.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';

const crypto = require('crypto');

// ── Stateful fake RefreshToken model ──────────────────────────────────────────
// Real Mongo semantics, as in auth.tokenService.test.js: findOneAndUpdate is the atomic claim (one
// caller flips 'active' → 'rotated'), tokenHash is unique, updateMany is the family revocation, and
// a new row takes the schema's defaults (status 'active', rotatedAt null). Faults are one-shot and
// real: a write that throws instead of applying, or one that applies and then throws.
jest.mock('../app/models/RefreshToken', () => {
  const store = [];
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => {
      if (v !== null && typeof v === 'object' && '$ne' in v) return String(doc[k]) !== String(v.$ne);
      return String(doc[k]) === String(v);
    });
  const applySet = (doc, update) => Object.assign(doc, update.$set || update);
  return {
    __store: store,
    create: jest.fn(async (doc) => {
      if (store.some((d) => d.tokenHash === doc.tokenHash)) {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      }
      const row = { status: 'active', rotatedAt: null, ...doc };
      store.push(row);
      return row;
    }),
    findOne: jest.fn(async (filter) => store.find((d) => matches(d, filter)) || null),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const doc = store.find((d) => matches(d, filter));
      return doc ? applySet(doc, update) : null;
    }),
    updateMany: jest.fn(async (filter, update) => {
      const hit = store.filter((d) => matches(d, filter));
      hit.forEach((d) => applySet(d, update));
      return { modifiedCount: hit.length };
    }),
  };
});

const RefreshToken = require('../app/models/RefreshToken');
const { issueSession, rotate } = require('../app/services/auth/tokenService');

// The fake's own behaviour, re-installed before every test so no one-shot fault a test queued and
// did not consume can leak into the next one.
const REAL = Object.fromEntries(
  ['create', 'findOne', 'findOneAndUpdate', 'updateMany'].map((m) => [m, RefreshToken[m].getMockImplementation()]),
);

const USER = 'user-1';
const sha256 = (plain) => crypto.createHash('sha256').update(plain).digest('hex');
const rowOf = (plain) => RefreshToken.__store.find((r) => r.tokenHash === sha256(plain));
const familyOf = (plain) => RefreshToken.__store.filter((r) => r.familyId === rowOf(plain).familyId);
const fault = (name, message) => Object.assign(new Error(message), { name });
// The successor's insert, refused: it throws and stores nothing.
const refusedInsert = () => fault('MongoServerError', 'insert refused');
// A rotation that answered: the whole shape the refresh route hands the phone.
const ANSWERED = {
  ok: true,
  token: expect.any(String),
  refreshToken: expect.stringMatching(/^krt_/),
  refreshExpiresAt: expect.any(Date),
};

let errorLog;
beforeEach(() => {
  RefreshToken.__store.length = 0;
  for (const [m, impl] of Object.entries(REAL)) RefreshToken[m].mockReset().mockImplementation(impl);
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe('tokenService.rotate — a rotation the server could not answer (RA-8)', () => {
  it('a refused successor write leaves the token usable: the retry with the same token rotates and nothing is revoked', async () => {
    const s = await issueSession(USER);
    const failure = refusedInsert();
    RefreshToken.create.mockRejectedValueOnce(failure);

    // The original error reaches the route, which answers 500 — the status the phone keeps its session on.
    await expect(rotate(s.refreshToken)).rejects.toBe(failure);

    const retry = await rotate(s.refreshToken);
    expect(retry).toEqual(ANSWERED);
    expect(RefreshToken.__store.filter((r) => r.status === 'revoked')).toEqual([]);
    // The session goes on: the successor the retry issued rotates in turn.
    expect((await rotate(retry.refreshToken)).ok).toBe(true);
    expect(errorLog).not.toHaveBeenCalled(); // a restore that worked is silent
  });

  it('the failed attempt leaves the family as it found it: the presented token active, no successor stored', async () => {
    const s = await issueSession(USER);
    const before = { ...rowOf(s.refreshToken) };
    RefreshToken.create.mockRejectedValueOnce(refusedInsert());

    await expect(rotate(s.refreshToken)).rejects.toThrow('insert refused');

    expect(RefreshToken.__store).toHaveLength(1);
    expect(rowOf(s.refreshToken)).toEqual(before); // status 'active', rotatedAt null — as before the claim
  });

  it('a failure signing the access token is undone the same way, before any successor is stored', async () => {
    const s = await issueSession(USER);
    const ttl = process.env.AUTH_ACCESS_TTL;
    process.env.AUTH_ACCESS_TTL = 'not-a-timespan'; // a misconfigured TTL: jsonwebtoken throws on every sign
    try {
      await expect(rotate(s.refreshToken)).rejects.toThrow(/expiresIn/);
    } finally {
      if (ttl === undefined) delete process.env.AUTH_ACCESS_TTL;
      else process.env.AUTH_ACCESS_TTL = ttl;
    }

    // No successor that nobody holds, and the presented token as it was.
    expect(RefreshToken.__store).toHaveLength(1);
    expect(rowOf(s.refreshToken)).toMatchObject({ status: 'active', rotatedAt: null });
    // The configuration fixed, the same token rotates.
    expect((await rotate(s.refreshToken)).ok).toBe(true);
  });

  it('a successor insert that lands but whose acknowledgement is lost still leaves the same token usable', async () => {
    const s = await issueSession(USER);
    const ackLost = fault('MongoNetworkError', 'connection reset before the reply');
    RefreshToken.create.mockImplementationOnce(async (doc) => {
      await REAL.create(doc); // the row is written...
      throw ackLost;          // ...and the reply never arrives
    });

    await expect(rotate(s.refreshToken)).rejects.toBe(ackLost);

    // The row that landed stays in the family, unreachable: its plaintext died with the failed call.
    const retry = await rotate(s.refreshToken);
    expect(retry).toEqual(ANSWERED);
    expect(rowOf(s.refreshToken).status).toBe('rotated'); // spent by the retry that answered, not burned
    expect((await rotate(retry.refreshToken)).ok).toBe(true);
  });

  it('REPLAY still burns the family: once a rotation has answered, the token is spent, restored failure or not', async () => {
    const s = await issueSession(USER);
    const otherDevice = await issueSession(USER);
    RefreshToken.create.mockRejectedValueOnce(refusedInsert());
    await expect(rotate(s.refreshToken)).rejects.toThrow('insert refused');

    const answered = await rotate(s.refreshToken);
    expect(answered.ok).toBe(true);

    // The same token again, after its rotation answered: a replay, exactly as before the fix.
    expect(await rotate(s.refreshToken)).toEqual({ ok: false, reason: 'reused' });
    expect(familyOf(s.refreshToken).map((r) => r.status)).toEqual(['revoked', 'revoked']);
    expect((await rotate(answered.refreshToken)).ok).toBe(false);
    expect((await rotate(otherDevice.refreshToken)).ok).toBe(true); // another family is untouched
  });

  it('a replay that lands while the successor write is in flight wins: the failed attempt never revives a burned token', async () => {
    const s = await issueSession(USER);
    let concurrent;
    RefreshToken.create.mockImplementationOnce(async () => {
      // A second presentation of the same token arrives mid-rotation: the claim already stands, so it
      // reads as a replay and revokes the family — then this insert fails.
      concurrent = await rotate(s.refreshToken);
      throw refusedInsert();
    });

    await expect(rotate(s.refreshToken)).rejects.toThrow('insert refused');

    expect(concurrent).toEqual({ ok: false, reason: 'reused' });
    expect(rowOf(s.refreshToken).status).toBe('revoked');
    expect(await rotate(s.refreshToken)).toEqual({ ok: false, reason: 'reused' });
    expect(RefreshToken.__store.some((r) => r.status === 'active')).toBe(false);
  });

  it('a restore that fails too: the original error still propagates, one closed line reports it, the claim stands', async () => {
    const s = await issueSession(USER);
    const mintFailure = refusedInsert();
    // A driver message can quote the filter it failed on, the token's hash among it.
    const restoreFailure = fault('MongoNetworkError', `write failed on { tokenHash: "${sha256(s.refreshToken)}" }`);
    RefreshToken.create.mockImplementationOnce(async () => {
      RefreshToken.findOneAndUpdate.mockRejectedValueOnce(restoreFailure); // the next write — the restore — fails too
      throw mintFailure;
    });

    // The root cause, not the restore's failure, is what the route reports.
    await expect(rotate(s.refreshToken)).rejects.toBe(mintFailure);

    // One line of closed tokens: the error's class, never its text, the token, its hash or the user.
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith('[tokenService] rotate claim-restore outcome=failed error=MongoNetworkError');
    // The claim stands, so this token's next presentation reads as a replay: the line is the record of why.
    expect(rowOf(s.refreshToken).status).toBe('rotated');
  });
});
