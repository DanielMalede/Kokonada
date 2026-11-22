'use strict';

// BE-231 RA-1, round 2 (resilience RA-1, RA-2, RA-4): the session-open discovery refresh under a
// storm, a race and its own guards — on REAL MongoDB, through the REAL socket handler, the REAL
// spotify.js (under a fake Spotify that records every request) and the REAL Spotify disconnect
// controller. Only Redis is a stateful fake (values with their EX, SCAN MATCH with glob semantics).
//
// Why: every `live_mode` off→on edge, and every socket that connects in Live, used to start a refresh
// with no in-flight guard and no per-user floor, and no socket event is rate limited. Each refresh is
// a User read, a MusicProfile read, a token read and two or more Spotify requests on the app-wide
// budget, whose 429 disables discovery for every user for an hour. A toggle or reconnect loop was an
// unbounded read and request loop.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV       = 'test';

jest.mock('axios');
jest.mock('../app/config/redis', () => {
  const store = new Map();
  const globToRegex = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const fake = {
    store,
    async get(key) { return store.has(key) ? store.get(key).value : null; },
    async set(key, value, ...args) {
      const ex = args.findIndex((a) => String(a).toUpperCase() === 'EX');
      store.set(key, { value: String(value), ttl: ex >= 0 ? Number(args[ex + 1]) : null });
      return 'OK';
    },
    async del(...keys) { let n = 0; for (const k of keys.flat()) if (store.delete(k)) n += 1; return n; },
    async scan(_cursor, _match, pattern) { const rx = globToRegex(pattern); return ['0', [...store.keys()].filter((k) => rx.test(k))]; },
  };
  return { getRedis: jest.fn(() => fake), createConnection: jest.fn(), __fake: fake };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose     = require('mongoose');
const axios        = require('axios');
const User         = require('../app/models/User');
const MusicProfile = require('../app/models/MusicProfile');
const spotify      = require('../app/services/spotify');
const handler      = require('../app/sockets/biometricHandler');
const { spotifyDisconnect } = require('../app/controllers/integrationsController');
const { __fake: redis } = require('../app/config/redis');

jest.setTimeout(120000);

const SPOTIFY_API = 'https://api.spotify.com/v1';
const DISCOVERY_PATH = /^\/(recommendations|search|artists|playlists\/[^/]+\/tracks)$/;
const MINUTE = 60 * 1000;

// ── The fake Spotify: records every request; /recommendations can be held open ────────────────────

const fake = { empty: false, hold: null };
const track = (id) => ({ id, uri: `spotify:track:${id}`, name: `Track ${id}`, artists: [{ id: `art-${id}`, name: `Artist ${id}` }] });
function deferred() { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; }

function installFakeSpotify() {
  axios.get.mockImplementation(async (url, config = {}) => {
    const u = String(url);
    if (!u.startsWith(SPOTIFY_API)) throw new Error(`unexpected GET ${u}`);
    const p = config.params || {};
    const route = u.slice(SPOTIFY_API.length);
    if (route === '/recommendations') {
      if (fake.hold) await fake.hold.promise;
      return { data: { tracks: fake.empty ? [] : [1, 2, 3].map((i) => track(`rec-${i}`)) } };
    }
    if (route === '/search') return { data: { tracks: { items: [] }, playlists: { items: [] } } };
    if (route === '/artists') return { data: { artists: String(p.ids).split(',').map((id) => ({ id, genres: ['pop'] })) } };
    throw Object.assign(new Error('404'), { response: { status: 404, headers: {} } });
  });
  axios.post.mockImplementation(async (url) => { throw new Error(`unexpected POST ${url}`); });
  axios.put.mockImplementation(async (url) => { throw new Error(`unexpected PUT ${url}`); });
}
const discoveryRequests = () => axios.get.mock.calls
  .map(([url]) => String(url))
  .filter((u) => u.startsWith(SPOTIFY_API) && DISCOVERY_PATH.test(u.slice(SPOTIFY_API.length)));
const recommendations = () => discoveryRequests().filter((u) => u.endsWith('/recommendations'));

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

let mem;
let n = 0;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_discovery_refresh_storm' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let userFind;
let profileFind;
beforeEach(async () => {
  await Promise.all([User, MusicProfile].map((M) => M.deleteMany({})));
  redis.store.clear();
  jest.clearAllMocks();
  installFakeSpotify();
  fake.empty = false;
  fake.hold = null;
  spotify._resetArtistGenresCache();
  userFind    = jest.spyOn(User, 'findById');
  profileFind = jest.spyOn(MusicProfile, 'findOne');
  for (const f of ['warn', 'info', 'error', 'log']) jest.spyOn(console, f).mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  handler._resetDebounceState();
});

async function seedUser({ spotifyLinked = true, youtubeLinked = false, profile = {} } = {}) {
  const tag = `u${++n}`;
  const user = await User.create({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.test`, musicProvider: spotifyLinked ? 'spotify' : (youtubeLinked ? 'youtube' : null) });
  if (spotifyLinked) user.setToken('spotifyToken', { accessToken: `at-${tag}`, refreshToken: `rt-${tag}`, expiresAt: Date.now() + 3600e3 });
  if (youtubeLinked) user.setToken('youtubeMusicToken', { accessToken: `yat-${tag}`, refreshToken: `yrt-${tag}`, expiresAt: Date.now() + 3600e3 });
  await user.save();
  if (profile !== null) {
    await MusicProfile.create({
      userId: user._id, topGenres: ['pop', 'indie', 'ambient'], genreSet: ['pop'], knownArtistIds: [],
      library: [{ id: 'fam1', provider: 'spotify', name: 'Familiar 1', artist: 'Fam Artist', genres: ['pop'], uri: 'spotify:track:fam1' }],
      ...profile,
    });
  }
  return user._id;
}
const keyOf = (userId) => `disc:bio:${userId}`;
const cachedIds = (userId) => {
  const row = redis.store.get(keyOf(userId));
  if (!row) return [];
  const parsed = JSON.parse(row.value);
  return (Array.isArray(parsed) ? parsed : parsed.tracks || []).map((t) => t.id);
};

// A socket registered the way socket.io does it.
function connect(userId) {
  const handlers = {};
  const s = { id: `socket-storm-${++n}`, data: { user: { _id: userId } }, emit: jest.fn(), on: (e, fn) => { handlers[e] = fn; } };
  handler.registerBiometricHandler(s);
  const refreshes = [];
  return {
    // emit without waiting: what a toggling client does
    toggle(enabled) {
      handlers.live_mode({ enabled });
      const st = handler._debounceMap.get(s.id);
      if (st?.discoveryRefresh) refreshes.push(st.discoveryRefresh);
    },
    async settle() { await Promise.all(refreshes); },
    async liveMode(enabled) { this.toggle(enabled); await this.settle(); },
  };
}

// ── RA-1: the storm ──────────────────────────────────────────────────────────────────────────────

describe('a Live toggle or reconnect loop is bounded (RA-1)', () => {
  it('20 Live toggles on one socket send one discovery request and read the profile once', async () => {
    const userId = await seedUser();
    const c = connect(userId);
    for (let i = 0; i < 20; i += 1) { c.toggle(true); c.toggle(false); }
    await c.settle();
    expect(recommendations()).toHaveLength(1);
    expect(profileFind).toHaveBeenCalledTimes(1);
    expect(userFind).toHaveBeenCalledTimes(1);
    expect(cachedIds(userId).length).toBeGreaterThan(0); // the one refresh really filled the cache

    // and 20 more, each waited for, inside the floor: nothing at all, not even a Mongo read
    for (let i = 0; i < 20; i += 1) { await c.liveMode(true); await c.liveMode(false); }
    expect(recommendations()).toHaveLength(1);
    expect(profileFind).toHaveBeenCalledTimes(1);
    expect(userFind).toHaveBeenCalledTimes(1);
  });

  it('5 reconnects in Live send one discovery request (the floor holds across sockets)', async () => {
    const userId = await seedUser();
    for (let i = 0; i < 5; i += 1) await connect(userId).liveMode(true);
    expect(recommendations()).toHaveLength(1);
    expect(profileFind).toHaveBeenCalledTimes(1);
  });

  it('5 sockets connecting in Live at once send one discovery request', async () => {
    const userId = await seedUser();
    const sockets = [1, 2, 3, 4, 5].map(() => connect(userId));
    for (const c of sockets) c.toggle(true);
    await Promise.all(sockets.map((c) => c.settle()));
    expect(recommendations()).toHaveLength(1);
    expect(profileFind).toHaveBeenCalledTimes(1);
  });

  it('the floor is per user: another user opening a session still refreshes', async () => {
    const a = await seedUser();
    const b = await seedUser();
    await connect(a).liveMode(true);
    await connect(b).liveMode(true);
    expect(recommendations()).toHaveLength(2);
    expect(cachedIds(a).length).toBeGreaterThan(0);
    expect(cachedIds(b).length).toBeGreaterThan(0);
  });

  it('after the floor the next opening refreshes once more, and the floor is at most the cache window', async () => {
    const { DISCOVERY_REFRESH_FLOOR_MS, DISCOVERY_CACHE_TTL_S } = require('../app/services/discovery/discoveryCache');
    expect(DISCOVERY_REFRESH_FLOOR_MS).toBeGreaterThanOrEqual(15 * MINUTE);
    expect(DISCOVERY_REFRESH_FLOOR_MS).toBeLessThanOrEqual(DISCOVERY_CACHE_TTL_S * 1000);
    const userId = await seedUser();
    const t0 = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await connect(userId).liveMode(true);
    clock.mockReturnValue(t0 + DISCOVERY_REFRESH_FLOOR_MS - 1000);
    await connect(userId).liveMode(true);
    expect(recommendations()).toHaveLength(1);
    clock.mockReturnValue(t0 + DISCOVERY_REFRESH_FLOOR_MS + 1000);
    await connect(userId).liveMode(true);
    expect(recommendations()).toHaveLength(2);
  });

  it('an empty answer is recorded too: the next opening inside the floor sends nothing', async () => {
    const userId = await seedUser();
    fake.empty = true;
    await connect(userId).liveMode(true);
    expect(recommendations()).toHaveLength(1);
    expect(cachedIds(userId)).toEqual([]);
    for (let i = 0; i < 5; i += 1) await connect(userId).liveMode(true);
    expect(recommendations()).toHaveLength(1);
    expect(profileFind).toHaveBeenCalledTimes(1);
  });

  it('a refresh that throws is recorded too: the next opening inside the floor reads nothing', async () => {
    const userId = await seedUser();
    jest.spyOn(spotify, 'getValidToken').mockRejectedValue(new Error('token refresh failed'));
    await connect(userId).liveMode(true);
    await connect(userId).liveMode(true);
    expect(spotify.getValidToken).toHaveBeenCalledTimes(1);
    expect(profileFind).toHaveBeenCalledTimes(1);
  });

  it('a floor record keeps the candidates already cached, inside their own 6-hour window', async () => {
    const { DISCOVERY_CACHE_TTL_S, DISCOVERY_REFRESH_FLOOR_MS } = require('../app/services/discovery/discoveryCache');
    const userId = await seedUser();
    const t0 = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await connect(userId).liveMode(true);
    const filled = cachedIds(userId);
    expect(filled.length).toBeGreaterThan(0);
    // past the floor, an opening whose answer is empty keeps what is cached, with no more lifetime
    fake.empty = true;
    clock.mockReturnValue(t0 + DISCOVERY_REFRESH_FLOOR_MS + MINUTE);
    await connect(userId).liveMode(true);
    expect(recommendations()).toHaveLength(2);
    expect(cachedIds(userId)).toEqual(filled);
    const elapsedS = (DISCOVERY_REFRESH_FLOOR_MS + MINUTE) / 1000;
    expect(redis.store.get(keyOf(userId)).ttl).toBeLessThanOrEqual(DISCOVERY_CACHE_TTL_S - elapsedS + 1);
  });
});

// ── RA-2: a purge inside the refresh is not undone ───────────────────────────────────────────────

describe('a purge that lands while the refresh is in flight is not undone (RA-2)', () => {
  const authUser = (userId) => User.findById(userId).select('-spotifyToken -youtubeMusicToken -wearableToken');

  it('a Spotify disconnect that lands while the refresh is in flight leaves no disc:bio key', async () => {
    const userId = await seedUser();
    fake.hold = deferred();
    const c = connect(userId);
    c.toggle(true);
    while (recommendations().length === 0) await new Promise((r) => setImmediate(r)); // the request is out
    const next = jest.fn();
    await spotifyDisconnect({ user: await authUser(userId) }, { status() { return this; }, json() { return this; } }, next);
    expect(next).not.toHaveBeenCalled();
    expect(redis.store.has(keyOf(userId))).toBe(false); // the purge ran
    fake.hold.release();
    await c.settle();
    expect(redis.store.has(keyOf(userId))).toBe(false);
  });

  it('an account deleted while the refresh is in flight leaves no disc:bio key', async () => {
    const userId = await seedUser();
    fake.hold = deferred();
    const c = connect(userId);
    c.toggle(true);
    while (recommendations().length === 0) await new Promise((r) => setImmediate(r));
    await User.deleteOne({ _id: userId });
    await require('../app/utils/userRedisPurge').purgeUserKeysStrict(String(userId));
    fake.hold.release();
    await c.settle();
    expect(redis.store.has(keyOf(userId))).toBe(false);
  });

  it('control: with no purge in the window the same held refresh fills the cache', async () => {
    const userId = await seedUser();
    fake.hold = deferred();
    const c = connect(userId);
    c.toggle(true);
    while (recommendations().length === 0) await new Promise((r) => setImmediate(r));
    fake.hold.release();
    await c.settle();
    expect(cachedIds(userId).length).toBeGreaterThan(0);
  });
});

// ── RA-4: the refresh's early returns ────────────────────────────────────────────────────────────

describe('the refresh sends nothing when it has nothing to ask (RA-4)', () => {
  it('a known-403 hour sends nothing, reads no user and no profile, and records no attempt', async () => {
    const userId = await seedUser();
    spotify.markDiscoveryUnavailable();
    await connect(userId).liveMode(true);
    expect(discoveryRequests()).toEqual([]);
    expect(userFind).not.toHaveBeenCalled();
    expect(profileFind).not.toHaveBeenCalled();
    expect(redis.store.has(keyOf(userId))).toBe(false);
    // the hour over, the next opening refreshes
    spotify._resetArtistGenresCache();
    await connect(userId).liveMode(true);
    expect(recommendations()).toHaveLength(1);
  });

  it('no Spotify token sends nothing and reads no profile', async () => {
    const userId = await seedUser({ spotifyLinked: false });
    await connect(userId).liveMode(true);
    expect(discoveryRequests()).toEqual([]);
    expect(profileFind).not.toHaveBeenCalled();
  });

  it('a YouTube-only user sends nothing and reads no profile', async () => {
    const userId = await seedUser({ spotifyLinked: false, youtubeLinked: true });
    await connect(userId).liveMode(true);
    expect(discoveryRequests()).toEqual([]);
    expect(profileFind).not.toHaveBeenCalled();
  });

  it('a user that no longer exists sends nothing and reads no profile', async () => {
    const userId = await seedUser();
    await User.deleteOne({ _id: userId });
    await connect(userId).liveMode(true);
    expect(discoveryRequests()).toEqual([]);
    expect(profileFind).not.toHaveBeenCalled();
  });

  it('no profile sends nothing', async () => {
    const userId = await seedUser({ profile: null });
    await connect(userId).liveMode(true);
    expect(profileFind).toHaveBeenCalledTimes(1);
    expect(discoveryRequests()).toEqual([]);
  });

  it('no top genres sends nothing and asks for no token', async () => {
    const userId = await seedUser({ profile: { topGenres: [], library: [] } });
    const token = jest.spyOn(spotify, 'getValidToken');
    await connect(userId).liveMode(true);
    expect(discoveryRequests()).toEqual([]);
    expect(token).not.toHaveBeenCalled();
  });

  it('control: the same user with top genres sends the one request', async () => {
    const userId = await seedUser();
    await connect(userId).liveMode(true);
    expect(recommendations()).toHaveLength(1);
  });
});

// ── RA-1 (3): the profile read is projected to what the refresh uses ─────────────────────────────

describe('the refresh reads only the profile fields it uses', () => {
  it('projects the read, and the projected profile still drops a YouTube row before the query', async () => {
    const userId = await seedUser({
      profile: {
        // the stored top genres lead with a YouTube-derived one; withoutYoutube re-derives them
        topGenres: ['yt-genre', 'pop', 'indie'],
        topArtists: ['A', 'B'],
        genreSet: ['pop', 'yt-genre'],
        library: [
          { id: 'yt1', provider: 'youtube_music', name: 'Video', artist: 'YT Artist', genres: ['yt-genre'], uri: 'youtube:yt1' },
          // known as YouTube by its provider alone (no youtube: key), so the projection must keep provider
          { id: 'yt2', provider: 'youtube_music', name: 'Video 2', artist: 'YT Artist', genres: ['yt-genre'] },
          { id: 'yt3', provider: 'youtube_music', name: 'Video 3', artist: 'YT Artist', genres: ['yt-genre'] },
          { id: 'fam1', provider: 'spotify', name: 'Familiar 1', artist: 'Fam Artist', genres: ['pop', 'indie'], uri: 'spotify:track:fam1', affinity: 3 },
        ],
      },
    });
    await connect(userId).liveMode(true);
    expect(profileFind).toHaveBeenCalledTimes(1);
    const projection = profileFind.mock.calls[0][1];
    expect(projection).toBeTruthy();
    // the read Mongo answers to that projection holds no field the refresh does not use
    const doc = await MusicProfile.findOne({ userId }, projection).lean();
    expect(Object.keys(doc).sort()).toEqual(expect.not.arrayContaining(['topArtists', 'lastAnalyzed', 'createdAt', 'updatedAt']));
    for (const row of doc.library) {
      expect(row).not.toHaveProperty('name');
      expect(row).not.toHaveProperty('affinity');
      expect(row).not.toHaveProperty('id');
    }
    // and the query sent is the YouTube-free one: no yt-genre, the Spotify row's genres
    const sent = axios.get.mock.calls.find(([u]) => String(u).endsWith('/recommendations'))[1].params;
    expect(String(sent.seed_genres)).not.toMatch(/yt-genre/);
    expect(String(sent.seed_genres)).toMatch(/pop/);
  });
});
