// A module, not a script: this suite only require()s at run time, and without a top-level import
// or export TypeScript would merge its helpers into the global scope of every other such suite.
export {};

// H2 — the production ignition (prodBootstrap) against a FAKE BACKEND, not mocked internals.
//
// What runs for real: AuthSession (tokens from the jest Keychain fake), the shared apiClient, the
// consent client, the health lane and its live-HR chain (startBiometrics → startLiveHr →
// getWatchToken), the live-HR switch, the real SecureStore class and every store. What is replaced:
// the native-heavy playback graph (a recording player + socket), the encrypted-store factory (a real
// SecureStore over an in-memory encrypted backend, or none), the Health Connect sync (a recorder),
// and the device (a stateful Health Connect grant list and an Android platform). The backend is a
// stateful fake `fetch` that answers by path and logs every request, so the assertions are about
// what actually leaves the device — and in what order.

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
const mockHc = { granted: [] as unknown[] };
jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => mockHc.granted),
  requestPermission: jest.fn(),
  readRecords: jest.fn(async () => ({ records: [] })),
}));

interface FakeBackend {
  spotifyConnected: boolean;
  consent: { granted: boolean; staleVersion: boolean };
  requests: Array<{ method: string; path: string }>;
}

let backend: FakeBackend;

function installFakeBackend(): void {
  backend = { spotifyConnected: false, consent: { granted: false, staleVersion: false }, requests: [] };
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    backend.requests.push({ method, path });
    mockEvents.push(`${method} ${path}`);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    const current = backend.consent.granted && !backend.consent.staleVersion;
    if (path === '/api/auth/me') return json(200, { id: 'u1', displayName: 'Dan', email: 'd@x.io' });
    if (path === '/api/integrations/status') return json(200, { spotifyConnected: backend.spotifyConnected });
    if (path === '/api/consent/status') return json(200, { ...backend.consent, currentVersion: 1 });
    if (method === 'POST' && path === '/api/integrations/watch/token') {
      return current ? json(201, { token: 'whr_minted' }) : json(403, { error: 'consent_required' });
    }
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

let lane: { stop: () => Promise<void> } | null = null;

// Fresh module graph per test: prodBootstrap holds singletons (session, current user, stores, lane).
function load(opts: { signedIn: boolean }) {
  jest.resetModules();
  const Keychain = require('react-native-keychain');
  Keychain.getGenericPassword.mockImplementation(async ({ service }: { service: string }) =>
    opts.signedIn && service === 'com.kokonadahealth.session'
      ? { password: JSON.stringify({ access: 'access-1', refresh: 'refresh-1' }) }
      : false);
  const prod = require('../prodBootstrap');
  const { player } = require('../experience/playback/playbackServices');
  const { syncMedicalProfile } = require('../health/healthSync');
  const { requestMultiple } = require('react-native').PermissionsAndroid;
  const services = require('../health/healthLaneServices');
  const { currentUserStore } = require('../auth/currentUser');
  lane = services.healthLane;
  return { prod, player, syncMedicalProfile, requestMultiple, healthLane: services.healthLane, currentUserStore };
}

beforeEach(() => {
  installFakeBackend();
  mockSecure = null;
  mockEvents.length = 0;
  mockHc.granted = [];
});

afterEach(async () => {
  // Stop any lane a test left running so the fallback's 3-minute interval never outlives it.
  if (lane) await lane.stop();
  lane = null;
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

  it('onSignedIn never connects the player', async () => {
    const { prod, player } = load({ signedIn: true });
    backend.spotifyConnected = true;
    await prod.onSignedIn();
    await settle();
    expect(player.connect).not.toHaveBeenCalled();
  });
});

describe('prodBootstrap — the health lane at boot and sign-in (H2)', () => {
  it('signed-out boot: no consent read, no whr_ mint, no Health Connect sync', async () => {
    const { prod, syncMedicalProfile } = load({ signedIn: false });
    mockHc.granted = [{ accessType: 'read', recordType: 'HeartRate' }]; // a device-level grant must not matter
    backend.consent = { granted: true, staleVersion: false };
    await prod.startApp();
    await settle();
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
    expect(syncMedicalProfile).not.toHaveBeenCalled();
  });

  it('signed-in, mood-only (no wearable link): no health request leaves the device, no prompt, and the boot sync does not run', async () => {
    const { prod, syncMedicalProfile, requestMultiple, healthLane } = load({ signedIn: true });
    backend.consent = { granted: true, staleVersion: false }; // even a server grant must not matter
    await prod.startApp();
    await settle();
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
    expect(syncMedicalProfile).not.toHaveBeenCalled();
    expect(requestMultiple).not.toHaveBeenCalled();
    expect(healthLane.status()).toBe('idle');
  });

  it('signed-in, linked + a current grant: one consent read, one whr_ mint, then the boot sync — never a prompt', async () => {
    const { prod, syncMedicalProfile, requestMultiple, healthLane } = load({ signedIn: true });
    mockHc.granted = [{ accessType: 'read', recordType: 'HeartRate' }];
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
  ])('signed-in, linked, but %s: no mint, and the boot sync does not run', async (_l, consent) => {
    const { prod, syncMedicalProfile, healthLane } = load({ signedIn: true });
    mockHc.granted = [{ accessType: 'read', recordType: 'HeartRate' }];
    backend.consent = consent;
    await prod.startApp();
    await settle();
    expect(hits('/api/consent/status')).toBe(1);
    expect(hits('/api/integrations/watch/token')).toBe(0);
    expect(syncMedicalProfile).not.toHaveBeenCalled();
    expect(healthLane.status()).toBe('idle');
  });

  it('a Disconnect from an earlier session (the durable switch in the encrypted store) keeps live HR off — the Art.9 sync still runs', async () => {
    mockSecure = makeSecureStore({ 'koko.liveHr.u1.off': '1' });
    const { prod, syncMedicalProfile, healthLane } = load({ signedIn: true });
    mockHc.granted = [{ accessType: 'read', recordType: 'HeartRate' }];
    backend.consent = { granted: true, staleVersion: false };
    await prod.startApp();
    await settle();
    expect(hits('/api/integrations/watch/token')).toBe(0);
    expect(healthLane.status()).toBe('idle');
    expect(syncMedicalProfile).toHaveBeenCalledTimes(1);
  });

  it('onSignedIn, linked + a current grant: starts the lane once (one consent read, one mint)', async () => {
    const { prod, healthLane, currentUserStore } = load({ signedIn: true });
    currentUserStore.getState().setUser({ id: 'u1', displayName: 'Dan', email: 'd@x.io' });
    mockHc.granted = [{ accessType: 'read', recordType: 'HeartRate' }];
    backend.consent = { granted: true, staleVersion: false };
    await prod.onSignedIn();
    await settle();
    expect(hits('/api/consent/status')).toBe(1);
    expect(hits('/api/integrations/watch/token')).toBe(1);
    expect(healthLane.status()).toBe('running');
  });

  it('onSignedIn, mood-only: no health request leaves the device', async () => {
    const { prod, currentUserStore } = load({ signedIn: true });
    currentUserStore.getState().setUser({ id: 'u1', displayName: 'Dan', email: 'd@x.io' });
    await prod.onSignedIn();
    await settle();
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]);
  });
});
