'use strict';

// BE-231 RA-1 — the per-user discovery cache the heart-rate branch reads instead of asking Spotify
// (the owner's ruling of 2026-11-22: a per-user cache, refreshed only by user-driven events).
//
// The cache runs against a stateful fake Redis that keeps values, their expiry and the SCAN MATCH
// glob semantics, so a write here is read back, expired and erased the way Redis would do it. The
// erasure cases run the REAL registry purges against a key the REAL cache wrote, so the key the cache
// writes and the key the erasures remove can never drift apart.

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => {
  const store = new Map(); // key → { value, expiresAt }
  const globToRegex = (glob) =>
    new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const fake = {
    store,
    now: () => Date.now(),
    failNext: null,
    calls: [],
    _check(op) {
      fake.calls.push(op);
      if (fake.failNext === op) { fake.failNext = null; throw new Error(`redis ${op} down`); }
    },
    _live(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt != null && e.expiresAt <= fake.now()) { store.delete(key); return null; }
      return e;
    },
    async get(key) { fake._check('get'); return fake._live(key)?.value ?? null; },
    async set(key, value, ...args) {
      fake._check('set');
      let expiresAt = null;
      const ex = args.findIndex((a) => String(a).toUpperCase() === 'EX');
      if (ex >= 0) expiresAt = fake.now() + Number(args[ex + 1]) * 1000;
      store.set(key, { value: String(value), expiresAt, ttl: ex >= 0 ? Number(args[ex + 1]) : null });
      return 'OK';
    },
    async del(...keys) {
      fake._check('del');
      let n = 0;
      for (const k of keys.flat()) if (fake._live(k) && store.delete(k)) n += 1;
      return n;
    },
    async scan(_cursor, _match, pattern) {
      fake._check('scan');
      const rx = globToRegex(pattern);
      return ['0', [...store.keys()].filter((k) => fake._live(k) && rx.test(k))];
    },
  };
  return { getRedis: jest.fn(() => fake), __fake: fake };
});

const { getRedis, __fake: redis } = require('../app/config/redis');
const cache = require('../app/services/discovery/discoveryCache');
const { purgeUserKeys, purgeUserKeysStrict, USER_KEY_NAMESPACES } = require('../app/utils/userRedisPurge');

const USER = '665f1c0a9b1e8a0012345678';
const OTHER = '665f1c0a9b1e8a0087654321';

// A tagged, taste-filtered candidate as the handler's Spotify closure returns it: a full Spotify
// track object (album art, preview, popularity, markets…) plus the genre tags the mixer filters on.
const candidate = (id, extra = {}) => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Track ${id}`,
  artists: [{ id: `art-${id}`, name: `Artist ${id}`, href: 'https://api.spotify.com/v1/artists/x', external_urls: {} }],
  album: { id: 'alb', name: 'Album', images: [{ url: 'https://i.scdn.co/image/x' }] },
  popularity: 61,
  preview_url: 'https://p.scdn.co/mp3-preview/x',
  available_markets: ['US', 'IL'],
  duration_ms: 201000,
  explicit: false,
  provider: 'spotify',
  artistIds: [`art-${id}`],
  genres: ['pop'],
  ...extra,
});

beforeEach(() => {
  redis.store.clear();
  redis.failNext = null;
  redis.calls.length = 0;
  redis.now = () => Date.now();
  getRedis.mockImplementation(() => redis);
});

describe('the key and its window', () => {
  it('is disc:bio:<userId>, one key per user', () => {
    expect(cache.discoveryCacheKey(USER)).toBe(`disc:bio:${USER}`);
    expect(cache.discoveryCacheKey(OTHER)).not.toBe(cache.discoveryCacheKey(USER));
  });

  it('expires within 6 hours of its last write, a constant with no env override', async () => {
    expect(cache.DISCOVERY_CACHE_TTL_S).toBeGreaterThan(0);
    expect(cache.DISCOVERY_CACHE_TTL_S).toBeLessThanOrEqual(6 * 3600);
    process.env.DISCOVERY_CACHE_TTL_S = '999999';
    try {
      await cache.writeDiscoveryCandidates(USER, [candidate('a')]);
    } finally {
      delete process.env.DISCOVERY_CACHE_TTL_S;
    }
    expect(redis.store.get(`disc:bio:${USER}`).ttl).toBe(cache.DISCOVERY_CACHE_TTL_S);
  });

  it('a read after the window is a miss', async () => {
    let t = 1_000_000;
    redis.now = () => t;
    await cache.writeDiscoveryCandidates(USER, [candidate('a')]);
    t += cache.DISCOVERY_CACHE_TTL_S * 1000 - 1;
    expect(await cache.readDiscoveryCandidates(USER)).toHaveLength(1);
    t += 1;
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
  });
});

describe('what is stored: the track ids and URIs and what the tagged candidate needs, nothing else', () => {
  it('a write then a read returns the candidates projected to id, uri, name, artists, provider, artistIds, genres', async () => {
    expect(await cache.writeDiscoveryCandidates(USER, [candidate('a'), candidate('b', { genres: ['indie'] })])).toBe(true);
    const back = await cache.readDiscoveryCandidates(USER);
    expect(back).toEqual([
      { id: 'a', uri: 'spotify:track:a', name: 'Track a', artists: [{ id: 'art-a', name: 'Artist a' }], provider: 'spotify', artistIds: ['art-a'], genres: ['pop'] },
      { id: 'b', uri: 'spotify:track:b', name: 'Track b', artists: [{ id: 'art-b', name: 'Artist b' }], provider: 'spotify', artistIds: ['art-b'], genres: ['indie'] },
    ]);
    const raw = redis.store.get(`disc:bio:${USER}`).value;
    for (const dropped of ['album', 'popularity', 'preview_url', 'available_markets', 'duration_ms', 'explicit', 'images', 'href', 'external_urls']) {
      expect(raw).not.toContain(dropped);
    }
  });

  it('keeps only Spotify candidates that carry an id, and caps the list', async () => {
    const many = Array.from({ length: cache.DISCOVERY_CACHE_MAX + 25 }, (_, i) => candidate(`t${i}`));
    await cache.writeDiscoveryCandidates(USER, [null, { name: 'no id' }, candidate('yt', { provider: 'youtube' }), ...many]);
    const back = await cache.readDiscoveryCandidates(USER);
    expect(back).toHaveLength(cache.DISCOVERY_CACHE_MAX);
    expect(back[0].id).toBe('t0');
    expect(back.every((t) => t.provider === 'spotify' && typeof t.id === 'string')).toBe(true);
  });

  it('a candidate with no provider tag is a Spotify one (the closure tags them all)', async () => {
    await cache.writeDiscoveryCandidates(USER, [{ id: 'x', uri: 'spotify:track:x', name: 'X', artists: [] }]);
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([
      { id: 'x', uri: 'spotify:track:x', name: 'X', artists: [], provider: 'spotify', artistIds: [], genres: [] },
    ]);
  });

  it('an empty refresh leaves the cached candidates in place', async () => {
    await cache.writeDiscoveryCandidates(USER, [candidate('a')]);
    expect(await cache.writeDiscoveryCandidates(USER, [])).toBe(false);
    expect(await cache.writeDiscoveryCandidates(USER, null)).toBe(false);
    expect(await cache.readDiscoveryCandidates(USER)).toHaveLength(1);
  });

  it('a read re-projects what Redis holds, so a stored extra field never reaches the pipeline', async () => {
    redis.store.set(`disc:bio:${USER}`, { value: JSON.stringify([{ ...candidate('a'), canonicalKey: 'forged', isDiscovery: false }]), expiresAt: null });
    const [t] = await cache.readDiscoveryCandidates(USER);
    expect(Object.keys(t).sort()).toEqual(['artistIds', 'artists', 'genres', 'id', 'name', 'provider', 'uri']);
  });
});

describe('it never fails a generation', () => {
  it('a miss, no Redis, a Redis error and a corrupt value all read as []', async () => {
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
    redis.store.set(`disc:bio:${USER}`, { value: '{not json', expiresAt: null });
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
    redis.store.set(`disc:bio:${USER}`, { value: JSON.stringify({ not: 'a list' }), expiresAt: null });
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
    redis.failNext = 'get';
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
    getRedis.mockImplementation(() => null);
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
  });

  it('a write with no Redis or a Redis error answers false and does not throw', async () => {
    redis.failNext = 'set';
    await expect(cache.writeDiscoveryCandidates(USER, [candidate('a')])).resolves.toBe(false);
    getRedis.mockImplementation(() => null);
    await expect(cache.writeDiscoveryCandidates(USER, [candidate('a')])).resolves.toBe(false);
  });

  it('refuses a blank id or one holding a glob character: nothing is read or written', async () => {
    for (const id of ['', '   ', null, undefined, 'u*', 'u?', 'u[1]']) {
      expect(await cache.writeDiscoveryCandidates(id, [candidate('a')])).toBe(false);
      expect(await cache.readDiscoveryCandidates(id)).toEqual([]);
    }
    expect(redis.calls).toEqual([]);
    expect(redis.store.size).toBe(0);
  });
});

describe('the key the cache writes is the key every erasure removes', () => {
  async function fill() {
    await cache.writeDiscoveryCandidates(USER, [candidate('a')]);
    await cache.writeDiscoveryCandidates(OTHER, [candidate('b')]);
    expect(redis.store.has(`disc:bio:${USER}`)).toBe(true);
  }

  it('is registered in USER_KEY_NAMESPACES', () => {
    const ns = USER_KEY_NAMESPACES.find((n) => n.name === 'discovery-cache');
    expect(ns).toBeDefined();
    expect(ns.pattern(USER)).toBe(cache.discoveryCacheKey(USER));
  });

  it('account deletion (the best-effort purge) removes it, and only this user\'s', async () => {
    await fill();
    await purgeUserKeys(USER);
    expect(redis.store.has(`disc:bio:${USER}`)).toBe(false);
    expect(redis.store.has(`disc:bio:${OTHER}`)).toBe(true);
  });

  it('a withdrawal and Spotify disconnect (the strict purge) remove it, and only this user\'s', async () => {
    await fill();
    await purgeUserKeysStrict(USER);
    expect(redis.store.has(`disc:bio:${USER}`)).toBe(false);
    expect(redis.store.has(`disc:bio:${OTHER}`)).toBe(true);
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
  });

  it('the orphan sweep finds it and names its owner', async () => {
    await fill();
    const ns = USER_KEY_NAMESPACES.find((n) => n.name === 'discovery-cache');
    const [, keys] = await redis.scan('0', 'MATCH', ns.scan, 'COUNT', 200);
    expect(keys.sort()).toEqual([`disc:bio:${OTHER}`, `disc:bio:${USER}`].sort());
    expect(keys.map(ns.idOf).sort()).toEqual([OTHER, USER].sort());
  });
});

// Resilience RA-1 (round 2): the session-open refresh claims a per-user floor before any Mongo or
// Spotify work. The floor lives inside the same key, so every erasure that removes the candidates
// removes it too, and it holds across sockets and processes because it is in Redis.
describe('the refresh floor (claimDiscoveryRefresh)', () => {
  let t;
  beforeEach(() => {
    t = 1_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => t);
  });
  afterEach(() => jest.restoreAllMocks());
  const FLOOR_S = () => cache.DISCOVERY_REFRESH_FLOOR_MS / 1000;

  it('is 15 to 30 minutes, inside the cache window, a constant with no env override', async () => {
    expect(cache.DISCOVERY_REFRESH_FLOOR_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
    expect(cache.DISCOVERY_REFRESH_FLOOR_MS).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(cache.DISCOVERY_REFRESH_FLOOR_MS).toBeLessThanOrEqual(cache.DISCOVERY_CACHE_TTL_S * 1000);
    process.env.DISCOVERY_REFRESH_FLOOR_MS = '1';
    try {
      expect(await cache.claimDiscoveryRefresh(USER)).toBe(true);
      t += 1000;
      expect(await cache.claimDiscoveryRefresh(USER)).toBe(false);
    } finally {
      delete process.env.DISCOVERY_REFRESH_FLOOR_MS;
    }
  });

  it('the first claim wins and is recorded; a second inside the floor loses; after the floor it wins again', async () => {
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(true);
    t += cache.DISCOVERY_REFRESH_FLOOR_MS - 1;
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(false);
    t += 1;
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(true);
  });

  it('the floor is per user', async () => {
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(true);
    expect(await cache.claimDiscoveryRefresh(OTHER)).toBe(true);
  });

  it('an attempt on an empty cache stores no candidates and lives exactly the floor', async () => {
    await cache.claimDiscoveryRefresh(USER);
    expect(redis.store.get(`disc:bio:${USER}`).ttl).toBe(FLOOR_S());
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
    const raw = redis.store.get(`disc:bio:${USER}`).value;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['refreshedAt', 'tracks', 'writtenAt']);
  });

  it('a write is a refresh too: a claim right after an emotion run\'s write loses', async () => {
    await cache.writeDiscoveryCandidates(USER, [candidate('a')]);
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(false);
  });

  it('an attempt keeps the cached candidates with the lifetime they had left, never more', async () => {
    await cache.writeDiscoveryCandidates(USER, [candidate('a')]);
    t += cache.DISCOVERY_REFRESH_FLOOR_MS;
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(true);
    expect((await cache.readDiscoveryCandidates(USER)).map((x) => x.id)).toEqual(['a']);
    expect(redis.store.get(`disc:bio:${USER}`).ttl).toBe(cache.DISCOVERY_CACHE_TTL_S - FLOOR_S());
    // and they still go when their 6 hours from the write are over
    redis.now = () => t;
    t += cache.DISCOVERY_CACHE_TTL_S * 1000 - cache.DISCOVERY_REFRESH_FLOOR_MS;
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
  });

  it('candidates with less than the floor left are dropped, so the floor still lasts its full length', async () => {
    await cache.writeDiscoveryCandidates(USER, [candidate('a')]);
    t += cache.DISCOVERY_CACHE_TTL_S * 1000 - 60 * 1000; // one minute of life left (the fake has not expired it)
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(true);
    expect(await cache.readDiscoveryCandidates(USER)).toEqual([]);
    expect(redis.store.get(`disc:bio:${USER}`).ttl).toBe(FLOOR_S());
  });

  it('reads a list written before the floor existed, and a claim over it wins once', async () => {
    redis.store.set(`disc:bio:${USER}`, { value: JSON.stringify([candidate('legacy')]), expiresAt: null });
    expect((await cache.readDiscoveryCandidates(USER)).map((x) => x.id)).toEqual(['legacy']);
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(true);
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(false);
  });

  it('fails closed: no Redis, a Redis error, a blank or glob id all answer false', async () => {
    redis.failNext = 'get';
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(false);
    redis.failNext = 'set';
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(false);
    redis.calls.length = 0;
    for (const id of ['', '  ', null, undefined, 'u*', 'u[1]']) expect(await cache.claimDiscoveryRefresh(id)).toBe(false);
    expect(redis.calls).toEqual([]);
    getRedis.mockImplementation(() => null);
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(false);
  });

  it('the floor record is erased with the candidates (the strict purge)', async () => {
    await cache.claimDiscoveryRefresh(USER);
    await purgeUserKeysStrict(USER);
    expect(redis.store.has(`disc:bio:${USER}`)).toBe(false);
    expect(await cache.claimDiscoveryRefresh(USER)).toBe(true);
  });
});
