// H2-4 — the PRODUCTION health lane: the real createHealthLane wired to the real consent client,
// the real startBiometrics → startLiveHr → getWatchToken chain, the real warm store and the real
// live-HR switch. What is faked is only the outside world, and every fake is STATEFUL:
//   • Health Connect — a grant list a test sets, initialise/read calls recorded;
//   • the OS Bluetooth grant table — `check` answers from it; `requestMultiple` must never run;
//   • the Keychain — a slot map keyed by service, so "the credential is forgotten" is a real absence;
//   • the backend — a fake fetch that answers by path from its own consent state, mints a whr_ only
//     for a current grant (like the S1 server gate), and logs every request that leaves the device.

const mockPlatform = { OS: 'android', Version: 31 as number | string };
const mockBleGrants = new Map<string, boolean>();
jest.mock('react-native', () => ({
  get Platform() { return mockPlatform; },
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    check: jest.fn(async (p: string) => mockBleGrants.get(p) === true),
    requestMultiple: jest.fn(),
  },
}));

const mockHc = { initialized: true, initThrows: false, granted: [] as unknown[], grantsThrow: false };
jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn(async () => {
    if (mockHc.initThrows) throw new Error('health connect binder died');
    return mockHc.initialized;
  }),
  getGrantedPermissions: jest.fn(async () => {
    if (mockHc.grantsThrow) throw new Error('grant table unreadable');
    return mockHc.granted;
  }),
  requestPermission: jest.fn(),
  readRecords: jest.fn(async () => ({ records: [] })),
}));

const mockSlots = new Map<string, string>();
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
    (mockSlots.has(service) ? { password: mockSlots.get(service) } : false)),
  setGenericPassword: jest.fn(async (_u: string, password: string, { service }: { service: string }) => {
    mockSlots.set(service, password);
    return true;
  }),
  resetGenericPassword: jest.fn(async ({ service }: { service: string }) => { mockSlots.delete(service); return true; }),
}));

const mockBleManagers: Array<{ destroy: jest.Mock }> = [];
jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => {
    const m = { startDeviceScan: jest.fn(), stopDeviceScan: jest.fn(), destroy: jest.fn() };
    mockBleManagers.push(m);
    return m;
  }),
}));

const WATCH_SLOT = 'com.kokonadahealth.watchToken';
const HC_GRANT = { accessType: 'read', recordType: 'HeartRate' };

interface FakeBackend {
  consent: { granted: boolean; staleVersion: boolean };
  mints: number;
  requests: Array<{ method: string; path: string }>;
}
let backend: FakeBackend;

function installFakeBackend(): void {
  backend = { consent: { granted: false, staleVersion: false }, mints: 0, requests: [] };
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    backend.requests.push({ method, path });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    const current = backend.consent.granted && !backend.consent.staleVersion;
    if (method === 'GET' && path === '/api/consent/status') {
      return json(200, { ...backend.consent, currentVersion: 1 });
    }
    if (method === 'POST' && path === '/api/integrations/watch/token') {
      if (!current) return json(403, { error: 'consent_required' });
      backend.mints += 1;
      return json(201, { token: `whr_minted_${backend.mints}` });
    }
    if (method === 'POST' && path === '/api/integrations/watch/hr') return json(202, { ok: true });
    return json(404, { error: 'not found' });
  });
}

const hits = (method: string, path: string) =>
  backend.requests.filter((r) => r.method === method && r.path === path).length;

// A fresh module graph per test: the lane, the switch and the stores are module singletons.
function load() {
  jest.resetModules();
  const svc = require('../healthLaneServices');
  const { currentUserStore } = require('../../auth/currentUser');
  const { warmStore } = require('../../state/store');
  const { liveHrSwitch } = require('../liveHrSwitch');
  const rn = require('react-native');
  const hc = require('react-native-health-connect');
  const { BleManager } = require('react-native-ble-plx');
  const signIn = (id: string) => currentUserStore.getState().setUser({ id, displayName: id, email: `${id}@x.io` });
  return { svc, warmStore, liveHrSwitch, signIn, requestMultiple: rn.PermissionsAndroid.requestMultiple as jest.Mock, hc, BleManager: BleManager as jest.Mock };
}

let running: { stop: () => Promise<void> } | null = null;

beforeEach(() => {
  installFakeBackend();
  mockPlatform.OS = 'android';
  mockPlatform.Version = 31;
  mockBleGrants.clear();
  mockHc.initialized = true;
  mockHc.initThrows = false;
  mockHc.granted = [];
  mockHc.grantsThrow = false;
  mockSlots.clear();
  mockBleManagers.length = 0;
});

afterEach(async () => {
  // Stop whatever lane a test left running, so the fallback's 3-minute interval never outlives it.
  if (running) await running.stop();
  running = null;
});

describe('hasHealthConnectLink — the wearable opt-in signal, read without any UI', () => {
  it('true only when Health Connect initialises AND holds at least one grant for Kokonada', async () => {
    const { svc } = load();
    mockHc.granted = [HC_GRANT];
    await expect(svc.hasHealthConnectLink()).resolves.toBe(true);
  });

  it('no grant (a mood-only account) → false', async () => {
    const { svc } = load();
    await expect(svc.hasHealthConnectLink()).resolves.toBe(false);
  });

  it('Health Connect does not initialise → false, and the grant table is never read', async () => {
    const { svc, hc } = load();
    mockHc.initialized = false;
    mockHc.granted = [HC_GRANT];
    await expect(svc.hasHealthConnectLink()).resolves.toBe(false);
    expect(hc.getGrantedPermissions).not.toHaveBeenCalled();
  });

  it.each([
    ['initialise throws', () => { mockHc.initThrows = true; }],
    ['the grant read throws', () => { mockHc.grantsThrow = true; }],
  ])('%s → false, never throws', async (_label, arrange) => {
    const { svc } = load();
    mockHc.granted = [HC_GRANT];
    arrange();
    await expect(svc.hasHealthConnectLink()).resolves.toBe(false);
  });

  it('not Android → false, and Health Connect is never touched', async () => {
    const { svc, hc } = load();
    mockPlatform.OS = 'ios';
    mockHc.granted = [HC_GRANT];
    await expect(svc.hasHealthConnectLink()).resolves.toBe(false);
    expect(hc.initialize).not.toHaveBeenCalled();
  });

  it('never asks: the Health Connect permission sheet is never requested', async () => {
    const { svc, hc } = load();
    mockHc.granted = [HC_GRANT];
    await svc.hasHealthConnectLink();
    mockHc.granted = [];
    await svc.hasHealthConnectLink();
    expect(hc.requestPermission).not.toHaveBeenCalled();
  });
});

describe('stopLaneThenClearToken — the logout / delete teardown slot', () => {
  it('stops the lane BEFORE the credential is cleared', async () => {
    const { svc } = load();
    const order: string[] = [];
    await svc.stopLaneThenClearToken(
      { stop: async () => { order.push('stop'); } },
      async () => { order.push('clear'); },
    );
    expect(order).toEqual(['stop', 'clear']);
  });

  it('a throwing stop still clears the credential', async () => {
    const { svc } = load();
    const clear = jest.fn(async () => {});
    await svc.stopLaneThenClearToken({ stop: async () => { throw new Error('ble gone'); } }, clear);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

describe('the production lane, against a fake backend', () => {
  it('mood-only (no Health Connect grant): nothing leaves the device, no Bluetooth manager, no prompt, no Health Connect read', async () => {
    const w = load();
    w.signIn('user-1');
    backend.consent = { granted: true, staleVersion: false }; // even a grant on the server must not matter
    await expect(w.svc.healthLane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(backend.requests).toEqual([]);
    expect(w.BleManager).not.toHaveBeenCalled();
    expect(w.requestMultiple).not.toHaveBeenCalled();
    expect(w.hc.readRecords).not.toHaveBeenCalled();
    expect(w.svc.healthLane.status()).toBe('idle');
  });

  it('linked + a current grant: ONE consent read, ONE whr_ mint, the Health Connect fallback runs, and no prompt', async () => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    backend.consent = { granted: true, staleVersion: false };
    running = w.svc.healthLane;
    await expect(w.svc.healthLane.evaluate({ allowStart: true })).resolves.toBe(true);
    expect(hits('GET', '/api/consent/status')).toBe(1);
    expect(hits('POST', '/api/integrations/watch/token')).toBe(1);
    expect(mockSlots.get(WATCH_SLOT)).toBe('whr_minted_1');
    expect(w.svc.healthLane.status()).toBe('running');
    expect(w.warmStore.getState().biometricSource).toBe('health-connect');
    expect(w.BleManager).not.toHaveBeenCalled(); // no Bluetooth grant → no scan
    expect(w.requestMultiple).not.toHaveBeenCalled();
  });

  it('an ALREADY-granted Bluetooth permission streams over BLE — still without any prompt', async () => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    mockBleGrants.set('scan', true);
    mockBleGrants.set('connect', true);
    backend.consent = { granted: true, staleVersion: false };
    running = w.svc.healthLane;
    await w.svc.healthLane.evaluate({ allowStart: true });
    expect(w.warmStore.getState().biometricSource).toBe('ble');
    expect(w.BleManager).toHaveBeenCalledTimes(1);
    expect(w.requestMultiple).not.toHaveBeenCalled();
    await w.svc.healthLane.stop();
    expect(mockBleManagers[0].destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no grant on file', { granted: false, staleVersion: false }],
    ['a stale grant', { granted: true, staleVersion: true }],
  ])('linked but %s on the server: consent is read, nothing is minted, the lane stays idle', async (_l, consent) => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    backend.consent = consent;
    await expect(w.svc.healthLane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(hits('GET', '/api/consent/status')).toBe(1);
    expect(hits('POST', '/api/integrations/watch/token')).toBe(0);
    expect(w.svc.healthLane.status()).toBe('idle');
  });

  it('Disconnect: the feed stops, the reading clears, and it STAYS off — a later start-allowed check mints nothing', async () => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    backend.consent = { granted: true, staleVersion: false };
    running = w.svc.healthLane;
    await w.svc.healthLane.evaluate({ allowStart: true });
    w.warmStore.getState().setLiveHr(77);

    await w.svc.onLiveHrDisconnected();
    expect(w.svc.healthLane.status()).toBe('idle');
    expect(w.warmStore.getState().liveHr).toBeNull();
    expect(w.liveHrSwitch.isOff()).toBe(true);
    expect(mockSlots.has(WATCH_SLOT)).toBe(false);

    await expect(w.svc.healthLane.evaluate({ allowStart: true })).resolves.toBe(true); // Art.9 still open
    expect(w.svc.healthLane.status()).toBe('idle');
    expect(hits('POST', '/api/integrations/watch/token')).toBe(1); // no second mint
  });

  it('an explicit wearable link switches live HR back on and starts it', async () => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    backend.consent = { granted: true, staleVersion: false };
    running = w.svc.healthLane;
    w.liveHrSwitch.switchOff();
    await w.svc.healthLane.evaluate({ allowStart: true });
    expect(w.svc.healthLane.status()).toBe('idle');

    await expect(w.svc.onWearableLinked()).resolves.toBe(true);
    expect(w.liveHrSwitch.isOff()).toBe(false);
    expect(w.svc.healthLane.status()).toBe('running');
  });

  it('consent withdrawn: the feed stops and the credential is forgotten', async () => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    backend.consent = { granted: true, staleVersion: false };
    running = w.svc.healthLane;
    await w.svc.healthLane.evaluate({ allowStart: true });
    expect(mockSlots.has(WATCH_SLOT)).toBe(true);

    await w.svc.onConsentWithdrawn();
    expect(w.svc.healthLane.status()).toBe('idle');
    expect(mockSlots.has(WATCH_SLOT)).toBe(false);
  });

  it('the foreground re-check can only stop: it never starts an idle feed', async () => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    backend.consent = { granted: true, staleVersion: false };
    await expect(w.svc.recheckHealthOnForeground()).resolves.toBe(true);
    expect(w.svc.healthLane.status()).toBe('idle');
    expect(hits('POST', '/api/integrations/watch/token')).toBe(0);
  });
});
