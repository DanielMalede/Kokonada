'use strict';

// W4-006 (seam half) — the affect store.
//
// The carried HMM posterior is the ONE piece of state the affect engine cannot recompute from a
// single reading: `updateAffect(state, input, opts)` is a forward step, and without the previous
// `alpha` every generation would start from a uniform prior and the temporal layer (§M.5 sticky
// transitions, dwell priors, hysteresis) would be decorative. This module is where that state
// lives between requests.
//
// It is held to the SAME rules as the baseline blob it is modelled on (`baselines.cacheBaselines`
// / `peekBaselines`): AES-256-GCM at rest, AAD-bound to the userId so one user's blob cannot be
// replayed into another's session, read through `auditedDecrypt`, and best-effort throughout — a
// Redis outage degrades the engine to a cold start, it never fails a generation.
//
// Two things this suite pins that the baseline precedent does NOT have:
//   · a carried posterior EXPIRES as a statement about "now" (§M.5 dwell priors are 3–30 min; an
//     hours-old label holding hysteresis is a stale assertion about a person, not a cache hit);
//   · the key family is registered for erasure (§0.4 S5), which for a Redis namespace means the
//     `userRedisPurge` registry and per-wearable erasure, not a hand-kept list somewhere.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));
jest.mock('../app/utils/biometricAudit', () => {
  const { decrypt } = jest.requireActual('../app/utils/encryption');
  return {
    logBiometricAccess: jest.fn(),
    // Functional spy — performs the REAL audited decrypt so reads work, while letting the suite
    // assert the audited accessor is what was used (never a bare `decrypt`).
    auditedDecrypt: jest.fn((userId, purpose, blob, opts = {}) =>
      decrypt(blob, opts.parseJson ?? false, userId == null ? null : String(userId))),
  };
});

const { getRedis } = require('../app/config/redis');
const { auditedDecrypt } = require('../app/utils/biometricAudit');
const { decrypt, encrypt } = require('../app/utils/encryption');
const affectCache = require('../app/services/biosonic/affectCache');

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  jest.clearAllMocks();
});

/** A minimal in-memory Redis double with real `set ... EX` / `get` / `del` semantics. */
function fakeRedis() {
  const store = new Map();
  return {
    store,
    set: jest.fn(async (k, v, mode, ttl) => { store.set(k, { v, mode, ttl }); return 'OK'; }),
    get: jest.fn(async (k) => (store.has(k) ? store.get(k).v : null)),
    del: jest.fn(async (...ks) => ks.filter((k) => store.delete(k)).length),
  };
}

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);

const carriedState = (over = {}) => ({
  v: 1,
  sig: 'taxonomy/v1:34',
  alpha: [0.5, 0.3, 0.2],
  label: 'deep-focus',
  labelSinceMs: NOW - 60_000,
  lastAtMs: NOW - 60_000,
  updates: 7,
  ...over,
});

// ── the shape of the key ────────────────────────────────────────────────────────────────────

describe('the cache key', () => {
  test('is user-scoped under the `bio:` namespace and carries no vital in its name (§0.2.2)', () => {
    const key = affectCache.affectKey('user-123');
    expect(key).toBe('bio:affect:user-123');
    // A Redis key is metadata that survives in logs, SCAN output and monitoring — the §0.2.2 rule
    // that no numeric vital appears in a key is enforced here rather than assumed.
    expect(key).not.toMatch(/\d{2,3}(bpm|ms)/i);
  });

  test('matches the namespace pattern erasure scans for', () => {
    const { patternsFor } = require('../app/utils/userRedisPurge');
    const patterns = patternsFor('u1');
    expect(patterns).toContain(affectCache.affectKey('u1'));
  });
});

// ── writing ─────────────────────────────────────────────────────────────────────────────────

describe('saveAffectState', () => {
  test('stores AES-GCM ciphertext bound to the user, never the plaintext posterior', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    await affectCache.saveAffectState('u1', carriedState());

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, blob, mode, ttl] = redis.set.mock.calls[0];
    expect(key).toBe('bio:affect:u1');
    expect(mode).toBe('EX');
    expect(ttl).toBe(affectCache.AFFECT_TTL_S);

    // The label is the sensitive part (R10: state labels are encrypted at rest and never reach a
    // prompt or a log). It must not be readable in the stored blob.
    expect(blob).not.toContain('deep-focus');
    expect(blob).not.toContain('alpha');
    expect(decrypt(blob, true, 'u1')).toMatchObject({ label: 'deep-focus', updates: 7 });
  });

  test('the AAD binds the blob to its user — another user cannot decrypt it', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await affectCache.saveAffectState('u1', carriedState());
    const blob = redis.set.mock.calls[0][1];

    expect(() => decrypt(blob, true, 'u2')).toThrow();
  });

  test('is a no-op without Redis rather than a throw (best-effort, R4)', async () => {
    getRedis.mockReturnValue(null);
    await expect(affectCache.saveAffectState('u1', carriedState())).resolves.toBe(false);
  });

  test('a Redis write failure never propagates to the caller', async () => {
    const redis = fakeRedis();
    redis.set.mockRejectedValue(new Error('READONLY'));
    getRedis.mockReturnValue(redis);
    await expect(affectCache.saveAffectState('u1', carriedState())).resolves.toBe(false);
  });

  test('refuses to store a non-object, so a bad caller cannot poison the key', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await expect(affectCache.saveAffectState('u1', null)).resolves.toBe(false);
    await expect(affectCache.saveAffectState('u1', 'deep-focus')).resolves.toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  test('refuses an empty userId — an unscoped key would be a cross-user blob', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await expect(affectCache.saveAffectState('', carriedState())).resolves.toBe(false);
    await expect(affectCache.saveAffectState(null, carriedState())).resolves.toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });
});

// ── reading ─────────────────────────────────────────────────────────────────────────────────

describe('peekAffectState', () => {
  test('round-trips the carried posterior through the audited accessor', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    const saved = carriedState();
    await affectCache.saveAffectState('u1', saved);

    const got = await affectCache.peekAffectState('u1', { now: NOW });

    expect(got).toEqual(saved);
    expect(auditedDecrypt).toHaveBeenCalledWith('u1', expect.any(String), expect.any(String), { parseJson: true });
  });

  test('a cold cache is a cold start, not an error', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.toBeNull();
  });

  test('no Redis at all degrades to a cold start', async () => {
    getRedis.mockReturnValue(null);
    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.toBeNull();
  });

  test('a corrupt or foreign blob is treated as a miss, never a throw', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    // Someone else's ciphertext, or a rotated key — both fail the AAD/tag check.
    redis.store.set('bio:affect:u1', { v: encrypt(JSON.stringify(carriedState()), 'someone-else') });

    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.toBeNull();
  });

  test('a blob decrypting to a non-object is rejected rather than handed to the engine', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    redis.store.set('bio:affect:u1', { v: encrypt(JSON.stringify('deep-focus'), 'u1') });

    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.toBeNull();
  });

  test('a blob without a usable alpha vector is rejected — the engine would restart anyway', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await affectCache.saveAffectState('u1', carriedState({ alpha: 'not-a-vector' }));

    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.toBeNull();
  });
});

// ── the freshness ruling ────────────────────────────────────────────────────────────────────

describe('a carried posterior expires as a statement about NOW', () => {
  test('a recent posterior is carried', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await affectCache.saveAffectState('u1', carriedState({ lastAtMs: NOW - 5 * 60_000 }));

    const got = await affectCache.peekAffectState('u1', { now: NOW });
    expect(got).not.toBeNull();
    expect(got.label).toBe('deep-focus');
  });

  test('a posterior older than MAX_CARRY_AGE_S is dropped, not carried', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    const stale = NOW - (affectCache.MAX_CARRY_AGE_S + 1) * 1000;
    await affectCache.saveAffectState('u1', carriedState({ lastAtMs: stale, labelSinceMs: stale }));

    // Not merely "the alpha washes out" — the LABEL and its dwell clock are what hysteresis reads,
    // and an hours-old incumbent would hold the switch margin against fresh evidence.
    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.toBeNull();
  });

  test('the boundary is inclusive on the fresh side', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await affectCache.saveAffectState('u1', carriedState({ lastAtMs: NOW - affectCache.MAX_CARRY_AGE_S * 1000 }));
    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.not.toBeNull();
  });

  test('a posterior with no timestamp is dropped — unbounded age is the unsafe direction', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await affectCache.saveAffectState('u1', carriedState({ lastAtMs: null }));
    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.toBeNull();
  });

  test('a FUTURE-dated posterior is dropped (S6: clock skew is not freshness)', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await affectCache.saveAffectState('u1', carriedState({ lastAtMs: NOW + 10 * 60_000 }));
    await expect(affectCache.peekAffectState('u1', { now: NOW })).resolves.toBeNull();
  });

  test('the retention TTL is at least the carry window — a key may not vanish while still usable', () => {
    expect(affectCache.AFFECT_TTL_S).toBeGreaterThanOrEqual(affectCache.MAX_CARRY_AGE_S);
  });

  test('`now` is a parameter, never the module clock (S9)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../app/services/biosonic/affectCache.js'), 'utf8',
    );
    // Freshness decides whether a label about a person is still asserted. The replay harness and
    // the soak must be able to control that, so the module may not reach for a clock at all.
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/new Date\(\)/);
    expect(src).not.toMatch(/Math\.random\(\)/);
  });

  test('a caller that forgets `now` is told, not silently given a cold start', async () => {
    getRedis.mockReturnValue(fakeRedis());
    await expect(affectCache.peekAffectState('u1')).rejects.toThrow(/now.*required/i);
  });
});

// ── §0.4 S5: the key family is registered for erasure ───────────────────────────────────────

describe('S5 — erasure registration (a new Redis key family is a GDPR surface)', () => {
  test('the account-erasure cascade purges it via the userRedisPurge registry', async () => {
    const { USER_KEY_NAMESPACES } = require('../app/utils/userRedisPurge');
    const names = USER_KEY_NAMESPACES.map((ns) => ns.name);
    expect(names).toContain('bio-affect');
  });

  test('per-wearable erasure resolves the key from THIS module, never a second copy of the format', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../app/services/privacy/wearableErasure.js'), 'utf8',
    );
    // The affect posterior is computed FROM heart rate and HRV, so disconnecting the wearable
    // that produced them while leaving an inferred emotional state cached is precisely the silent
    // leak S5 exists to prevent. Pinned as an IMPORT rather than a literal: the baseline key next
    // to it is a hand-copied string with a comment admitting it "mirrors" the real one, and that
    // is a drift waiting to happen. The behavioural half of this pin lives in
    // `wearableErasure.test.js`, where the erasure mocks already exist.
    expect(src).toMatch(/require\(['"]\.\.\/biosonic\/affectCache['"]\)/);
    expect(src).toMatch(/affectKey/);
  });

  test('purgeUserKeys actually deletes a stored affect blob', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    await affectCache.saveAffectState('u1', carriedState());
    expect(redis.store.has('bio:affect:u1')).toBe(true);

    // SCAN over the in-memory double, so the registry pattern is exercised for real.
    redis.scan = jest.fn(async (cursor, _m, pattern) => {
      const rx = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      return ['0', [...redis.store.keys()].filter((k) => rx.test(k))];
    });

    const { purgeUserKeys } = require('../app/utils/userRedisPurge');
    const deleted = await purgeUserKeys('u1');

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(redis.store.has('bio:affect:u1')).toBe(false);
  });
});
