// A module, not a script: this suite only require()s at run time, and without a top-level import
// or export TypeScript would merge its helpers into the global scope of every other such suite.
export {};

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

const mockHc = { initialized: true, initThrows: false, granted: [] as unknown[], grantsThrow: false, records: [] as unknown[] };
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
  readRecords: jest.fn(async () => ({ records: mockHc.records })),
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
  // How the consent read ANSWERS, independent of what is on file: a normal answer, a refused read
  // (401, and no refresh token to rotate), no network at all, or a 200 whose body lacks the shape.
  consentMode: 'ok' | '401' | 'offline' | 'malformed';
  mints: number;
  requests: Array<{ method: string; path: string }>;
}
let backend: FakeBackend;

function installFakeBackend(): void {
  backend = { consent: { granted: false, staleVersion: false }, consentMode: 'ok', mints: 0, requests: [] };
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    backend.requests.push({ method, path });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    const current = backend.consent.granted && !backend.consent.staleVersion;
    if (method === 'GET' && path === '/api/consent/status') {
      if (backend.consentMode === 'offline') throw new TypeError('Network request failed');
      if (backend.consentMode === '401') return json(401, { error: 'unauthorized' });
      if (backend.consentMode === 'malformed') return json(200, { granted: true });
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
  mockHc.records = [];
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
    // The cached whr_ is never even READ for a mood-only account (compliance E5).
    const keychain = require('react-native-keychain');
    expect(keychain.getGenericPassword.mock.calls.filter(([o]: any[]) => o?.service === WATCH_SLOT)).toEqual([]);
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

// Compliance B1 / E5 at the PRODUCTION binding. The lane's own suite proves every closed answer
// keeps a fake feed from starting; here the same matrix runs through the real chain (consent client
// → lane → startBiometrics → startLiveHr → getWatchToken → Bluetooth / Health Connect), and the
// assertion is the compliance one: with the gate closed, NOTHING behind it is touched. Where the
// consent read itself fails, the server still holds a current grant, so a gate that wrongly opened
// would mint for real and fail these assertions rather than hide behind a refused mint.
describe('compliance E5 — a closed gate touches nothing behind it (production binding)', () => {
  const CURRENT = { granted: true, staleVersion: false };
  it.each([
    ['mood-only: no Health Connect link, even with a current grant on file', () => { mockHc.granted = []; backend.consent = CURRENT; }],
    ['linked, but no grant on file', () => { backend.consent = { granted: false, staleVersion: false }; }],
    ['linked, but a stale grant', () => { backend.consent = { granted: true, staleVersion: true }; }],
    ['linked, but the consent read is refused (401)', () => { backend.consent = CURRENT; backend.consentMode = '401'; }],
    ['linked, but offline', () => { backend.consent = CURRENT; backend.consentMode = 'offline'; }],
    ['linked, but a malformed consent answer', () => { backend.consent = CURRENT; backend.consentMode = 'malformed'; }],
  ])('%s: no mint, no push, no cached-credential read, no Bluetooth manager, grant read or prompt, no Health Connect data read', async (_l, arrange) => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    mockBleGrants.set('scan', true);
    mockBleGrants.set('connect', true); // a Bluetooth grant from an older build must not matter either
    arrange();

    await expect(w.svc.healthLane.evaluate({ allowStart: true })).resolves.toBe(false);

    expect(hits('POST', '/api/integrations/watch/token')).toBe(0);
    expect(hits('POST', '/api/integrations/watch/hr')).toBe(0);
    const keychain = require('react-native-keychain');
    expect(keychain.getGenericPassword.mock.calls.filter(([o]: any[]) => o?.service === WATCH_SLOT)).toEqual([]);
    expect(w.BleManager).not.toHaveBeenCalled();
    expect(require('react-native').PermissionsAndroid.check).not.toHaveBeenCalled();
    expect(w.requestMultiple).not.toHaveBeenCalled();
    expect(w.hc.readRecords).not.toHaveBeenCalled();
    expect(w.hc.requestPermission).not.toHaveBeenCalled();
    expect(w.warmStore.getState().liveHr).toBeNull();
    expect(w.svc.healthLane.status()).toBe('idle');
  });

  it('control: the same world with a current grant does mint and start (the fakes are live)', async () => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    backend.consent = CURRENT;
    running = w.svc.healthLane;
    await expect(w.svc.healthLane.evaluate({ allowStart: true })).resolves.toBe(true);
    expect(hits('POST', '/api/integrations/watch/token')).toBe(1);
    expect(w.svc.healthLane.status()).toBe('running');
  });
});

// Compliance B6 at the PRODUCTION binding: a withdrawal, a live-HR Disconnect and logout / account
// delete each end the feed FOR GOOD — "no further POST /watch/hr" asserted over time and against
// callbacks the OS had already queued, not only as "the lane reports idle". Each tier is first shown
// live (readings land and leave), so the silence afterwards is the teardown's doing.
describe('compliance B6 — withdraw, Disconnect and logout end the feed for good (production binding)', () => {
  const CURRENT = { granted: true, staleVersion: false };
  const TEARDOWNS: Array<[string, (svc: any) => Promise<void>]> = [
    ['a consent withdrawal', (svc) => svc.onConsentWithdrawn()],
    ['a live-HR Disconnect', (svc) => svc.onLiveHrDisconnected()],
    ['logout / account delete (the teardown slot)', (svc) =>
      svc.stopLaneThenClearToken(svc.healthLane, require('../liveHrClient').clearWatchToken)],
  ];
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const bpm = (hr: number) => Buffer.from([0x00, hr]).toString('base64'); // 0x2A37, 8-bit value

  afterEach(() => { jest.useRealTimers(); });

  it.each(TEARDOWNS)('%s, over the Health Connect fallback: no reading, no push and no Health Connect read in any later window', async (_l, teardown) => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const { FALLBACK_INTERVAL_MS } = require('../restFallback');
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    mockHc.records = [{ samples: [{ time: new Date().toISOString(), beatsPerMinute: 72 }] }];
    backend.consent = CURRENT;
    running = w.svc.healthLane;
    await w.svc.healthLane.evaluate({ allowStart: true });
    await settle();
    expect(hits('POST', '/api/integrations/watch/hr')).toBe(1); // the immediate tick
    await jest.advanceTimersByTimeAsync(FALLBACK_INTERVAL_MS);
    await settle();
    expect(hits('POST', '/api/integrations/watch/hr')).toBe(2); // and the 3-minute cadence
    expect(w.warmStore.getState().liveHr).toBe(72);

    await teardown(w.svc);
    const reads = w.hc.readRecords.mock.calls.length;
    await jest.advanceTimersByTimeAsync(FALLBACK_INTERVAL_MS * 4);
    await settle();

    expect(hits('POST', '/api/integrations/watch/hr')).toBe(2);
    expect(w.hc.readRecords.mock.calls.length).toBe(reads);
    expect(w.warmStore.getState().liveHr).toBeNull();
    expect(w.svc.healthLane.status()).toBe('idle');
  });

  it.each(TEARDOWNS)('%s, over Bluetooth: a queued reading never lands or leaves, a late advertisement is never connected, the manager is destroyed', async (_l, teardown) => {
    const w = load();
    w.signIn('user-1');
    mockHc.granted = [HC_GRANT];
    mockBleGrants.set('scan', true);
    mockBleGrants.set('connect', true);
    backend.consent = CURRENT;
    running = w.svc.healthLane;
    await w.svc.healthLane.evaluate({ allowStart: true });
    const manager = mockBleManagers[0] as unknown as { startDeviceScan: jest.Mock; destroy: jest.Mock };
    const onScan = manager.startDeviceScan.mock.calls[0][2];

    let onReading: (err: unknown, ch: { value: string } | null) => Promise<void> = async () => {};
    const makeStrap = () => {
      const strap = {
        connect: jest.fn(async () => strap),
        discoverAllServicesAndCharacteristics: jest.fn(async () => strap),
        monitorCharacteristicForService: jest.fn((_s: string, _c: string, listener: typeof onReading) => {
          onReading = listener;
          return { remove: jest.fn() };
        }),
        cancelConnection: jest.fn(async () => strap),
      };
      return strap;
    };
    const strap = makeStrap();
    await onScan(null, strap);
    await onReading(null, { value: bpm(80) });
    expect(hits('POST', '/api/integrations/watch/hr')).toBe(1); // live over Bluetooth
    expect(w.warmStore.getState().liveHr).toBe(80);

    await teardown(w.svc);
    expect(manager.destroy).toHaveBeenCalledTimes(1);
    expect(strap.cancelConnection).toHaveBeenCalled();

    // Callbacks the OS had already queued still fire after the teardown.
    await onReading(null, { value: bpm(120) }); // a 40 bpm jump: the send gate would pass it
    const lateStrap = makeStrap();
    await onScan(null, lateStrap);
    await settle();

    expect(hits('POST', '/api/integrations/watch/hr')).toBe(1);
    expect(lateStrap.connect).not.toHaveBeenCalled();
    expect(w.warmStore.getState().liveHr).toBeNull();
    expect(w.svc.healthLane.status()).toBe('idle');
  });
});
