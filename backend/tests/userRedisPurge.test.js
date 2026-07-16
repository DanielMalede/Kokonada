'use strict';

process.env.NODE_ENV = 'test';

// Stateful fake Redis: a key map with real SCAN MATCH glob semantics.
jest.mock('../app/config/redis', () => {
  const keys = new Set();
  const globToRegex = (glob) =>
    new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const fake = {
    __keys: keys,
    __failNext: { scan: false },
    scan: jest.fn(async (cursor, _m, pattern) => {
      if (fake.__failNext.scan) { fake.__failNext.scan = false; throw new Error('redis down'); }
      const rx = globToRegex(pattern);
      return ['0', [...keys].filter((k) => rx.test(k))];
    }),
    del: jest.fn(async (...args) => {
      let n = 0;
      args.forEach((k) => { if (keys.delete(k)) n += 1; });
      return n;
    }),
  };
  return { getRedis: jest.fn(() => fake), __fake: fake };
});

const { getRedis, __fake } = require('../app/config/redis');
const { purgeUserKeys, USER_KEY_NAMESPACES, patternsFor } = require('../app/utils/userRedisPurge');

const USER = 'u1';

beforeEach(() => {
  __fake.__keys.clear();
  __fake.__failNext.scan = false;
  getRedis.mockReturnValue(__fake);
  jest.clearAllMocks();
});

describe('purgeUserKeys (GDPR Redis erasure)', () => {
  it('deletes every user-scoped key class and nothing belonging to other users', async () => {
    const mine = [
      `ledger:${USER}:served`,
      `ledger:${USER}:mood:happy`,
      `ledger:${USER}:mood:bio:active:running`,
      `pool:${USER}:happy`,
      `buffer:${USER}:happy`,
      `buffer:${USER}:bio:active:running`,
      `bio:baseline:${USER}`,
    ];
    const theirs = [
      'ledger:u2:served',
      'ledger:u2:mood:happy',
      'pool:u2:happy',
      'buffer:u2:happy',
      'bio:baseline:u2',
      'af:spotify:xyz', // global caches stay
      'revoked:jti:abc',
    ];
    [...mine, ...theirs].forEach((k) => __fake.__keys.add(k));

    const deleted = await purgeUserKeys(USER);

    expect(deleted).toBe(mine.length);
    mine.forEach((k) => expect(__fake.__keys.has(k)).toBe(false));
    theirs.forEach((k) => expect(__fake.__keys.has(k)).toBe(true));
  });

  it('no-ops gracefully without Redis', async () => {
    getRedis.mockReturnValue(null);
    await expect(purgeUserKeys(USER)).resolves.toBe(0);
  });

  it('never throws when Redis errors mid-purge (best effort — TTLs finish the job)', async () => {
    __fake.__keys.add(`pool:${USER}:happy`);
    __fake.__failNext.scan = true;
    await expect(purgeUserKeys(USER)).resolves.toBeDefined();
  });

  it('rejects blank userIds rather than scanning wildcard patterns', async () => {
    __fake.__keys.add('pool:u2:happy');
    await purgeUserKeys('');
    await purgeUserKeys(null);
    expect(__fake.__keys.has('pool:u2:happy')).toBe(true);
    expect(__fake.scan).not.toHaveBeenCalled();
  });

  it('purges the live-biometric buffer namespace (registry regression guard)', async () => {
    __fake.__keys.add(`buffer:${USER}:bio:calm:resting`);
    __fake.__keys.add('buffer:u2:bio:calm:resting');
    const deleted = await purgeUserKeys(USER);
    expect(deleted).toBe(1);
    expect(__fake.__keys.has(`buffer:${USER}:bio:calm:resting`)).toBe(false);
    expect(__fake.__keys.has('buffer:u2:bio:calm:resting')).toBe(true);
  });
});

describe('USER_KEY_NAMESPACES registry', () => {
  it('is a frozen, named registry every erasure iterates (no silent misses)', () => {
    expect(Object.isFrozen(USER_KEY_NAMESPACES)).toBe(true);
    const names = USER_KEY_NAMESPACES.map((ns) => ns.name);
    // The live-buffer namespace was previously absent from the purge — pin it here so a
    // future user-scoped namespace must register or fail this guard.
    expect(names).toEqual(expect.arrayContaining([
      'serve-ledger', 'candidate-pool', 'live-buffer', 'bio-baseline',
    ]));
  });

  it('every registered pattern is user-scoped (embeds the userId — never a bare wildcard)', () => {
    for (const pattern of patternsFor(USER)) {
      expect(pattern).toContain(USER);
      expect(pattern.startsWith('*')).toBe(false);
    }
  });
});
