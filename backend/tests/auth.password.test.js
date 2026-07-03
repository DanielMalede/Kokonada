'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';

const argon2 = require('argon2');

// ── Stateful fakes: Identity + User with real unique-index semantics ──────────
jest.mock('../app/models/Identity', () => {
  const store = [];
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
  return {
    __store: store,
    create: jest.fn(async (doc) => {
      if (store.some((d) => d.provider === doc.provider && d.providerUserId === doc.providerUserId)) {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      }
      const row = { _id: `id-${store.length + 1}`, emailVerified: false, lastLoginAt: null, ...doc };
      store.push(row);
      return row;
    }),
    findOne: jest.fn(async (filter) => store.find((d) => matches(d, filter)) || null),
    updateOne: jest.fn(async (filter, update) => {
      const doc = store.find((d) => matches(d, filter));
      if (doc) Object.assign(doc, update.$set || {});
      return { modifiedCount: doc ? 1 : 0 };
    }),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
  };
});

jest.mock('../app/models/User', () => {
  const store = [];
  return {
    __store: store,
    create: jest.fn(async (doc) => {
      const row = { _id: `user-${store.length + 1}`, deletedAt: null, ...doc };
      store.push(row);
      return row;
    }),
    findById: jest.fn(async (id) => store.find((d) => String(d._id) === String(id)) || null),
    deleteOne: jest.fn(async (filter) => {
      const i = store.findIndex((d) => String(d._id) === String(filter._id));
      if (i >= 0) store.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    }),
  };
});

const Identity = require('../app/models/Identity');
const User = require('../app/models/User');
const { signup, login } = require('../app/services/auth/passwordAuth');

const EMAIL = 'daniel@example.com';
const PASSWORD = 'correct horse battery';

beforeEach(() => {
  Identity.__store.length = 0;
  User.__store.length = 0;
  jest.clearAllMocks();
});

describe('passwordAuth.signup', () => {
  it('creates a User and a password Identity with an argon2id hash', async () => {
    const r = await signup({ email: EMAIL, password: PASSWORD });
    expect(r.ok).toBe(true);
    expect(r.user._id).toBeTruthy();

    expect(User.__store).toHaveLength(1);
    expect(User.__store[0].ssoProvider).toBe('password');
    expect(User.__store[0].email).toBe(EMAIL);

    expect(Identity.__store).toHaveLength(1);
    const identity = Identity.__store[0];
    expect(identity.provider).toBe('password');
    expect(identity.providerUserId).toBe(EMAIL);
    expect(String(identity.userId)).toBe(String(r.user._id));
    expect(identity.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('never stores the plaintext password anywhere', async () => {
    await signup({ email: EMAIL, password: PASSWORD });
    expect(JSON.stringify(Identity.__store)).not.toContain(PASSWORD);
    expect(JSON.stringify(User.__store)).not.toContain(PASSWORD);
  });

  it('normalizes email (trim + lowercase) so login is case-insensitive', async () => {
    await signup({ email: '  DANIEL@Example.COM ', password: PASSWORD });
    expect(Identity.__store[0].providerUserId).toBe(EMAIL);
    const r = await login({ email: 'Daniel@example.com', password: PASSWORD });
    expect(r.ok).toBe(true);
  });

  it('rejects a duplicate email without leaving an orphaned User behind', async () => {
    await signup({ email: EMAIL, password: PASSWORD });
    const r = await signup({ email: EMAIL, password: 'another password 123' });
    expect(r).toEqual({ ok: false, reason: 'email-taken' });
    expect(User.__store).toHaveLength(1);
    expect(Identity.__store).toHaveLength(1);
  });

  it('rejects short (<10) and absurd (>128) passwords — DoS guard before argon2', async () => {
    expect(await signup({ email: EMAIL, password: 'short' })).toEqual({ ok: false, reason: 'invalid-password' });
    expect(await signup({ email: EMAIL, password: 'x'.repeat(129) })).toEqual({ ok: false, reason: 'invalid-password' });
    expect(User.__store).toHaveLength(0);
  });

  it('rejects malformed emails', async () => {
    for (const bad of ['not-an-email', '', 'a@', '@b.com', 'a b@c.com', `${'a'.repeat(250)}@x.com`, 'nul\0byte@x.com', '\0eading@x.com']) {
      expect(await signup({ email: bad, password: PASSWORD })).toEqual({ ok: false, reason: 'invalid-email' });
    }
    expect(User.__store).toHaveLength(0);
  });

  it('FUZZ: garbage input never throws', async () => {
    for (const garbage of [null, undefined, {}, { email: 123, password: {} }, { email: [], password: [] }]) {
      const r = await signup(garbage);
      expect(r.ok).toBe(false);
    }
  });
});

describe('passwordAuth.login', () => {
  beforeEach(async () => {
    await signup({ email: EMAIL, password: PASSWORD });
  });

  it('authenticates a valid email/password pair and stamps lastLoginAt', async () => {
    const r = await login({ email: EMAIL, password: PASSWORD });
    expect(r.ok).toBe(true);
    expect(String(r.user._id)).toBe(String(User.__store[0]._id));
    expect(Identity.__store[0].lastLoginAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong password with the same generic reason as an unknown email', async () => {
    const wrong = await login({ email: EMAIL, password: 'totally wrong pass' });
    const unknown = await login({ email: 'ghost@example.com', password: PASSWORD });
    expect(wrong).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(unknown).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('ENUMERATION: unknown email still burns an argon2 verify (timing equalizer)', async () => {
    const verifySpy = jest.spyOn(argon2, 'verify');
    await login({ email: 'ghost@example.com', password: PASSWORD });
    expect(verifySpy).toHaveBeenCalledTimes(1);
    verifySpy.mockRestore();
  });

  it('rejects login for a soft-deleted user', async () => {
    User.__store[0].deletedAt = new Date();
    const r = await login({ email: EMAIL, password: PASSWORD });
    expect(r).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('FUZZ: garbage input never throws', async () => {
    for (const garbage of [null, undefined, {}, { email: null, password: null }, { email: 9, password: 9 }]) {
      const r = await login(garbage);
      expect(r).toEqual({ ok: false, reason: 'invalid-credentials' });
    }
  });
});
