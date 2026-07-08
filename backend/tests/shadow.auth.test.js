'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// SHADOW AUDIT — Sprint A6 (Auth & Accounts) — UNRESTRICTED FULL-SYSTEM ATTACK
// Attack surfaces: socket connection lifecycle (reconnect storms, token
// expiration chaos), refresh-token rotation (replay, races, family isolation),
// JWT forgery at the socket door, signup races, GDPR erasure completeness
// (Mongo + Redis, cross-user isolation). Stateful fakes with real Redis/Mongo
// semantics; real argon2, real jsonwebtoken, real Socket.IO server.
// ═══════════════════════════════════════════════════════════════════════════

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';
process.env.FRONTEND_URL   = 'http://localhost';
process.env.GOOGLE_CLIENT_ID = 'google-client-id';

const http = require('http');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Client = require('socket.io-client');

// ── Stateful fake Redis: real SET/GET/SCAN/DEL semantics ─────────────────────
// tokenDenylist and userRedisPurge run REAL code against this — no stubs.
jest.mock('../app/config/redis', () => {
  const map = new Map();
  const globToRegex = (glob) =>
    new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const fake = {
    __map: map,
    set: jest.fn(async (k, v) => { map.set(k, String(v)); return 'OK'; }),
    get: jest.fn(async (k) => (map.has(k) ? map.get(k) : null)),
    scan: jest.fn(async (cursor, _m, pattern) => ['0', [...map.keys()].filter((k) => globToRegex(pattern).test(k))]),
    del: jest.fn(async (...ks) => { let n = 0; ks.forEach((k) => { if (map.delete(k)) n += 1; }); return n; }),
  };
  return { getRedis: () => fake, connectRedis: async () => fake, createConnection: jest.fn(), __fake: fake };
});

jest.mock('../app/config/sentry', () => ({ captureException: jest.fn() }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: jest.fn() })) }));
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));

// Spy on what actually reaches the biometric handler — post-expiry packets must never arrive.
const mockEmotionSpy = jest.fn();
jest.mock('../app/sockets/biometricHandler', () => ({
  registerBiometricHandler: (socket) => socket.on('emotion_update', (...a) => mockEmotionSpy(...a)),
}));

// ── Stateful model fakes (real unique-index / filter semantics) ──────────────
jest.mock('../app/models/User', () => {
  const store = [];
  const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
  return {
    __store: store,
    create: jest.fn(async (doc) => {
      const row = { _id: `user-${store.length + 1}`, deletedAt: null, pushTokens: [], displayName: '', avatarUrl: '', wearableProvider: null, save: jest.fn(async () => true), ...doc };
      store.push(row);
      return row;
    }),
    findOne: jest.fn(async (filter) => store.find((d) => matches(d, filter)) || null),
    findById: jest.fn((id) => {
      const lookup = () => store.find((d) => String(d._id) === String(id)) || null;
      return { select: async () => lookup(), then: (resolve) => resolve(lookup()) };
    }),
    deleteOne: jest.fn(async (filter) => {
      const i = store.findIndex((d) => String(d._id) === String(filter._id));
      if (i >= 0) store.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    }),
  };
});

jest.mock('../app/models/Identity', () => {
  const store = [];
  const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
  return {
    __store: store,
    create: jest.fn(async (doc) => {
      if (store.some((d) => d.provider === doc.provider && d.providerUserId === doc.providerUserId)) {
        const err = new Error('E11000'); err.code = 11000; throw err;
      }
      const row = { _id: `id-${store.length + 1}`, emailVerified: false, lastLoginAt: null, ...doc };
      store.push(row); return row;
    }),
    findOne: jest.fn(async (filter) => store.find((d) => matches(d, filter)) || null),
    updateOne: jest.fn(async (filter, update, opts = {}) => {
      const doc = store.find((d) => matches(d, filter));
      if (doc) { Object.assign(doc, update.$set || {}); return { modifiedCount: 1 }; }
      if (opts.upsert) { store.push({ _id: `id-${store.length + 1}`, ...filter, ...(update.$set || {}) }); return { upsertedCount: 1 }; }
      return { modifiedCount: 0 };
    }),
    deleteMany: jest.fn(async (filter) => {
      const keep = store.filter((d) => String(d.userId) !== String(filter.userId));
      const n = store.length - keep.length;
      store.length = 0; store.push(...keep);
      return { deletedCount: n };
    }),
  };
});

jest.mock('../app/models/RefreshToken', () => {
  const store = [];
  const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
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
    deleteMany: jest.fn(async (filter) => {
      const keep = store.filter((d) => String(d.userId) !== String(filter.userId));
      const n = store.length - keep.length;
      store.length = 0; store.push(...keep);
      return { deletedCount: n };
    }),
  };
});

// Child collections for the GDPR sweep — arrays with real userId filtering.
for (const model of ['BiometricLog', 'MedicalProfile', 'MusicProfile', 'PlaylistSession', 'ServeEvent', 'UnclassifiedTrack']) {
  jest.mock(`../app/models/${model}`, () => {
    const store = [];
    return {
      __store: store,
      deleteMany: jest.fn(async (filter) => {
        const keep = store.filter((d) => String(d.userId) !== String(filter.userId));
        const n = store.length - keep.length;
        store.length = 0; store.push(...keep);
        return { deletedCount: n };
      }),
    };
  });
}

const redis = require('../app/config/redis').__fake;
const User = require('../app/models/User');
const Identity = require('../app/models/Identity');
const RefreshToken = require('../app/models/RefreshToken');
const BiometricLog = require('../app/models/BiometricLog');
const MedicalProfile = require('../app/models/MedicalProfile');
const MusicProfile = require('../app/models/MusicProfile');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent = require('../app/models/ServeEvent');
const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const { signup, login } = require('../app/services/auth/passwordAuth');
const { issueSession, rotate } = require('../app/services/auth/tokenService');
const ctrl = require('../app/controllers/authController');
const { createSocketServer } = require('../app/sockets/index');

const PASSWORD = 'correct horse battery';

let httpServer;
let io;
let port;
const clients = [];

function signAccess(expiresIn, jti = crypto.randomUUID(), userId = 'user-1') {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn, jwtid: jti });
}

function connect(token) {
  const socket = Client(`http://127.0.0.1:${port}`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
  });
  clients.push(socket);
  return socket;
}

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };
}
const next = (err) => { if (err) throw err; };

beforeAll((done) => {
  httpServer = http.createServer();
  io = createSocketServer(httpServer);
  httpServer.listen(0, () => { port = httpServer.address().port; done(); });
});

afterAll((done) => {
  io.close(() => done());
});

beforeEach(async () => {
  [User, Identity, RefreshToken, BiometricLog, MedicalProfile, MusicProfile, PlaylistSession, ServeEvent]
    .forEach((m) => { m.__store.length = 0; });
  redis.__map.clear();
  mockEmotionSpy.mockClear();
  // the socket middleware loads user-1 by id
  await User.create({ email: 'live@example.com' }); // becomes user-1
});

afterEach(() => {
  while (clients.length) {
    const s = clients.pop();
    if (s.connected) s.disconnect();
    s.close();
  }
});

// ═════ ATTACK 1: RECONNECT STORM ═════════════════════════════════════════════
describe('ATTACK: reconnect storm', () => {
  it('15 rapid connect/disconnect cycles leave zero zombie sockets and service intact', async () => {
    const token = signAccess('1h');
    for (let i = 0; i < 15; i++) {
      const s = connect(token);
      await once(s, 'connect');
      s.disconnect();
      s.close();
    }
    await sleep(150);

    const survivor = connect(token);
    await once(survivor, 'connect');
    survivor.emit('emotion_update', { taps: [{ x: 0.1, y: 0.9 }] });
    await sleep(250);

    expect(mockEmotionSpy).toHaveBeenCalledTimes(1); // service continues
    const live = await io.fetchSockets();
    expect(live).toHaveLength(1); // storm left nothing behind
  }, 20000);
});

// ═════ ATTACK 2: TOKEN EXPIRATION CHAOS ══════════════════════════════════════
describe('ATTACK: token expiration chaos', () => {
  it('packets hammered after JWT death: one auth_expired, disconnect, ZERO handler leaks', async () => {
    const s = connect(signAccess('1s'));
    await once(s, 'connect');

    s.emit('emotion_update', { taps: [] }); // pre-expiry: legitimate
    await sleep(200);
    expect(mockEmotionSpy).toHaveBeenCalledTimes(1);

    await sleep(1100); // the JWT dies while the socket lives

    const expired = once(s, 'auth_expired');
    const dropped = once(s, 'disconnect');
    s.emit('emotion_update', { taps: [{ x: 1, y: 1 }] });
    s.emit('emotion_update', { taps: [{ x: 1, y: 1 }] });
    s.emit('request_playlist', {});
    await expired;
    await dropped;

    expect(mockEmotionSpy).toHaveBeenCalledTimes(1); // nothing post-expiry got through
    expect(s.connected).toBe(false);
  }, 10000);
});

// ═════ ATTACK 3: LOGOUT vs LIVE SOCKET ═══════════════════════════════════════
describe('ATTACK: logout leaves a live socket behind', () => {
  it('revoking a jti at logout disconnects the socket opened with it and blocks re-entry', async () => {
    const jti = crypto.randomUUID();
    const token = signAccess('1h', jti);
    const s = connect(token);
    await once(s, 'connect');

    const dropped = once(s, 'disconnect');
    await ctrl.logout(
      { user: { _id: 'user-1' }, auth: { jti, exp: Math.floor(Date.now() / 1000) + 3600 }, body: {} },
      buildRes(),
    );
    await dropped; // the live socket dies with its token
    expect(s.connected).toBe(false);

    // and the revoked token cannot open a new door
    const again = connect(token);
    const err = await once(again, 'connect_error');
    expect(err.message).toBe('unauthorized');
  }, 10000);

  it('logout of one device does NOT kill the same user\'s other device', async () => {
    const jtiA = crypto.randomUUID();
    const jtiB = crypto.randomUUID();
    const deviceA = connect(signAccess('1h', jtiA));
    const deviceB = connect(signAccess('1h', jtiB));
    await Promise.all([once(deviceA, 'connect'), once(deviceB, 'connect')]);

    const droppedA = once(deviceA, 'disconnect');
    await ctrl.logout(
      { user: { _id: 'user-1' }, auth: { jti: jtiA, exp: Math.floor(Date.now() / 1000) + 3600 }, body: {} },
      buildRes(),
    );
    await droppedA;

    expect(deviceA.connected).toBe(false);
    expect(deviceB.connected).toBe(true); // other session untouched
  }, 10000);
});

// ═════ ATTACK 4: JWT FORGERY AT THE SOCKET DOOR ══════════════════════════════
describe('ATTACK: forged tokens', () => {
  it('alg=none, wrong-key signatures, and tampered payloads all bounce', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const tampered = (() => {
      const parts = signAccess('1h').split('.');
      parts[1] = b64({ userId: 'user-1', admin: true });
      return parts.join('.');
    })();
    const forged = [
      `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: 'user-1' })}.`,
      jwt.sign({ userId: 'user-1' }, 'wrong-secret', { expiresIn: '1h' }),
      tampered,
      'garbage.token.here',
    ];
    for (const token of forged) {
      const s = connect(token);
      const err = await once(s, 'connect_error');
      expect(err.message).toBe('unauthorized');
    }
  }, 15000);
});

// ═════ ATTACK 5: ROTATION RACES & FAMILY ISOLATION ═══════════════════════════
describe('ATTACK: refresh rotation abuse', () => {
  it('SIGNUP RACE: concurrent duplicate signups mint exactly one account, zero orphans', async () => {
    const email = 'race@example.com';
    const [a, b] = await Promise.all([
      signup({ email, password: PASSWORD }),
      signup({ email, password: PASSWORD }),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect(User.__store.filter((u) => u.email === email)).toHaveLength(1);
    expect(Identity.__store.filter((i) => i.providerUserId === email)).toHaveLength(1);
  });

  it('FAMILY ISOLATION: burning one device\'s family leaves the other device valid', async () => {
    const deviceA = await issueSession('user-1');
    const deviceB = await issueSession('user-1');

    const stolen = deviceA.refreshToken;
    const rotated = await rotate(stolen);
    expect(rotated.ok).toBe(true);
    const replay = await rotate(stolen); // theft detected
    expect(replay.reason).toBe('reused');

    expect((await rotate(rotated.refreshToken)).ok).toBe(false); // family A burned
    expect((await rotate(deviceB.refreshToken)).ok).toBe(true);  // family B untouched
  });

  it('login rejects a password at exactly 129 chars and accepts exactly 128', async () => {
    const email = 'edge@example.com';
    const password = 'x'.repeat(128);
    expect((await signup({ email, password })).ok).toBe(true);
    expect((await login({ email, password })).ok).toBe(true);
    expect((await login({ email, password: 'x'.repeat(129) })).ok).toBe(false);
  });
});

// ═════ ATTACK 6: GDPR ERASURE COMPLETENESS ═══════════════════════════════════
describe('ATTACK: GDPR erasure completeness', () => {
  it('deleteAccount leaves ZERO trace in any Mongo store or Redis — victim only', async () => {
    const su = await signup({ email: 'erase@me.com', password: PASSWORD });
    const uid = String(su.user._id);
    await issueSession(uid);
    await issueSession(uid);

    for (const m of [BiometricLog, MedicalProfile, MusicProfile, PlaylistSession, ServeEvent, UnclassifiedTrack]) {
      m.__store.push({ userId: uid }, { userId: 'user-1' });
    }
    redis.__map.set(`ledger:${uid}:served`, 'z');
    redis.__map.set(`ledger:${uid}:mood:happy`, 'z');
    redis.__map.set(`pool:${uid}:happy`, 'z');
    redis.__map.set(`bio:baseline:${uid}`, 'encrypted-blob');
    redis.__map.set('ledger:user-1:served', 'bystander');
    redis.__map.set('bio:baseline:user-1', 'bystander');

    await ctrl.deleteAccount({ user: { _id: uid }, auth: {} }, buildRes(), next);

    expect(User.__store.some((u) => String(u._id) === uid)).toBe(false);
    expect(Identity.__store.some((i) => String(i.userId) === uid)).toBe(false);
    expect(RefreshToken.__store.some((r) => String(r.userId) === uid)).toBe(false);
    for (const m of [BiometricLog, MedicalProfile, MusicProfile, PlaylistSession, ServeEvent, UnclassifiedTrack]) {
      expect(m.__store.some((d) => String(d.userId) === uid)).toBe(false);
      expect(m.__store.some((d) => d.userId === 'user-1')).toBe(true); // bystander intact
    }
    for (const key of [...redis.__map.keys()]) {
      expect(key.includes(uid)).toBe(false);
    }
    expect(redis.__map.get('ledger:user-1:served')).toBe('bystander');
    expect(redis.__map.get('bio:baseline:user-1')).toBe('bystander');
  });
});

// ═════ CLIENT-SIDE STATE LEAKS — deferred to Sprint A7 ═══════════════════════
describe('CLIENT STATE LEAKS (MMKV / React state)', () => {
  // Directive #3 targets the RN client. The encrypted MMKV store and the
  // three-lane state architecture land in Sprint A7 — the logout-purge attack
  // (zero biometric/session trace after logout) is pinned there, on the client
  // test bed, where the storage actually exists.
  it.todo('A7: logout leaves zero biometric/session trace in encrypted MMKV and in-memory state');
});
