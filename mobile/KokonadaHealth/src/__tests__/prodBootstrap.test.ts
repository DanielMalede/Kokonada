// A module, not a script: this suite only require()s at run time, and without a top-level import
// or export TypeScript would merge its helpers into the global scope of every other such suite.
export {};

// H2 — the production ignition (prodBootstrap) against a FAKE BACKEND, not mocked internals.
//
// What runs for real: AuthSession (tokens from a stateful Keychain fake), the shared apiClient, the
// consent client, the health lane and its live-HR chain (startBiometrics → startLiveHr →
// getWatchToken), the live-HR switch, the real SecureStore class and every store. What is replaced:
// the native-heavy playback graph (a recording player + socket), the encrypted-store factory (a real
// SecureStore over an in-memory encrypted backend, or none), the Health Connect sync (a recorder),
// and the device (a stateful Health Connect grant list and an Android platform). The backend is a
// stateful fake `fetch` that answers by path and logs every request, so the assertions are about
// what actually leaves the device — and in what order, and on which credential.

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 31 },
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    check: jest.fn(async () => false), // no Bluetooth grant: the Health Connect fallback carries the feed
    requestMultiple: jest.fn(),
  },
}));
jest.mock('../experience/playback/playbackServices', () => ({
  player: { connect: jest.fn(async () => true) },
  playbackSocket: { ensureConnected: jest.fn() },
  orchestrator: { resume: jest.fn() },
}));
let mockSecure: unknown = null;
jest.mock('../storage/secureStoreFactory', () => ({
  createSecureStore: jest.fn(async () => {
    if (!mockSecure) throw new Error('no native MMKV in jest');
    return mockSecure;
  }),
}));
const mockEvents: string[] = [];
jest.mock('../health/healthSync', () => ({
  syncMedicalProfile: jest.fn(async () => { mockEvents.push('hc-sync'); return { synced: false, reason: 'no-data' }; }),
}));
const mockHc = { granted: [] as unknown[], records: [] as unknown[] };
jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => mockHc.granted),
  requestPermission: jest.fn(),
  readRecords: jest.fn(async () => ({ records: mockHc.records })),
}));

const SESSION_SLOT = 'com.kokonadahealth.session';
const WATCH_SLOT = 'com.kokonadahealth.watchToken';
const HC_GRANT = { accessType: 'read', recordType: 'HeartRate' };
// The Keychain, by service — it outlives a process the way the real one does.
const keychainSlots = new Map<string, string>();

interface FakeBackend {
  me: { id: string; displayName: string; email: string };
  spotifyConnected: boolean;
  consent: { granted: boolean; staleVersion: boolean };
  mints: number;
  requests: Array<{ method: string; path: string; auth: string | null }>;
}

let backend: FakeBackend;

function installFakeBackend(): void {
  backend = {
    me: { id: 'u1', displayName: 'Dan', email: 'd@x.io' },
    spotifyConnected: false,
    consent: { granted: false, staleVersion: false },
    mints: 0,
    requests: [],
  };
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const auth = init.headers?.Authorization ?? null;
    backend.requests.push({ method, path, auth });
    mockEvents.push(`${method} ${path}`);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    const current = backend.consent.granted && !backend.consent.staleVersion;
    if (path === '/api/auth/me') return json(200, backend.me);
    if (path === '/api/integrations/status') return json(200, { spotifyConnected: backend.spotifyConnected });
    if (path === '/api/consent/status') return json(200, { ...backend.consent, currentVersion: 1 });
    if (method === 'POST' && path === '/api/integrations/watch/token') {
      if (!current) return json(403, { error: 'consent_required' });
      backend.mints += 1;
      return json(201, { token: `whr_minted_${backend.mints}` });
    }
    if (method === 'POST' && path === '/api/integrations/watch/hr') return json(202, { ok: true });
    return json(404, { error: 'not found' });
  });
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const hits = (path: string) => backend.requests.filter((r) => r.path === path).length;
const HEALTH_PATHS = ['/api/consent/status', '/api/integrations/watch/token', '/api/integrations/watch/hr'];

// A REAL SecureStore over an in-memory encrypted backend (identity cipher), so the boot's KV
// bindings read and write through the same class production uses.
function makeSecureStore(seed: Record<string, string> = {}) {
  const { SecureStore } = require('../storage/secureStore');
  const map = new Map<string, string>(Object.entries(seed));
  return new SecureStore({
    backend: {
      encrypted: true,
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => { map.set(k, v); },
      delete: (k: string) => { map.delete(k); },
      getAllKeys: () => [...map.keys()],
      clearAll: () => map.clear(),
    },
    cipher: { encrypt: (v: string) => v, decrypt: (v: string) => v },
  });
}

// The encrypted disk of a phone on which the given accounts made an explicit wearable link earlier.
const linkedDisk = (links: Record<string, 'on' | 'off'>) => {
  const { liveHrLinkKey } = require('../health/liveHrSwitch');
  return makeSecureStore(Object.fromEntries(Object.entries(links).map(([uid, v]) => [liveHrLinkKey(uid), v])));
};

let lane: { stop: () => Promise<void> } | null = null;

// Fresh module graph per test (or per simulated process): prodBootstrap holds singletons (session,
// current user, stores, lane). The Keychain and the encrypted disk carry over, as they do on a phone.
function load(opts: { signedIn: boolean }) {
  jest.resetModules();
  const Keychain = require('react-native-keychain');
  if (opts.signedIn) keychainSlots.set(SESSION_SLOT, JSON.stringify({ access: 'access-1', refresh: 'refresh-1' }));
  else keychainSlots.delete(SESSION_SLOT);
  Keychain.getGenericPassword.mockImplementation(async ({ service }: { service: string }) =>
    (keychainSlots.has(service) ? { password: keychainSlots.get(service) } : false));
  Keychain.setGenericPassword.mockImplementation(async (_u: string, password: string, { service }: { service: string }) => {
    keychainSlots.set(service, password);
    return true;
  });
  Keychain.resetGenericPassword.mockImplementation(async ({ service }: { service: string }) => {
    keychainSlots.delete(service);
    return true;
  });
  const prod = require('../prodBootstrap');
  const { player, orchestrator } = require('../experience/playback/playbackServices');
  const { syncMedicalProfile } = require('../health/healthSync');
  const { requestMultiple } = require('react-native').PermissionsAndroid;
  const services = require('../health/healthLaneServices');
  const { currentUserStore } = require('../auth/currentUser');
  const { authSession } = require('../auth/session');
  const hc = require('react-native-health-connect');
  lane = services.healthLane;
  // The sign-in screen's own sequence: the provider answers, the identity lands, then onSignedIn.
  const signIn = async (id: string) => {
    await authSession.setSession({ access: `access-${id}`, refresh: `refresh-${id}` });
    currentUserStore.getState().setUser({ id, displayName: id, email: `${id}@x.io` });
    await prod.onSignedIn();
  };
  const watchReads = () => Keychain.getGenericPassword.mock.calls.filter(([o]: any[]) => o?.service === WATCH_SLOT).length;
  return { prod, player, orchestrator, syncMedicalProfile, requestMultiple, healthLane: services.healthLane, services, currentUserStore, authSession, signIn, hc, watchReads };
}

beforeEach(() => {
  installFakeBackend();
  mockSecure = null;
  mockEvents.length = 0;
  mockHc.granted = [];
  mockHc.records = [];
  keychainSlots.clear();
});

afterEach(async () => {
  // Stop any lane a test left running so the fallback's 3-minute interval never outlives it.
  if (lane) await lane.stop();
  lane = null;
  jest.useRealTimers();
});

describe('prodBootstrap — the Spotify player at boot (H2)', () => {
  it('signed-out boot: no Spotify connect and no integrations read', async () => {
    const { prod, player } = load({ signedIn: false });
    backend.spotifyConnected = true; // even a linked account on the server must not matter
    await prod.startApp();
    await settle();
    expect(player.connect).not.toHaveBeenCalled();
    expect(hits('/api/integrations/status')).toBe(0);
  });

  it('signed-in boot with Spotify linked on the server: connects exactly once', async () => {
    const { prod, player } = load({ signedIn: true });
    backend.spotifyConnected = true;
    await prod.startApp();
    await settle();
    expect(hits('/api/integrations/status')).toBe(1);
    expect(player.connect).toHaveBeenCalledTimes(1);
  });

  it('signed-in boot, Spotify NOT linked: never connects (no login screen at launch)', async () => {
    const { prod, player } = load({ signedIn: true });
    backend.spotifyConnected = false;
    await prod.startApp();
    await settle();
    expect(player.connect).not.toHaveBeenCalled();
  });

  // HX-2 B1: Disconnect Spotify suspends the playback conductor so a late playlist cannot reconnect
  // Spotify. A fresh sign-in (a new session, maybe a new account) lifts that — without connecting.
  it('onSignedIn lifts a Spotify-disconnect suspension (resume), and still does not connect', async () => {
    const { prod, player, orchestrator, signIn } = load({ signedIn: false });
    await prod.startApp();
    await signIn('u1');
    await settle();
    expect(orchestrator.resume).toHaveBeenCalledTimes(1);
    expect(player.connect).not.toHaveBeenCalled();
  });

  it('onSignedIn never connects the player', async () => {
    const { prod, player, signIn } = load({ signedIn: false });
    backend.spotifyConnected = true;
    await prod.startApp();
    await signIn('u1');
    await settle();
    expect(player.connect).not.toHaveBeenCalled();
  });
});

describe('prodBootstrap — the health lane at boot and sign-in (H2)', () => {
  it('signed-out boot: no consent read, no whr_ mint, no Health Connect sync', async () => {
    mockSecure = linkedDisk({ u1: 'on' });
    const { prod, syncMedicalProfile } = load({ signedIn: false });
    mockHc.granted = [HC_GRANT]; // a device-level grant must not matter
    backend.consent = { granted: true, staleVersion: false };
    await prod.startApp();
    await settle();
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
    expect(syncMedicalProfile).not.toHaveBeenCalled();
  });

  it('signed-in, mood-only (no wearable link): no health request leaves the device, no prompt, and the boot sync does not run', async () => {
    mockSecure = makeSecureStore();
    const { prod, syncMedicalProfile, requestMultiple, healthLane } = load({ signedIn: true });
    backend.consent = { granted: true, staleVersion: false }; // even a server grant must not matter
    await prod.startApp();
    await settle();
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
    expect(syncMedicalProfile).not.toHaveBeenCalled();
    expect(requestMultiple).not.toHaveBeenCalled();
    expect(healthLane.status()).toBe('idle');
  });

  it('signed-in, linked here + a current grant: one consent read, one whr_ mint, then the boot sync — never a prompt', async () => {
    mockSecure = linkedDisk({ u1: 'on' });
    const { prod, syncMedicalProfile, requestMultiple, healthLane } = load({ signedIn: true });
    mockHc.granted = [HC_GRANT];
    backend.consent = { granted: true, staleVersion: false };
    await prod.startApp();
    await settle();
    expect(hits('/api/consent/status')).toBe(1);
    expect(hits('/api/integrations/watch/token')).toBe(1);
    expect(healthLane.status()).toBe('running');
    expect(syncMedicalProfile).toHaveBeenCalledTimes(1);
    // The sync reads and uploads Art.9 data, so it waits for the gate's answer.
    expect(mockEvents.indexOf('hc-sync')).toBeGreaterThan(mockEvents.indexOf('GET /api/consent/status'));
    expect(requestMultiple).not.toHaveBeenCalled();
  });

  it.each([
    ['no grant on file', { granted: false, staleVersion: false }],
    ['a stale grant', { granted: true, staleVersion: true }],
  ])('signed-in, linked here, but %s: no mint, and the boot sync does not run', async (_l, consent) => {
    mockSecure = linkedDisk({ u1: 'on' });
    const { prod, syncMedicalProfile, healthLane } = load({ signedIn: true });
    mockHc.granted = [HC_GRANT];
    backend.consent = consent;
    await prod.startApp();
    await settle();
    expect(hits('/api/consent/status')).toBe(1);
    expect(hits('/api/integrations/watch/token')).toBe(0);
    expect(syncMedicalProfile).not.toHaveBeenCalled();
    expect(healthLane.status()).toBe('idle');
  });

  it('a Disconnect from an earlier session (the durable switch in the encrypted store) keeps live HR off — the Art.9 sync still runs', async () => {
    mockSecure = linkedDisk({ u1: 'off' });
    const { prod, syncMedicalProfile, healthLane } = load({ signedIn: true });
    mockHc.granted = [HC_GRANT];
    backend.consent = { granted: true, staleVersion: false };
    await prod.startApp();
    await settle();
    expect(hits('/api/integrations/watch/token')).toBe(0);
    expect(healthLane.status()).toBe('idle');
    expect(syncMedicalProfile).toHaveBeenCalledTimes(1);
  });

  it('onSignedIn, linked here + a current grant: starts the lane once (one consent read, one mint)', async () => {
    mockSecure = linkedDisk({ u1: 'on' });
    const { prod, healthLane, signIn } = load({ signedIn: false });
    mockHc.granted = [HC_GRANT];
    backend.consent = { granted: true, staleVersion: false };
    await prod.startApp();
    await signIn('u1');
    await settle();
    expect(hits('/api/consent/status')).toBe(1);
    expect(hits('/api/integrations/watch/token')).toBe(1);
    expect(healthLane.status()).toBe('running');
  });

  it('onSignedIn, mood-only: no health request leaves the device', async () => {
    mockSecure = makeSecureStore();
    const { prod, signIn } = load({ signedIn: false });
    await prod.startApp();
    await signIn('u1');
    await settle();
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
  });
});

// Review H2-C1 through the real ignition: the phone holds account A's Health Connect grant and A's
// link; account B, holding a current Art.9 grant given on ANOTHER phone, signs in here. Nothing
// health-related may happen for B — not at sign-in, and not at B's next boot, whose Health Connect
// history sync would otherwise upload this phone's data to B.
describe('prodBootstrap — account B on the phone where account A linked (review H2-C1)', () => {
  it('B signs in: no consent read, no mint, no credential read, no Health Connect read — and B\'s next boot runs no sync', async () => {
    mockSecure = linkedDisk({ 'account-a': 'on' });
    mockHc.granted = [HC_GRANT];
    mockHc.records = [{ samples: [{ time: new Date().toISOString(), beatsPerMinute: 70 }] }];
    backend.consent = { granted: true, staleVersion: false };

    // Process 1: a signed-out launch, then B signs in.
    const first = load({ signedIn: false });
    await first.prod.startApp();
    await first.signIn('account-b');
    await settle();
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
    expect(first.watchReads()).toBe(0);
    expect(first.hc.readRecords).not.toHaveBeenCalled();
    expect(first.healthLane.status()).toBe('idle');

    // Process 2: B's stored session boots the app.
    backend.me = { id: 'account-b', displayName: 'B', email: 'b@x.io' };
    const second = load({ signedIn: true });
    await second.prod.startApp();
    await settle();
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
    expect(second.watchReads()).toBe(0);
    expect(second.hc.readRecords).not.toHaveBeenCalled();
    expect(second.syncMedicalProfile).not.toHaveBeenCalled();
    expect(second.healthLane.status()).toBe('idle');
  });
});

// The class the review names, one step further: whatever an EARLIER identity left behind on this
// phone must not carry the next account's readings. A session can die without a logout (a revoked
// refresh family: the socket's auth-expired path and the boot's dead-token path only clear the session
// pair), so the logout teardown that stops the feed and wipes the whr_ credential never ran. The
// credential belongs to the account it was minted for; the Keychain slot belongs to the phone.
describe('prodBootstrap — a fresh sign-in starts the health lane from nothing (identity boundary)', () => {
  const current = { granted: true, staleVersion: false };
  const pushesOn = (token: string) =>
    backend.requests.filter((r) => r.path === '/api/integrations/watch/hr' && r.auth === `Bearer ${token}`).length;

  it('a feed still running on account A\'s credential is stopped when B signs in, and B\'s readings ride only a credential minted for B', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const { FALLBACK_INTERVAL_MS } = require('../health/restFallback');
    mockSecure = linkedDisk({ 'account-a': 'on', 'account-b': 'on' }); // both linked this phone before
    mockHc.granted = [HC_GRANT];
    mockHc.records = [{ samples: [{ time: new Date().toISOString(), beatsPerMinute: 70 }] }];
    backend.consent = current;
    backend.me = { id: 'account-a', displayName: 'A', email: 'a@x.io' };

    const w = load({ signedIn: true });
    await w.prod.startApp();
    await settle();
    expect(pushesOn('whr_minted_1')).toBe(1); // A's feed is live on A's credential

    await w.authSession.clear(); // A's session dies — no logout, no teardown
    await w.signIn('account-b');
    await settle();

    expect(backend.mints).toBe(2); // B gets a credential of its own
    expect(keychainSlots.get(WATCH_SLOT)).toBe('whr_minted_2');
    const aBefore = pushesOn('whr_minted_1');
    await jest.advanceTimersByTimeAsync(FALLBACK_INTERVAL_MS * 3);
    await settle();
    expect(pushesOn('whr_minted_1')).toBe(aBefore); // A's feed is gone for good
    expect(pushesOn('whr_minted_2')).toBeGreaterThan(0);
    expect(w.healthLane.status()).toBe('running');
  });

  it('a credential account A left in the Keychain (its session died, so nothing wiped it) is never used for B', async () => {
    mockSecure = linkedDisk({ 'account-b': 'on' });
    mockHc.granted = [HC_GRANT];
    mockHc.records = [{ samples: [{ time: new Date().toISOString(), beatsPerMinute: 70 }] }];
    backend.consent = current;
    keychainSlots.set(WATCH_SLOT, 'whr_account_a');

    const w = load({ signedIn: false }); // the boot found A's session dead and landed on SignIn
    await w.prod.startApp();
    await w.signIn('account-b');
    await settle();

    expect(pushesOn('whr_account_a')).toBe(0);
    expect(backend.mints).toBe(1);
    expect(keychainSlots.get(WATCH_SLOT)).toBe('whr_minted_1');
    expect(pushesOn('whr_minted_1')).toBe(1);
  });

  it('B with no link here: A\'s running feed and A\'s credential are both gone, and nothing is minted', async () => {
    mockSecure = linkedDisk({ 'account-a': 'on' });
    mockHc.granted = [HC_GRANT];
    backend.consent = current;
    backend.me = { id: 'account-a', displayName: 'A', email: 'a@x.io' };

    const w = load({ signedIn: true });
    await w.prod.startApp();
    await settle();
    expect(w.healthLane.status()).toBe('running');

    await w.authSession.clear();
    backend.requests.length = 0;
    await w.signIn('account-b');
    await settle();

    expect(w.healthLane.status()).toBe('idle');
    expect(keychainSlots.has(WATCH_SLOT)).toBe(false);
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
  });
});
