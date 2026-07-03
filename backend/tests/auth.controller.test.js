'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';
process.env.GOOGLE_CLIENT_ID = 'google-client-id';

const jwt = require('jsonwebtoken');

// ── Provider SDK mocks ────────────────────────────────────────────────────────
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));
jest.mock('../app/utils/tokenDenylist', () => ({
  revoke: jest.fn().mockResolvedValue(true),
  isRevoked: jest.fn().mockResolvedValue(false),
}));
// logout/deleteAccount lazily reach for the live socket server; keep the heavy
// handler chain out of this suite.
jest.mock('../app/sockets/index', () => ({ getIo: () => null }));

// ── Stateful model fakes ──────────────────────────────────────────────────────
jest.mock('../app/models/User', () => {
  const store = [];
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
  return {
    __store: store,
    create: jest.fn(async (doc) => {
      const row = {
        _id: `user-${store.length + 1}`,
        deletedAt: null,
        pushTokens: [],
        displayName: '',
        avatarUrl: '',
        wearableProvider: null,
        save: jest.fn().mockResolvedValue(true),
        ...doc,
      };
      store.push(row);
      return row;
    }),
    findOne: jest.fn(async (filter) => store.find((d) => matches(d, filter)) || null),
    findById: jest.fn(async (id) => store.find((d) => String(d._id) === String(id)) || null),
    deleteOne: jest.fn(async (filter) => {
      const i = store.findIndex((d) => String(d._id) === String(filter._id));
      if (i >= 0) store.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    }),
  };
});

jest.mock('../app/models/Identity', () => {
  const store = [];
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
  return {
    __store: store,
    create: jest.fn(async (doc) => {
      if (store.some((d) => d.provider === doc.provider && d.providerUserId === doc.providerUserId)) {
        const err = new Error('E11000'); err.code = 11000; throw err;
      }
      const row = { _id: `id-${store.length + 1}`, emailVerified: false, lastLoginAt: null, ...doc };
      store.push(row);
      return row;
    }),
    findOne: jest.fn(async (filter) => store.find((d) => matches(d, filter)) || null),
    updateOne: jest.fn(async (filter, update, opts = {}) => {
      const doc = store.find((d) => matches(d, filter));
      if (doc) { Object.assign(doc, update.$set || {}); return { modifiedCount: 1 }; }
      if (opts.upsert) {
        store.push({ _id: `id-${store.length + 1}`, ...filter, ...(update.$set || {}) });
        return { upsertedCount: 1 };
      }
      return { modifiedCount: 0 };
    }),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
  };
});

jest.mock('../app/models/RefreshToken', () => {
  const store = [];
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
  const applySet = (doc, update) => Object.assign(doc, update.$set || update);
  return {
    __store: store,
    create: jest.fn(async (doc) => { const row = { status: 'active', ...doc }; store.push(row); return row; }),
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
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
  };
});

// deleteAccount's cascade targets — not under test here, but required at module load
jest.mock('../app/models/BiometricLog',    () => ({ deleteMany: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/models/MedicalProfile',  () => ({ deleteMany: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/models/MusicProfile',    () => ({ deleteMany: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/models/PlaylistSession', () => ({ deleteMany: jest.fn().mockResolvedValue({}) }));

const User = require('../app/models/User');
const Identity = require('../app/models/Identity');
const RefreshToken = require('../app/models/RefreshToken');
const ctrl = require('../app/controllers/authController');

const EMAIL = 'daniel@example.com';
const PASSWORD = 'correct horse battery';

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };
}
const next = (err) => { if (err) throw err; };

function lastJson(res) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

beforeEach(() => {
  User.__store.length = 0;
  Identity.__store.length = 0;
  RefreshToken.__store.length = 0;
  jest.clearAllMocks();
});

describe('POST /auth/signup', () => {
  it('creates the account and returns an access/refresh session pair + cookie', async () => {
    const res = buildRes();
    await ctrl.signup({ body: { email: EMAIL, password: PASSWORD } }, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = lastJson(res);
    expect(jwt.verify(body.token, process.env.JWT_SECRET).userId).toBeTruthy();
    expect(body.refreshToken).toMatch(/^krt_/);
    expect(body.user.email).toBe(EMAIL);
    expect(res.cookie).toHaveBeenCalledWith('kokonada_token', body.token, expect.any(Object));
  });

  it('maps email-taken to 409 and validation failures to 400', async () => {
    const res1 = buildRes();
    await ctrl.signup({ body: { email: EMAIL, password: PASSWORD } }, res1, next);

    const dup = buildRes();
    await ctrl.signup({ body: { email: EMAIL, password: 'another password 1' } }, dup, next);
    expect(dup.status).toHaveBeenCalledWith(409);

    const badEmail = buildRes();
    await ctrl.signup({ body: { email: 'nope', password: PASSWORD } }, badEmail, next);
    expect(badEmail.status).toHaveBeenCalledWith(400);

    const badPass = buildRes();
    await ctrl.signup({ body: { email: 'ok@example.com', password: 'short' } }, badPass, next);
    expect(badPass.status).toHaveBeenCalledWith(400);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await ctrl.signup({ body: { email: EMAIL, password: PASSWORD } }, buildRes(), next);
  });

  it('returns a fresh session pair for valid credentials', async () => {
    const res = buildRes();
    await ctrl.login({ body: { email: EMAIL, password: PASSWORD } }, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = lastJson(res);
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toMatch(/^krt_/);
    expect(body.user.id).toBeTruthy();
  });

  it('returns a generic 401 for wrong password AND unknown email', async () => {
    const wrong = buildRes();
    await ctrl.login({ body: { email: EMAIL, password: 'wrong password 99' } }, wrong, next);
    const ghost = buildRes();
    await ctrl.login({ body: { email: 'ghost@example.com', password: PASSWORD } }, ghost, next);

    expect(wrong.status).toHaveBeenCalledWith(401);
    expect(ghost.status).toHaveBeenCalledWith(401);
    expect(lastJson(wrong)).toEqual(lastJson(ghost)); // byte-identical bodies
  });
});

describe('POST /auth/refresh', () => {
  it('rotates a valid refresh token and re-sets the cookie', async () => {
    const login = buildRes();
    await ctrl.signup({ body: { email: EMAIL, password: PASSWORD } }, login, next);
    const { refreshToken } = lastJson(login);

    const res = buildRes();
    await ctrl.refresh({ body: { refreshToken } }, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = lastJson(res);
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toMatch(/^krt_/);
    expect(body.refreshToken).not.toBe(refreshToken);
    expect(res.cookie).toHaveBeenCalledWith('kokonada_token', body.token, expect.any(Object));
  });

  it('rejects replayed, unknown and missing tokens with 401', async () => {
    const login = buildRes();
    await ctrl.signup({ body: { email: EMAIL, password: PASSWORD } }, login, next);
    const { refreshToken } = lastJson(login);
    await ctrl.refresh({ body: { refreshToken } }, buildRes(), next); // legit rotation

    const replay = buildRes();
    await ctrl.refresh({ body: { refreshToken } }, replay, next); // replay of spent token
    expect(replay.status).toHaveBeenCalledWith(401);

    const unknown = buildRes();
    await ctrl.refresh({ body: { refreshToken: 'krt_' + 'x'.repeat(43) } }, unknown, next);
    expect(unknown.status).toHaveBeenCalledWith(401);

    const missing = buildRes();
    await ctrl.refresh({ body: {} }, missing, next);
    expect(missing.status).toHaveBeenCalledWith(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the presented refresh token family alongside the JWT jti', async () => {
    const login = buildRes();
    await ctrl.signup({ body: { email: EMAIL, password: PASSWORD } }, login, next);
    const { refreshToken } = lastJson(login);

    const res = buildRes();
    await ctrl.logout({ body: { refreshToken }, auth: { jti: 'jti-1', exp: Math.floor(Date.now() / 1000) + 60 } }, res, next);

    const after = buildRes();
    await ctrl.refresh({ body: { refreshToken } }, after, next);
    expect(after.status).toHaveBeenCalledWith(401);
  });
});

describe('GET /auth/me', () => {
  it('includes resolved entitlements (free by default)', async () => {
    const res = buildRes();
    await ctrl.me({ user: { _id: 'user-1', displayName: 'D', avatarUrl: '', email: EMAIL, wearableProvider: null } }, res, next);
    const body = lastJson(res);
    expect(body.id).toBe('user-1');
    expect(body.entitlements).toEqual({ tier: 'free', premium: false, expiresAt: null });
  });
});

describe('SSO → Identity upsert', () => {
  it('google sign-in creates/updates a provider-agnostic Identity row', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'g-123', email: 'sso@example.com', name: 'Dan', picture: '' }),
    });

    const res = buildRes();
    await ctrl.googleAuth({ body: { idToken: 'valid-google-token' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(200);

    const row = Identity.__store.find((d) => d.provider === 'google' && d.providerUserId === 'g-123');
    expect(row).toBeTruthy();
    expect(String(row.userId)).toBe(String(User.__store[0]._id));
  });

  it('mobile clients (client: "mobile") get a refresh token from SSO; legacy clients do not', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'g-123', email: 'sso@example.com', name: 'Dan', picture: '' }),
    });

    const legacy = buildRes();
    await ctrl.googleAuth({ body: { idToken: 't' } }, legacy, next);
    expect(lastJson(legacy).refreshToken).toBeUndefined();

    const mobile = buildRes();
    await ctrl.googleAuth({ body: { idToken: 't', client: 'mobile' } }, mobile, next);
    const body = lastJson(mobile);
    expect(body.refreshToken).toMatch(/^krt_/);
    // mobile access token is short-lived (15m), not the legacy 7d cookie token
    const payload = jwt.verify(body.token, process.env.JWT_SECRET);
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });
});
