// RA-3, RA-4, RA-6 (PR #321, C9): the teardown over the REAL AuthSession and stateful fakes.
// As proposed in PR321_resilience_audit_caec348.md; the only change is `void` replaced by a held
// promise in the first case (the repo's eslint no-void rule).
import { AuthSession, type TokenPair } from '../auth/authSession';
import { createSessionTeardown, type SessionTeardownDeps } from '../experience/profile/sessionTeardown';

const UID_A = 'a'.repeat(24);
const UID_B = 'b'.repeat(24);

function world() {
  const disk: { record: TokenPair | null } = { record: null };
  const session = new AuthSession({
    loadTokens: async () => disk.record,
    saveTokens: async (t) => { disk.record = t; },
    clearTokens: async () => { disk.record = null; },
    refreshEndpoint: async () => ({ kind: 'dead' }),
  });
  // The Google SDK as it behaves: one signed-in account; a revoke needs it.
  const google = { account: null as string | null, revoked: [] as string[] };
  const state = { user: null as string | null, warm: null as string | null, nowPlaying: null as string | null, keysRemoved: [] as string[] };
  const deps: SessionTeardownDeps = {
    disconnectSocket: () => {},
    disposePlayer: () => {},
    revokeProvider: async () => { if (!google.account) throw new Error('SIGN_IN_REQUIRED'); google.revoked.push(google.account); },
    signOutProvider: async () => { google.account = null; },
    clearAuthSession: () => session.clear(),
    clearWatchToken: () => {},
    clearLegacyToken: () => {},
    wipeColdPersistence: () => {},
    resetWarm: () => { state.warm = null; },
    resetNowPlaying: () => { state.nowPlaying = null; },
    resetPlaybackError: () => {},
    resetLiveMode: () => {},
    removeAccountKeys: (uid) => { state.keysRemoved.push(uid); },
    clearCurrentUser: () => { state.user = null; },
    sessionEpoch: () => session.sessionEpoch(),
    hasSession: () => session.hasSession(),
  };
  const signIn = async (uid: string) => {
    await session.setSession({ access: `access-${uid}`, refresh: `refresh-${uid}` });
    google.account = uid;
    state.user = uid;
  };
  return { disk, session, google, state, deps, signIn };
}

afterEach(() => { jest.useRealTimers(); });

describe('shadow · C9 teardown boundaries (PR #321)', () => {
  it('the whole teardown settles within 3000 ms however many steps hang (charter :905)', async () => {
    jest.useFakeTimers();
    const w = world();
    await w.signIn(UID_A);
    const never = (() => new Promise<void>(() => {})) as any;
    Object.assign(w.deps, {
      disconnectSocket: never, disposePlayer: never, signOutProvider: never,
      clearWatchToken: never, clearLegacyToken: never, wipeColdPersistence: never,
    });

    let done = false;
    const running = createSessionTeardown(w.deps)({ reason: 'loggedOut', epoch: w.session.sessionEpoch(), uid: UID_A })
      .then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(3000);

    expect(done).toBe(true);
    expect(w.session.hasSession()).toBe(false);
    expect(w.state.user).toBeNull();
    await running;
  });

  it("a sign-in mid-teardown never inherits the ended account's warm or now-playing state", async () => {
    const w = world();
    await w.signIn(UID_A);
    w.state.warm = 'A-live-hr';
    w.state.nowPlaying = 'A-track';
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    let disposing = false;
    w.deps.disposePlayer = () => { disposing = true; return hold; };

    const running = createSessionTeardown(w.deps)({ reason: 'loggedOut', epoch: w.session.sessionEpoch(), uid: UID_A });
    for (let i = 0; i < 100 && !disposing; i++) await Promise.resolve();
    expect(disposing).toBe(true);
    await w.signIn(UID_B);
    release();
    await running;

    expect(w.session.getAccessToken()).toBe(`access-${UID_B}`);
    expect(w.state.user).toBe(UID_B);
    expect(w.google.account).toBe(UID_B);
    expect(w.state.warm).not.toBe('A-live-hr');
    expect(w.state.nowPlaying).not.toBe('A-track');
  });

  it("an accountDeleted escalation for A after B signed in touches neither B's Google account nor B's session", async () => {
    const w = world();
    await w.signIn(UID_A);
    const epochA = w.session.sessionEpoch();
    const teardown = createSessionTeardown(w.deps);
    await teardown({ reason: 'loggedOut', epoch: epochA, uid: UID_A });
    await w.signIn(UID_B);

    await teardown({ reason: 'accountDeleted', epoch: epochA, uid: UID_A });

    expect(w.google.account).toBe(UID_B);
    expect(w.google.revoked).toEqual([]);
    expect(w.session.getAccessToken()).toBe(`access-${UID_B}`);
    expect(w.state.keysRemoved).toEqual([UID_A]);
  });
});
