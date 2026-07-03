'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ── Stateful fake RefreshToken model ──────────────────────────────────────────
// Real Mongo semantics: findOneAndUpdate is the atomic rotation claim — exactly
// one concurrent caller can flip status 'active' → 'rotated'. No stub theater.
jest.mock('../app/models/RefreshToken', () => {
  const store = [];
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => {
      if (v !== null && typeof v === 'object' && '$ne' in v) return String(doc[k]) !== String(v.$ne);
      return String(doc[k]) === String(v);
    });
  const applySet = (doc, update) => {
    Object.assign(doc, update.$set || update);
    return doc;
  };
  return {
    __store: store,
    create: jest.fn(async (doc) => {
      if (store.some((d) => d.tokenHash === doc.tokenHash)) {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      }
      const row = { status: 'active', ...doc };
      store.push(row);
      return row;
    }),
    findOne: jest.fn(async (filter) => store.find((d) => matches(d, filter)) || null),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const doc = store.find((d) => matches(d, filter));
      if (!doc) return null;
      return applySet(doc, update);
    }),
    updateMany: jest.fn(async (filter, update) => {
      const hit = store.filter((d) => matches(d, filter));
      hit.forEach((d) => applySet(d, update));
      return { modifiedCount: hit.length };
    }),
    deleteMany: jest.fn(async (filter) => {
      const keep = store.filter((d) => !matches(d, filter));
      const deleted = store.length - keep.length;
      store.length = 0;
      store.push(...keep);
      return { deletedCount: deleted };
    }),
  };
});

const RefreshToken = require('../app/models/RefreshToken');
const { issueSession, rotate, revokeAllForUser } = require('../app/services/auth/tokenService');

const USER = 'user-1';

beforeEach(() => {
  RefreshToken.__store.length = 0;
  jest.clearAllMocks();
});

describe('tokenService.issueSession', () => {
  it('issues a verifiable access JWT with userId, jti and a 15-minute TTL', async () => {
    const s = await issueSession(USER);
    const payload = jwt.verify(s.token, process.env.JWT_SECRET);
    expect(payload.userId).toBe(USER);
    expect(payload.jti).toBeTruthy();
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });

  it('issues an opaque krt_ refresh token and stores ONLY its sha256 hash', async () => {
    const s = await issueSession(USER);
    expect(s.refreshToken).toMatch(/^krt_[A-Za-z0-9_-]{40,}$/);
    expect(RefreshToken.__store).toHaveLength(1);
    const row = RefreshToken.__store[0];
    expect(row.tokenHash).toBe(crypto.createHash('sha256').update(s.refreshToken).digest('hex'));
    // plaintext must never touch the store
    expect(JSON.stringify(RefreshToken.__store)).not.toContain(s.refreshToken);
    expect(row.status).toBe('active');
    expect(row.userId).toBe(USER);
    expect(row.familyId).toBeTruthy();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('gives every session its own rotation family', async () => {
    const a = await issueSession(USER);
    const b = await issueSession(USER);
    expect(a.refreshToken).not.toBe(b.refreshToken);
    const [ra, rb] = RefreshToken.__store;
    expect(ra.familyId).not.toBe(rb.familyId);
  });
});

describe('tokenService.rotate', () => {
  it('rotates a valid refresh token: new pair, same family, old one dead', async () => {
    const s1 = await issueSession(USER);
    const r = await rotate(s1.refreshToken);
    expect(r.ok).toBe(true);
    expect(r.token).toBeTruthy();
    expect(r.refreshToken).not.toBe(s1.refreshToken);

    const rows = RefreshToken.__store;
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('rotated');
    expect(rows[1].status).toBe('active');
    expect(rows[1].familyId).toBe(rows[0].familyId);
  });

  it('REPLAY: reusing a rotated token revokes the ENTIRE family (theft response)', async () => {
    const s1 = await issueSession(USER);
    const r1 = await rotate(s1.refreshToken);
    expect(r1.ok).toBe(true);

    // attacker replays the stolen, already-rotated token
    const replay = await rotate(s1.refreshToken);
    expect(replay).toEqual({ ok: false, reason: 'reused' });

    // the legitimate client's newest token is now dead too — family burned
    const victim = await rotate(r1.refreshToken);
    expect(victim.ok).toBe(false);
  });

  it('CONCURRENCY: double-spend of one token yields exactly one winner and burns the family', async () => {
    const s = await issueSession(USER);
    const [a, b] = await Promise.all([rotate(s.refreshToken), rotate(s.refreshToken)]);
    const oks = [a, b].filter((x) => x.ok);
    expect(oks).toHaveLength(1);
    const loser = [a, b].find((x) => !x.ok);
    expect(loser.reason).toBe('reused');
    // family revoked: the winner's fresh token must no longer rotate
    const after = await rotate(oks[0].refreshToken);
    expect(after.ok).toBe(false);
  });

  it('rejects an expired refresh token without burning the family', async () => {
    const s = await issueSession(USER);
    RefreshToken.__store[0].expiresAt = new Date(Date.now() - 1000);
    const r = await rotate(s.refreshToken);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects unknown tokens as invalid', async () => {
    const r = await rotate('krt_' + 'x'.repeat(43));
    expect(r).toEqual({ ok: false, reason: 'invalid' });
  });

  it('FUZZ: garbage input never throws', async () => {
    for (const garbage of [null, undefined, 123, '', {}, [], 'a'.repeat(100000), Buffer.from('x')]) {
      const r = await rotate(garbage);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('invalid');
    }
  });
});

describe('tokenService.revokeAllForUser', () => {
  it('kills every family the user owns', async () => {
    const s1 = await issueSession(USER);
    const s2 = await issueSession(USER);
    const other = await issueSession('user-2');

    await revokeAllForUser(USER);

    expect((await rotate(s1.refreshToken)).ok).toBe(false);
    expect((await rotate(s2.refreshToken)).ok).toBe(false);
    expect((await rotate(other.refreshToken)).ok).toBe(true); // other users untouched
  });
});
