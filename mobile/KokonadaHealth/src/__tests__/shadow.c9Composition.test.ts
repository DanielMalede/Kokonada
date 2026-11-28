/// <reference types="node" />
// RA-1, RA-2, RA-5, RA-7 (PR #321, C9): the prod composition of the teardown (profileServices ->
// ProfileController -> createSessionTeardown) over stateful fakes: the Keychain by service, the
// backend, the Google SDK as its Android module behaves (a revoke needs a signed-in account), and the
// real SecureStore, opened once by the real prodBootstrap.startApp as on a phone.
//
// Adapted from the audit's proposed file (PR321_resilience_audit_caec348.md) where the code requires
// it: RA-5 makes the teardown use the store the boot opened, so signedIn() runs startApp() first, the
// store factory counts its opens, the playback mock adds the `playbackSocket` prodBootstrap imports,
// and the first case's kept keys include `koko.liveMode` (the boot binds Live/Manual to that store, and
// the teardown writes Manual). Added: the RA-1 key-builder guard, the RA-5 pin and the RA-7
// pin (see each case).
import * as fs from 'fs';
import * as path from 'path';

const UID_A = 'a'.repeat(24);
const UID_B = 'b'.repeat(24);

function load() {
  jest.resetModules();
  const events: string[] = [];
  const slots = new Map<string, string>();
  const keys = new Map<string, string>();
  const opens = { count: 0 };
  let holdDelete = false;
  let release: () => void = () => {};
  const deleteHeld = new Promise<void>((r) => { release = r; });
  let duringLogout: () => Promise<void> = async () => {};

  jest.doMock('react-native', () => ({
    Platform: { OS: 'android', Version: 31 },
    PermissionsAndroid: {
      PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
      RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
      check: jest.fn(async () => false),
      requestMultiple: jest.fn(),
    },
  }));
  jest.doMock('react-native-keychain', () => ({
    getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
      (slots.has(service) ? { password: slots.get(service) } : false)),
    setGenericPassword: jest.fn(async (_u: string, password: string, { service }: { service: string }) => {
      slots.set(service, password);
      return true;
    }),
    resetGenericPassword: jest.fn(async ({ service }: { service: string }) => { slots.delete(service); return true; }),
  }));
  jest.doMock('@react-native-google-signin/google-signin', () => {
    let googleSignedIn = true;
    return {
      GoogleSignin: {
        configure: jest.fn(),
        hasPlayServices: jest.fn(async () => true),
        signIn: jest.fn(),
        revokeAccess: jest.fn(async () => {
          if (!googleSignedIn) throw new Error('SIGN_IN_REQUIRED');
          events.push('google-revoke');
          return null;
        }),
        signOut: jest.fn(async () => { googleSignedIn = false; events.push('google-signOut'); return null; }),
      },
    };
  });
  jest.doMock('../experience/playback/playbackServices', () => ({
    player: { dispose: async () => { events.push('player-disposed'); }, connect: async () => {} },
    kokoSocket: { disconnect: () => { events.push('socket-severed'); } },
    playbackSocket: { ensureConnected: () => {} },
    orchestrator: { clear: () => {}, resume: () => {} },
  }));
  jest.doMock('../storage/secureStoreFactory', () => {
    const { SecureStore } = jest.requireActual('../storage/secureStore');
    const backend = {
      encrypted: true,
      getString: (k: string) => keys.get(k),
      set: (k: string, v: string) => { keys.set(k, v); },
      delete: (k: string) => { keys.delete(k); },
      getAllKeys: () => [...keys.keys()],
      clearAll: () => { keys.clear(); },
    };
    const store = new SecureStore({ backend, cipher: { encrypt: (v: string) => v, decrypt: (v: string) => v } });
    return { createSecureStore: async () => { opens.count += 1; return store; } };
  });
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    const p = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } });
    if (method === 'POST' && p === '/api/auth/logout') { await duringLogout(); return json(200, {}); }
    if (method === 'DELETE' && p === '/api/auth/account') {
      if (holdDelete) await deleteHeld;
      return json(200, { deleted: true });
    }
    return json(404, {});
  });

  return {
    startApp: require('../prodBootstrap').startApp as () => Promise<void>,
    profileController: require('../experience/profile/profileServices').profileController,
    accountKeyPrefixes: require('../experience/profile/profileServices').accountKeyPrefixes as (uid: string) => string[],
    authSession: require('../auth/session').authSession,
    currentUserStore: require('../auth/currentUser').currentUserStore,
    connect: require('../experience/connect/connectStore'),
    liveHr: require('../health/liveHrSwitch'),
    events,
    keys,
    opens,
    holdDeletes: () => { holdDelete = true; },
    releaseDelete: () => release(),
    onLogoutPost: (fn: () => Promise<void>) => { duringLogout = fn; },
  };
}

async function signedIn(w: ReturnType<typeof load>) {
  await w.startApp(); // the boot opens the encrypted store once, with no stored session
  await w.authSession.setSession({ access: 'access-a', refresh: 'refresh-a' });
  w.currentUserStore.getState().setUser({ id: UID_A, displayName: 'A', email: 'a@x.io' });
  for (const uid of [UID_A, UID_B]) {
    w.keys.set(w.connect.resolvedKey(uid), '1');
    w.keys.set(w.connect.moodOnlyKey(uid), '1');
    w.keys.set(w.liveHr.liveHrLinkKey(uid), 'on');
  }
  w.keys.set('koko.onboarding.seen', '1');
  w.events.length = 0;
}

const macrotasks = async (n: number) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

afterEach(() => {
  jest.dontMock('react-native');
  jest.dontMock('react-native-keychain');
  jest.dontMock('@react-native-google-signin/google-signin');
  jest.dontMock('../experience/playback/playbackServices');
  jest.dontMock('../storage/secureStoreFactory');
});

describe('shadow · C9 account deletion in the prod composition (PR #321)', () => {
  it("removes the deleted account's live-HR link and Connect flags; keeps B's and the device's", async () => {
    const w = load();
    await signedIn(w);

    const res = await w.profileController.deleteAccount();

    expect(res.ok).toBe(true);
    expect([...w.keys.keys()].filter((k) => k.includes(UID_A))).toEqual([]);
    expect([...w.keys.keys()].sort()).toEqual([
      w.liveHr.liveHrLinkKey(UID_B), w.connect.moodOnlyKey(UID_B), w.connect.resolvedKey(UID_B), 'koko.onboarding.seen',
      'koko.liveMode', // a device preference: the teardown's resetLiveMode writes Manual through the boot store
    ].sort());
  });

  it('a logout while the deletion is in flight still revokes before it signs out', async () => {
    const w = load();
    await signedIn(w);
    w.holdDeletes();

    const deleting = w.profileController.deleteAccount();
    const loggingOut = w.profileController.logout();
    await macrotasks(10);
    w.releaseDelete();
    await Promise.all([deleting, loggingOut]);

    expect(w.events.filter((e) => e.startsWith('google-'))).toEqual(['google-revoke', 'google-signOut']);
  });

  // RA-5: the teardown removes the keys from the store the boot opened; it opens no second instance.
  it('removes the keys from the boot store and opens no second store', async () => {
    const w = load();
    await signedIn(w);
    expect(w.opens.count).toBe(1);

    await w.profileController.deleteAccount();

    expect(w.opens.count).toBe(1);
    expect([...w.keys.keys()].some((k) => k.includes(UID_A))).toBe(false);
  });

  // RA-7: the logout's context is the session that asked to log out. A session that replaces it while
  // the logout POST is in flight is newer, and the teardown leaves it alone. (The audit's proposed pin, a
  // dead refresh inside the POST, is not observable in v1: no production code tears down a sessionEnded
  // epoch yet, MB-221. A sign-in inside the POST is the same capture defect, observable now.)
  it('a sign-in that lands during the logout POST keeps its session and its user', async () => {
    const w = load();
    await signedIn(w);
    w.onLogoutPost(async () => {
      await w.authSession.setSession({ access: 'access-b', refresh: 'refresh-b' });
      w.currentUserStore.getState().setUser({ id: UID_B, displayName: 'B', email: 'b@x.io' });
    });

    await w.profileController.logout();

    expect(w.authSession.getAccessToken()).toBe('access-b');
    expect(w.currentUserStore.getState().user?.id).toBe(UID_B);
    expect(w.events).not.toContain('google-signOut');
  });
});

// RA-1's guard: every exported per-account key builder in src (an exported `(uid: string): string`
// arrow or function) builds a key that accountKeyPrefixes removes at an account deletion.
describe('shadow · C9 every per-account key family is on the deletion list (PR #321)', () => {
  const SRC = path.resolve(__dirname, '..');
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink() || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(full, out); } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
    }
    return out;
  }
  const BUILDER = /export\s+(?:const\s+(\w+)\s*=\s*|function\s+(\w+)\s*)\(\s*(?:uid|userId|accountId)\s*:\s*string\s*\)\s*:\s*string(?!\s*\[)/g;

  function builders(): { file: string; name: string }[] {
    const found: { file: string; name: string }[] = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(BUILDER)) found.push({ file, name: m[1] ?? m[2] });
    }
    return found;
  }

  it('finds the known builders (a scan that finds nothing fails)', () => {
    const names = builders().map((b) => b.name).sort();
    expect(names).toEqual(expect.arrayContaining(['liveHrLinkKey', 'moodOnlyKey', 'resolvedKey']));
  });

  it("every builder's key falls under one of the deleted account's prefixes", () => {
    const w = load();
    const prefixes = w.accountKeyPrefixes(UID_A);
    for (const { file, name } of builders()) {
      const key: string = require(file)[name](UID_A);
      expect({ name, covered: prefixes.some((p) => key.startsWith(p)) }).toEqual({ name, covered: true });
    }
    // No prefix reaches another account's keys.
    for (const p of prefixes) expect(p.endsWith(`${UID_A}.`)).toBe(true);
  });
});
