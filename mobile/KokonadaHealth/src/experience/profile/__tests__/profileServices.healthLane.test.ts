// A module, not a script: this suite only require()s at run time, and without a top-level import
// or export TypeScript would merge its helpers into the global scope of every other such suite.
export {};

// H2-7 — logout and account deletion STOP the live heart-rate feed, inside the existing teardown.
//
// Before H2 nothing could stop the feed: the session handle was thrown away, so after logout the
// Health Connect fallback kept polling and its next reading refilled the warm store AFTER
// resetWarm — the next account signed in on the same phone saw the previous account's heart rate.
//
// This drives the REAL prod composition (profileServices → ProfileController → wipeLocalSession →
// the real health lane → startBiometrics → startLiveHr → the REST fallback) over stateful fakes of
// the outside world: Health Connect (a grant list and a read a test can hold open), the Keychain
// (slots by service, so a wipe is a real absence), and the backend (a fake fetch). Only the
// native-heavy playback graph is a recorder — every suite mocks it — and it logs its teardown
// steps into the same event log as the credential wipes, so ORDER is asserted on real calls.

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 31 },
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    check: jest.fn(async () => false),
    requestMultiple: jest.fn(),
  },
}));

const mockEvents: string[] = [];
jest.mock('../../playback/playbackServices', () => ({
  player: { dispose: jest.fn(async () => { mockEvents.push('player-disposed'); }) },
  kokoSocket: { disconnect: jest.fn(() => { mockEvents.push('socket-severed'); }) },
}));

// Health Connect: linked, and the fallback's read can be held open to model a reading in flight.
let mockReadRelease: ((hr: number) => void) | null = null;
jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => [{ accessType: 'read', recordType: 'HeartRate' }]),
  requestPermission: jest.fn(),
  readRecords: jest.fn(() => new Promise((resolve) => {
    mockReadRelease = (hr: number) => resolve({
      records: [{ samples: [{ time: new Date().toISOString(), beatsPerMinute: hr }] }],
    });
  })),
}));

const WATCH_SLOT = 'com.kokonadahealth.watchToken';
const mockSlots = new Map<string, string>();
let mockLaneStatus: () => string = () => 'unknown';
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
    (mockSlots.has(service) ? { password: mockSlots.get(service) } : false)),
  setGenericPassword: jest.fn(async (_u: string, password: string, { service }: { service: string }) => {
    mockSlots.set(service, password);
    return true;
  }),
  resetGenericPassword: jest.fn(async ({ service }: { service: string }) => {
    if (service === 'com.kokonadahealth.watchToken') mockEvents.push(`watch-credential-wiped (lane ${mockLaneStatus()})`);
    mockSlots.delete(service);
    return true;
  }),
}));

function installFakeBackend(): void {
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (path === '/api/consent/status') return json(200, { granted: true, currentVersion: 1, staleVersion: false });
    if (method === 'POST' && path === '/api/integrations/watch/token') return json(201, { token: 'whr_account_a' });
    if (method === 'POST' && path === '/api/integrations/watch/hr') return json(202, { ok: true });
    if (method === 'POST' && path === '/api/auth/logout') return json(200, {});
    if (method === 'DELETE' && path === '/api/auth/account') return json(200, { deleted: true });
    return json(404, {});
  });
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

function load() {
  jest.resetModules();
  const { profileController } = require('../profileServices');
  const { healthLane, onWearableLinked } = require('../../../health/healthLaneServices');
  const { warmStore } = require('../../../state/store');
  const { currentUserStore } = require('../../../auth/currentUser');
  mockLaneStatus = () => healthLane.status();
  currentUserStore.getState().setUser({ id: 'account-a', displayName: 'A', email: 'a@x.io' });
  // Account A links a wearable on this phone (the explicit action that opens the lane for A).
  const linkWearable = () => onWearableLinked();
  return { profileController, healthLane, warmStore, linkWearable };
}

let lane: { stop: () => Promise<void> } | null = null;

beforeEach(() => {
  installFakeBackend();
  mockEvents.length = 0;
  mockSlots.clear();
  mockReadRelease = null;
});

afterEach(async () => {
  if (lane) await lane.stop();
  lane = null;
});

describe.each([
  ['logout', (c: any) => c.logout()],
  ['account deletion', (c: any) => c.deleteAccount()],
])('%s stops live heart rate inside the existing teardown', (_name, signOut) => {
  it('the feed is stopped BEFORE the credential is wiped, and the socket is still severed first', async () => {
    const w = load();
    lane = w.healthLane;
    await w.linkWearable();
    expect(w.healthLane.status()).toBe('running');

    await signOut(w.profileController);

    expect(w.healthLane.status()).toBe('idle');
    const wipe = mockEvents.find((e) => e.startsWith('watch-credential-wiped'));
    expect(wipe).toBe('watch-credential-wiped (lane idle)');
    expect(mockEvents[0]).toBe('socket-severed'); // the teardown order itself is unchanged
    expect(mockSlots.has(WATCH_SLOT)).toBe(false);
  });

  it('a reading still in flight at sign-out never lands in the warm store the next account inherits', async () => {
    const w = load();
    lane = w.healthLane;
    await w.linkWearable();
    await settle();
    expect(mockReadRelease).not.toBeNull(); // the fallback's first read is in flight

    await signOut(w.profileController);
    mockReadRelease!(96); // account A's reading arrives after the wipe
    await settle();

    expect(w.warmStore.getState().liveHr).toBeNull();
    expect(w.warmStore.getState().biometricSource).toBe('none');
  });
});
