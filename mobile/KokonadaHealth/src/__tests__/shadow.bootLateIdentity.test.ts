// A module, not a script: this suite only require()s at run time, and without a top-level import
// or export TypeScript would merge its helpers into the global scope of every other such suite.
export {};

// PR #309 review (shadow), RA-4 (S0) and RA-3 (S2): the boot's GET /api/auth/me has no deadline of its
// own, and the splash stops waiting for startApp after 8 s (AppFlow's SPLASH_DEADLINE_MS), so the user
// can sign in as ANOTHER account while A's /me is still in flight. When it landed it set A's identity
// over B's session (the health lane then read A's wearable link and minted a whr_ credential on B's
// token), and ran bootstrapApp's session steps a second time (a second cold-persistence writer, a
// second socket and player gate). Whoever signed in meanwhile owns the session: the late boot sets no
// identity and starts nothing. The real ignition runs over a stateful fake backend and Keychain; only
// the native playback graph, the encrypted-store factory and the Health Connect sync are replaced.

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 31 },
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    check: jest.fn(async () => false),
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
jest.mock('../health/healthSync', () => ({ syncMedicalProfile: jest.fn(async () => ({ synced: false, reason: 'no-data' })) }));
jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => [{ accessType: 'read', recordType: 'HeartRate' }]),
  requestPermission: jest.fn(),
  readRecords: jest.fn(async () => ({ records: [] })),
}));

const SESSION_SLOT = 'com.kokonadahealth.session';
const keychainSlots = new Map<string, string>();
const ACCOUNT_A = { id: 'account-a', displayName: 'A', email: 'a@x.io' };
const ACCOUNT_B = { id: 'account-b', displayName: 'B', email: 'b@x.io' };
const HEALTH_PATHS = ['/api/consent/status', '/api/integrations/watch/token', '/api/integrations/watch/hr'];

let requests: Array<{ method: string; path: string; auth: string | null }> = [];
let releaseBootMe: ((answer: { status: number; body?: unknown }) => void) | null = null;
const hits = (path: string) => requests.filter((r) => r.path === path).length;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

function installFakeBackend(): void {
  requests = [];
  releaseBootMe = null;
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const auth = init.headers?.Authorization ?? null;
    requests.push({ method, path, auth });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (path === '/api/auth/me') {
      if (auth === 'Bearer access-a') { // A's stored session at boot: held until the test answers it
        const { status, body } = await new Promise<{ status: number; body?: unknown }>((r) => { releaseBootMe = r; });
        return json(status, body ?? { error: 'x' });
      }
      return json(200, ACCOUNT_B);
    }
    if (path === '/api/integrations/status') return json(200, { spotifyConnected: true });
    if (path === '/api/consent/status') return json(200, { granted: true, staleVersion: false, currentVersion: 1 });
    if (method === 'POST' && path === '/api/integrations/watch/token') return json(201, { token: 'whr_minted' });
    if (method === 'POST' && path === '/api/integrations/watch/hr') return json(202, { ok: true });
    return json(404, { error: 'not found' });
  });
}

// A real SecureStore over an in-memory encrypted backend, recording every write by key.
function makeSecureStore(seed: Record<string, string>, writes: string[]) {
  const { SecureStore } = require('../storage/secureStore');
  const map = new Map<string, string>(Object.entries(seed));
  return new SecureStore({
    backend: {
      encrypted: true,
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => { writes.push(k); map.set(k, v); },
      delete: (k: string) => { map.delete(k); },
      getAllKeys: () => [...map.keys()],
      clearAll: () => map.clear(),
    },
    cipher: { encrypt: (v: string) => v, decrypt: (v: string) => v },
  });
}

function load() {
  jest.resetModules();
  const Keychain = require('react-native-keychain');
  keychainSlots.set(SESSION_SLOT, JSON.stringify({ access: 'access-a', refresh: 'refresh-a' })); // A's session on the phone
  Keychain.getGenericPassword.mockImplementation(async ({ service }: { service: string }) =>
    (keychainSlots.has(service) ? { password: keychainSlots.get(service) } : false));
  Keychain.setGenericPassword.mockImplementation(async (_u: string, password: string, { service }: { service: string }) => {
    keychainSlots.set(service, password);
    return true;
  });
  Keychain.resetGenericPassword.mockImplementation(async ({ service }: { service: string }) => { keychainSlots.delete(service); return true; });
  const { liveHrLinkKey } = require('../health/liveHrSwitch');
  const writes: string[] = [];
  mockSecure = makeSecureStore({ [liveHrLinkKey(ACCOUNT_A.id)]: 'on' }, writes); // A linked a wearable on this phone
  const prod = require('../prodBootstrap');
  const { playbackSocket } = require('../experience/playback/playbackServices');
  const { syncMedicalProfile } = require('../health/healthSync');
  const { currentUserStore } = require('../auth/currentUser');
  const { authSession } = require('../auth/session');
  const { healthLane } = require('../health/healthLaneServices');
  const { store } = require('../state/store');
  const { setTextPrompt } = require('../state/cold/emotionSlice');
  // The sign-in screen's own sequence for B: the provider answers, the identity lands, then onSignedIn.
  const signInAsB = async () => {
    await authSession.setSession({ access: 'access-b', refresh: 'refresh-b' });
    currentUserStore.getState().setUser(ACCOUNT_B);
    await prod.onSignedIn();
  };
  return { prod, playbackSocket, syncMedicalProfile, currentUserStore, healthLane, store, setTextPrompt, signInAsB, writes };
}

let lane: { stop: () => Promise<void> } | null = null;

beforeEach(() => {
  installFakeBackend();
  keychainSlots.clear();
});

afterEach(async () => {
  if (lane) await lane.stop();
  lane = null;
  jest.useRealTimers();
});

describe('a late boot /me after a sign-in as another account (RA-4, RA-3)', () => {
  it.each([
    ['200 for account A', { status: 200, body: ACCOUNT_A }],
    ['503', { status: 503 }],
  ])('A\'s /me answers %s after B signed in: B stays the identity, and the boot starts nothing under B\'s session', async (_l, bootMe) => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const w = load();
    lane = w.healthLane;
    const booting = w.prod.startApp();
    for (let i = 0; i < 50 && !releaseBootMe; i++) await new Promise((r) => setImmediate(r));
    expect(releaseBootMe).not.toBeNull(); // A's /me is in flight

    await w.signInAsB(); // the splash gave up waiting: B signs in
    await settle();
    requests.length = 0;
    releaseBootMe!(bootMe); // A's /me lands late
    await booting;
    await settle();

    expect(w.currentUserStore.getState().user).toEqual(ACCOUNT_B);
    expect(w.playbackSocket.ensureConnected).toHaveBeenCalledTimes(1); // onSignedIn's, never the boot's
    expect(hits('/api/integrations/status')).toBe(0); // no player gate from the boot
    expect(HEALTH_PATHS.map(hits)).toEqual([0, 0, 0]); // A's link is never read for B's token
    expect(w.syncMedicalProfile).not.toHaveBeenCalled();

    // One cold-persistence writer, B's: one change is one write.
    w.writes.length = 0;
    w.store.dispatch(w.setTextPrompt('late boot'));
    jest.advanceTimersByTime(500);
    expect(w.writes.filter((k) => k === `cold.emotion.${ACCOUNT_B.id}`)).toHaveLength(1);
  });
});
