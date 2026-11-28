// C9 (design v2 batch B1, P1 charter §2): the teardown contract, added to v1's teardown without
// changing what v1 already does.
//   - a signOutProvider step before the credential clear: GoogleSignin.signOut, plus revokeAccess on
//     accountDeleted (RA-21, MB-018);
//   - the clear is scoped to the ended epoch (RA-3);
//   - each step is bounded at 1500 ms;
//   - the teardown is idempotent per epoch;
//   - on accountDeleted, the per-account device keys are removed by prefix; a logout and an
//     involuntary end keep them;
//   - the record goes with the tokens (RA-2, item 67);
//   - Spotify playback is paused before App Remote is severed.
//
// Part 1 drives the teardown over the REAL AuthSession (its epoch, its end, its listeners) on a
// stateful in-memory Keychain, so "the record is gone" is an absence on that disk, not a call count.
// Part 2 drives the REAL prod composition (profileServices -> ProfileController -> the teardown) over
// stateful fakes of the outside world: the Keychain by service, the backend, the Google SDK, the
// Spotify App Remote under the real SpotifyPlayerController, and the encrypted device store as the
// real SecureStore over an in-memory backend.

import { AuthSession, type TokenPair } from '../../../auth/authSession';
import { createCurrentUserStore } from '../../../auth/currentUser';
import {
  createSessionTeardown,
  wipeLocalSession,
  TEARDOWN_STEP_MS,
  type SessionTeardownDeps,
  type TeardownReason,
} from '../sessionTeardown';

const UID_A = 'a'.repeat(24);
const UID_B = 'b'.repeat(24);

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
}

// Lets the teardown run until it has started `name` (it awaits between steps).
async function untilLogged(log: string[], name: string): Promise<void> {
  for (let i = 0; i < 100 && !log.includes(name); i++) await Promise.resolve();
  expect(log).toContain(name);
}

function world() {
  const disk: { record: TokenPair | null } = { record: null };
  const log: string[] = [];
  const session = new AuthSession({
    loadTokens: async () => disk.record,
    saveTokens: async (t) => { disk.record = t; },
    clearTokens: async () => { disk.record = null; log.push('record-cleared'); },
    refreshEndpoint: async () => ({ kind: 'dead' }),
  });
  const users = createCurrentUserStore();
  const step = (name: string) => () => { log.push(name); };
  const deps: SessionTeardownDeps = {
    disconnectSocket: step('socket'),
    disposePlayer: step('player'),
    clearAuthSession: () => session.clear(),
    clearWatchToken: step('watch'),
    clearLegacyToken: step('legacy'),
    wipeColdPersistence: step('cold'),
    resetWarm: step('warm'),
    resetNowPlaying: step('now'),
    resetPlaybackError: step('err'),
    resetLiveMode: step('liveMode'),
    clearCurrentUser: () => {
      log.push(`user-cleared (record ${disk.record ? 'present' : 'gone'})`);
      users.getState().clear();
    },
    revokeProvider: step('provider-revoke'),
    signOutProvider: step('provider-signOut'),
    removeAccountKeys: (uid) => { log.push(`keys-removed ${uid}`); },
    sessionEpoch: () => session.sessionEpoch(),
    hasSession: () => session.hasSession(),
  };
  const signIn = async (uid: string, tag: string) => {
    await session.setSession({ access: `access-${tag}`, refresh: `refresh-${tag}` });
    users.getState().setUser({ id: uid, displayName: tag, email: `${tag}@x.io` });
  };
  return { disk, log, session, users, deps, signIn };
}

const REASONS: TeardownReason[] = ['loggedOut', 'accountDeleted', 'sessionEnded'];

// An involuntary end: the server refused the refresh family, so AuthSession ended the session itself
// (its epoch moved, its record went) before any teardown ran. Returns the ended epoch.
async function endInvoluntarily(w: ReturnType<typeof world>): Promise<number> {
  const ended = w.session.sessionEpoch();
  await w.session.refresh();
  expect(w.session.hasSession()).toBe(false);
  return ended;
}

describe('C9 · the provider sign-out', () => {
  it.each(REASONS)('%s: signOutProvider runs after the player and before the credential clear', async (reason) => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const epoch = reason === 'sessionEnded' ? await endInvoluntarily(w) : w.session.sessionEpoch();
    w.log.length = 0;

    await createSessionTeardown(w.deps)({ reason, epoch, uid: UID_A });

    const at = (name: string) => w.log.indexOf(name);
    expect(at('provider-signOut')).toBeGreaterThan(at('player'));
    expect(at('provider-signOut')).toBeLessThan(w.log.lastIndexOf('record-cleared'));
    expect(at('provider-signOut')).toBeLessThan(w.log.findIndex((e) => e.startsWith('user-cleared')));
  });

  it('revokes access only on accountDeleted, and before the sign-out (a revoke needs the signed-in account)', async () => {
    for (const reason of REASONS) {
      const w = world();
      await w.signIn(UID_A, 'a');
      await createSessionTeardown(w.deps)({ reason, epoch: w.session.sessionEpoch(), uid: UID_A });
      if (reason === 'accountDeleted') {
        expect(w.log.indexOf('provider-revoke')).toBeGreaterThanOrEqual(0);
        expect(w.log.indexOf('provider-revoke')).toBeLessThan(w.log.indexOf('provider-signOut'));
      } else {
        expect({ reason, revoked: w.log.includes('provider-revoke') }).toEqual({ reason, revoked: false });
      }
    }
  });
});

describe('C9 · the record goes with the tokens (RA-2, item 67)', () => {
  it.each(REASONS)('every end reason clears the record (uid and age result) before clearCurrentUser: %s', async (reason) => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const epoch = reason === 'sessionEnded' ? await endInvoluntarily(w) : w.session.sessionEpoch();

    await createSessionTeardown(w.deps)({ reason, epoch, uid: UID_A });

    expect(w.log).toContain('user-cleared (record gone)');
    expect(w.disk.record).toBeNull();
    expect(w.session.hasSession()).toBe(false);
    expect(w.users.getState().user).toBeNull();
  });
});

describe('C9 · the clear is scoped to the ended epoch (RA-3)', () => {
  it('a sign-in inside the window (a deferred disposePlayer) keeps the new session, its record and its user', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const hold = deferred();
    w.deps.disposePlayer = () => { w.log.push('player'); return hold.promise; };

    const running = createSessionTeardown(w.deps)({ reason: 'loggedOut', epoch: w.session.sessionEpoch(), uid: UID_A });
    await untilLogged(w.log, 'player');
    await w.signIn(UID_B, 'b'); // the new session lands while the old one's player is still disposing
    hold.release();
    await running;

    expect(w.session.getAccessToken()).toBe('access-b');
    expect(w.disk.record).toEqual({ access: 'access-b', refresh: 'refresh-b' });
    expect(w.users.getState().user?.id).toBe(UID_B);
    // Nothing after the window touches what the new session owns, its Google account included; the
    // ended account's in-memory data is still reset, so the new session never shows it (RA-4).
    expect(w.log).toEqual(['socket', 'player', 'warm', 'now', 'err']);
  });

  it('an account deleted with a sign-in inside the window still loses its own device keys, and only those', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const hold = deferred();
    w.deps.disposePlayer = () => { w.log.push('player'); return hold.promise; };

    const running = createSessionTeardown(w.deps)({ reason: 'accountDeleted', epoch: w.session.sessionEpoch(), uid: UID_A });
    await untilLogged(w.log, 'player');
    await w.signIn(UID_B, 'b');
    hold.release();
    await running;

    expect(w.log).toEqual(['socket', 'player', 'warm', 'now', 'err', `keys-removed ${UID_A}`]);
    expect(w.session.getAccessToken()).toBe('access-b');
  });

  it('an involuntary end, whose session AuthSession already ended, is not mistaken for a newer session', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const epoch = await endInvoluntarily(w);
    w.log.length = 0;

    await createSessionTeardown(w.deps)({ reason: 'sessionEnded', epoch, uid: UID_A });

    expect(w.log).toEqual([
      'socket', 'player', 'provider-signOut', 'record-cleared', 'watch', 'legacy',
      'cold', 'warm', 'now', 'err', 'liveMode', 'user-cleared (record gone)',
    ]);
  });

  it('never clears a session other than the ended one, even with no session event in between', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const endedEpoch = w.session.sessionEpoch();
    await w.signIn(UID_B, 'b'); // B replaced A before A's teardown started

    await createSessionTeardown(w.deps)({ reason: 'loggedOut', epoch: endedEpoch, uid: UID_A });

    expect(w.disk.record).toEqual({ access: 'access-b', refresh: 'refresh-b' });
    expect(w.users.getState().user?.id).toBe(UID_B);
  });
});

describe('C9 · each step is bounded at 1500 ms', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('the bound is 1500 ms', () => {
    expect(TEARDOWN_STEP_MS).toBe(1500);
  });

  it.each([
    ['disposePlayer', 'provider-signOut'],
    ['signOutProvider', 'record-cleared'],
    ['clearWatchToken', 'legacy'],
  ] as const)('a %s that never settles holds the next step for exactly 1500 ms', async (hung, next) => {
    jest.useFakeTimers();
    const w = world();
    await w.signIn(UID_A, 'a');
    (w.deps as any)[hung] = () => new Promise<void>(() => { /* never settles */ });

    let done = false;
    const running = createSessionTeardown(w.deps)({ reason: 'loggedOut', epoch: w.session.sessionEpoch(), uid: UID_A })
      .then(() => { done = true; });

    await jest.advanceTimersByTimeAsync(TEARDOWN_STEP_MS - 1);
    expect(w.log).not.toContain(next);
    await jest.advanceTimersByTimeAsync(1);
    expect(w.log).toContain(next);
    await jest.advanceTimersByTimeAsync(TEARDOWN_STEP_MS * 12);
    await running;
    expect(done).toBe(true);
    expect(w.users.getState().user).toBeNull();
  });

  it('a throwing step still never blocks the rest', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    w.deps.signOutProvider = () => { throw new Error('play services'); };
    await createSessionTeardown(w.deps)({ reason: 'loggedOut', epoch: w.session.sessionEpoch(), uid: UID_A });
    expect(w.disk.record).toBeNull();
    expect(w.users.getState().user).toBeNull();
  });
});

describe('C9 · the teardown is idempotent per epoch', () => {
  it('two teardowns of one epoch, concurrent or after it ended, run every step once', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const epoch = w.session.sessionEpoch();
    const teardown = createSessionTeardown(w.deps);

    const first = teardown({ reason: 'loggedOut', epoch, uid: UID_A });
    const second = teardown({ reason: 'loggedOut', epoch, uid: UID_A });
    await Promise.all([first, second]);
    await teardown({ reason: 'sessionEnded', epoch, uid: UID_A });

    expect(w.log.filter((e) => e === 'socket')).toHaveLength(1);
    expect(w.log.filter((e) => e === 'record-cleared')).toHaveLength(1);
    expect(w.log.filter((e) => e.startsWith('user-cleared'))).toHaveLength(1);
  });

  it('an accountDeleted for an epoch a logout already tore down adds only its own steps', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const epoch = w.session.sessionEpoch();
    const teardown = createSessionTeardown(w.deps);

    await teardown({ reason: 'loggedOut', epoch, uid: UID_A });
    w.log.length = 0;
    await teardown({ reason: 'accountDeleted', epoch, uid: UID_A });
    await teardown({ reason: 'accountDeleted', epoch, uid: UID_A });

    expect(w.log).toEqual(['provider-revoke', 'provider-signOut', `keys-removed ${UID_A}`]);
  });

  it('a new epoch tears down again', async () => {
    const w = world();
    const teardown = createSessionTeardown(w.deps);
    await w.signIn(UID_A, 'a');
    await teardown({ reason: 'loggedOut', epoch: w.session.sessionEpoch(), uid: UID_A });
    await w.signIn(UID_B, 'b');
    await teardown({ reason: 'loggedOut', epoch: w.session.sessionEpoch(), uid: UID_B });

    expect(w.log.filter((e) => e === 'record-cleared')).toHaveLength(2);
    expect(w.disk.record).toBeNull();
  });
});

describe('C9 · per-account device keys', () => {
  it.each(REASONS)('%s removes them only for accountDeleted, before the identity drops', async (reason) => {
    const w = world();
    await w.signIn(UID_A, 'a');
    const epoch = reason === 'sessionEnded' ? await endInvoluntarily(w) : w.session.sessionEpoch();
    await createSessionTeardown(w.deps)({ reason, epoch, uid: UID_A });

    const removed = w.log.indexOf(`keys-removed ${UID_A}`);
    if (reason === 'accountDeleted') {
      expect(removed).toBeGreaterThanOrEqual(0);
      expect(removed).toBeLessThan(w.log.findIndex((e) => e.startsWith('user-cleared')));
    } else {
      expect(removed).toBe(-1);
    }
  });

  it('a deletion with no known account removes nothing', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    await createSessionTeardown(w.deps)({ reason: 'accountDeleted', epoch: w.session.sessionEpoch(), uid: null });
    expect(w.log.some((e) => e.startsWith('keys-removed'))).toBe(false);
  });
});

describe('C9 is additive: v1 wipeLocalSession without a context keeps its order', () => {
  it('runs the v1 steps in the v1 order, with the provider sign-out before the credential clear', async () => {
    const w = world();
    await w.signIn(UID_A, 'a');
    await wipeLocalSession(w.deps);
    expect(w.log).toEqual([
      'socket', 'player', 'provider-signOut', 'record-cleared', 'watch', 'legacy',
      'cold', 'warm', 'now', 'err', 'liveMode', 'user-cleared (record gone)',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Part 2: the real prod composition.
// ---------------------------------------------------------------------------------------------

describe('C9 · the prod composition (profileServices)', () => {
  const SESSION_SLOT = 'com.kokonadahealth.session';

  function load(opts: { deleteStatus?: number } = {}) {
    jest.resetModules();
    const events: string[] = [];
    const slots = new Map<string, string>();
    const keys = new Map<string, string>();

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
      resetGenericPassword: jest.fn(async ({ service }: { service: string }) => {
        if (service === SESSION_SLOT) events.push('session-record-wiped');
        slots.delete(service);
        return true;
      }),
    }));
    // The Google SDK as its Android module behaves: signOut and revokeAccess reject until configure()
    // ran in this process (RNGoogleSigninModule "apiClient is null - call configure() first"), and a
    // revoke needs a signed-in account.
    jest.doMock('@react-native-google-signin/google-signin', () => {
      let configured = false;
      let googleSignedIn = true;
      return {
        GoogleSignin: {
          configure: jest.fn(() => { configured = true; }),
          hasPlayServices: jest.fn(async () => true),
          signIn: jest.fn(),
          revokeAccess: jest.fn(async () => {
            if (!configured) throw new Error('apiClient is null - call configure() first');
            if (!googleSignedIn) throw new Error('SIGN_IN_REQUIRED');
            events.push('google-revoke');
            return null;
          }),
          signOut: jest.fn(async () => {
            if (!configured) throw new Error('apiClient is null - call configure() first');
            googleSignedIn = false;
            events.push('google-signOut');
            return null;
          }),
        },
      };
    });
    // The Spotify App Remote, under the REAL controller: pause needs the live link.
    jest.doMock('../../playback/playbackServices', () => {
      const { SpotifyPlayerController } = jest.requireActual('../../player/spotifyController');
      let linked = false;
      const remote = {
        connect: async () => { linked = true; },
        disconnect: async () => { linked = false; events.push('spotify-severed'); },
        isConnectedAsync: async () => linked,
        playUri: async () => {},
        pause: async () => { if (!linked) throw new Error('not connected'); events.push('spotify-paused'); },
        resume: async () => {},
        addListener: () => {},
        removeAllListeners: () => {},
      };
      const player = new SpotifyPlayerController({ remote, getToken: async () => 'spotify-token' });
      return {
        player,
        kokoSocket: { disconnect: () => { events.push('socket-severed'); } },
        playbackSocket: { ensureConnected: () => {} },
        orchestrator: { clear: () => {}, resume: () => {} },
      };
    });
    // The encrypted device store: the REAL SecureStore over an in-memory backend.
    jest.doMock('../../../storage/secureStoreFactory', () => {
      const { SecureStore } = jest.requireActual('../../../storage/secureStore');
      const backend = {
        encrypted: true,
        getString: (k: string) => keys.get(k),
        set: (k: string, v: string) => { keys.set(k, v); },
        delete: (k: string) => { keys.delete(k); },
        getAllKeys: () => [...keys.keys()],
        clearAll: () => { keys.clear(); },
      };
      const store = new SecureStore({ backend, cipher: { encrypt: (v: string) => v, decrypt: (v: string) => v } });
      return { createSecureStore: async () => store };
    });
    (global as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
      const method = init.method ?? 'GET';
      const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } });
      if (method === 'POST' && path === '/api/auth/logout') { events.push('server-logout'); return json(200, {}); }
      if (method === 'DELETE' && path === '/api/auth/account') {
        events.push('server-delete');
        const status = opts.deleteStatus ?? 200;
        return json(status, status < 400 ? { deleted: true } : { error: 'failed' });
      }
      return json(404, {});
    });

    const { startApp } = require('../../../prodBootstrap');
    const { profileController } = require('../profileServices');
    const { authSession } = require('../../../auth/session');
    const { currentUserStore } = require('../../../auth/currentUser');
    const { player } = require('../../playback/playbackServices');
    const { connectStore, resolvedKey, moodOnlyKey } = require('../../connect/connectStore');
    return { startApp, profileController, authSession, currentUserStore, player, connectStore, resolvedKey, moodOnlyKey, events, slots, keys };
  }

  async function signedIn(w: ReturnType<typeof load>) {
    await w.startApp(); // RA-5: the teardown removes keys through the store the boot opened
    await w.authSession.setSession({ access: 'access-a', refresh: 'refresh-a' });
    w.currentUserStore.getState().setUser({ id: UID_A, displayName: 'A', email: 'a@x.io' });
    await w.player.connect();
    w.keys.set(w.resolvedKey(UID_A), '1');
    w.keys.set(w.moodOnlyKey(UID_A), '1');
    w.keys.set(w.resolvedKey(UID_B), '1');
    w.keys.set('koko.onboarding.seen', '1');
    w.keys.set('koko.liveMode', '0');
    w.events.length = 0;
  }

  afterEach(() => {
    jest.dontMock('react-native');
    jest.dontMock('react-native-keychain');
    jest.dontMock('@react-native-google-signin/google-signin');
    jest.dontMock('../../playback/playbackServices');
    jest.dontMock('../../../storage/secureStoreFactory');
  });

  it('account deletion: server first, Spotify paused before it is severed, Google revoked then signed out, then the record', async () => {
    const w = load();
    await signedIn(w);

    const res = await w.profileController.deleteAccount();

    expect(res.ok).toBe(true);
    expect(w.events).toEqual([
      'server-delete', 'socket-severed', 'spotify-paused', 'spotify-severed',
      'google-revoke', 'google-signOut', 'session-record-wiped',
    ]);
    expect(w.slots.has(SESSION_SLOT)).toBe(false);
    expect(w.currentUserStore.getState().user).toBeNull();
  });

  it('account deletion removes this account\'s device keys by prefix; other accounts\' and the device\'s keys stay', async () => {
    const w = load();
    await signedIn(w);

    await w.profileController.deleteAccount();

    expect([...w.keys.keys()].sort()).toEqual([w.resolvedKey(UID_B), 'koko.liveMode', 'koko.onboarding.seen'].sort());
    expect([...w.keys.keys()].some((k) => k.includes(UID_A))).toBe(false);
  });

  it('logout signs out of Google without a revoke, and keeps every per-account key', async () => {
    const w = load();
    await signedIn(w);

    await w.profileController.logout();

    expect(w.events).toEqual([
      'server-logout', 'socket-severed', 'spotify-paused', 'spotify-severed', 'google-signOut', 'session-record-wiped',
    ]);
    expect(w.keys.get(w.resolvedKey(UID_A))).toBe('1');
    expect(w.keys.get(w.moodOnlyKey(UID_A))).toBe('1');
  });

  it('a deletion the server refused tears nothing down and removes no key', async () => {
    const w = load({ deleteStatus: 500 });
    await signedIn(w);

    const res = await w.profileController.deleteAccount();

    expect(res.ok).toBe(false);
    expect(w.events).toEqual(['server-delete']);
    expect(w.keys.get(w.resolvedKey(UID_A))).toBe('1');
    expect(w.authSession.hasSession()).toBe(true);
  });
});
