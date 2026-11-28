// The local half of logout / account-deletion: tear down every piece of session
// state on-device in a SAFE ORDER. Each step is injected so the order is unit-tested
// and every step is best-effort (a failing teardown step must never block the rest —
// a half-torn-down session that still shows tabs is worse than a clean sign-out).
//
// C9 (design v2 B1, P1 charter §2) adds, without changing v1's steps or their order:
//   - a provider sign-out before the credential clear (revoke first on accountDeleted);
//   - a context naming the ended epoch: once a newer session is held, no step (the credential clear
//     included) touches what that session owns;
//   - a bound of TEARDOWN_STEP_MS on every step;
//   - one teardown per epoch (createSessionTeardown);
//   - on accountDeleted, the account's per-account device keys removed by prefix.

export interface SessionTeardownDeps {
  disconnectSocket: () => void;       // detach the live socket first (no late events)
  disposePlayer: () => Promise<void> | void; // pauses Spotify, then severs App Remote (spotifyController.dispose)
  clearAuthSession: () => Promise<void> | void; // rotating pair: the session record goes with it
  clearWatchToken: () => Promise<void> | void;  // BLE watch device token
  clearLegacyToken: () => Promise<void> | void; // purge any leftover pre-migration session JWT
  wipeColdPersistence: () => void;    // detach writer, clear MMKV, reset intent
  resetWarm: () => void;
  resetNowPlaying: () => void;
  resetPlaybackError: () => void;
  resetLiveMode: () => void;          // D-9: Live/Manual preference is persisted — reset to Manual
  clearCurrentUser: () => void;       // flips the auth gate to SignIn
  // C9, all optional so a v1 composition keeps working unchanged.
  revokeProvider?: () => Promise<void> | void;  // accountDeleted only, before signOutProvider
  signOutProvider?: () => Promise<void> | void; // before the credential clear, at every end
  removeAccountKeys?: (uid: string) => Promise<void> | void; // accountDeleted only
  sessionEpoch?: () => number;        // AuthSession.sessionEpoch
  hasSession?: () => boolean;         // AuthSession.hasSession
  stepTimeoutMs?: number;             // TEARDOWN_STEP_MS unless a test says otherwise
}

// Precedence (P1 charter: accountDeleted over loggedOut over sessionEnded).
export type TeardownReason = 'loggedOut' | 'accountDeleted' | 'sessionEnded';
const PRECEDENCE: Record<TeardownReason, number> = { sessionEnded: 0, loggedOut: 1, accountDeleted: 2 };

export interface TeardownContext {
  reason: TeardownReason;
  // The epoch of the session that ended (AuthSession.sessionEpoch() read while it was held, or the
  // ended epoch an `ended` event names).
  epoch: number;
  // The account that ended; null when it is not known, and then no account key is removed.
  uid: string | null;
}

// P1 charter §16 (DEC-087): 1500 ms per step.
export const TEARDOWN_STEP_MS = 1500;

async function safe(fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); } catch { /* best-effort: one failed step must not block the rest */ }
}

// A step that never settles holds the teardown for `ms` at most; it may still finish later.
async function bounded(fn: (() => Promise<void> | void) | undefined, ms: number): Promise<void> {
  if (!fn) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  try {
    await Promise.race([safe(fn), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// A newer session is held: a sign-in landed after the ended epoch. From then on every step that acts
// on the app's singletons (or on the provider's signed-in account) belongs to that session and is
// skipped. With no session held (the ended one, already cleared by AuthSession or by this teardown)
// nothing is newer.
function superseded(deps: SessionTeardownDeps, ctx: TeardownContext | undefined): boolean {
  if (!ctx || !deps.sessionEpoch || !deps.hasSession) return false;
  return deps.hasSession() && deps.sessionEpoch() !== ctx.epoch;
}

export async function wipeLocalSession(deps: SessionTeardownDeps, ctx?: TeardownContext): Promise<void> {
  const ms = deps.stepTimeoutMs ?? TEARDOWN_STEP_MS;
  const step = (fn?: () => Promise<void> | void) => bounded(fn, ms);
  const reason = ctx?.reason ?? 'loggedOut';
  const scoped = (fn?: () => Promise<void> | void) => (superseded(deps, ctx) ? Promise.resolve() : step(fn));

  // 1. Sever the socket BEFORE anything else so no late buffered event lands mid-wipe.
  await scoped(deps.disconnectSocket);
  await scoped(deps.disposePlayer);
  // 2. Sign out of the provider while its account is still the ended one (a revoke needs it signed in).
  if (reason === 'accountDeleted') await scoped(deps.revokeProvider);
  await scoped(deps.signOutProvider);
  // 3. Destroy every credential plane. The session clear is scoped to the ended epoch: it runs while
  //    that epoch is current or no session is held (AuthSession ended it already; clearing again
  //    re-wipes a record its own clear may have failed to remove), never once a newer one is held.
  //    The check and the clear's synchronous start (AuthSession.end moves the epoch) share one turn.
  await scoped(deps.clearAuthSession);
  await scoped(deps.clearWatchToken);
  await scoped(deps.clearLegacyToken);
  // 4. Wipe persisted + in-memory state (cold persistence detaches its writer first).
  await scoped(deps.wipeColdPersistence);
  await scoped(deps.resetWarm);
  await scoped(deps.resetNowPlaying);
  await scoped(deps.resetPlaybackError);
  await scoped(deps.resetLiveMode);
  // 5. The deleted account's device keys are its own, whoever is signed in now.
  if (reason === 'accountDeleted') await removeKeys(deps, ctx, ms);
  // 6. Drop the identity LAST — this is what flips the UI to the SignIn gate.
  await scoped(deps.clearCurrentUser);
}

function removeKeys(deps: SessionTeardownDeps, ctx: TeardownContext | undefined, ms: number): Promise<void> {
  const uid = ctx?.uid;
  const remove = deps.removeAccountKeys;
  if (!uid || !remove) return Promise.resolve();
  return bounded(() => remove(uid), ms);
}

// One teardown per epoch. A second request for an epoch already torn down (or being torn down)
// shares that teardown; one of higher precedence (accountDeleted after a logout) adds only its own
// steps, after the first has finished.
export function createSessionTeardown(deps: SessionTeardownDeps): (ctx: TeardownContext) => Promise<void> {
  const byEpoch = new Map<number, { reason: TeardownReason; done: Promise<void> }>();
  return (ctx) => {
    const prior = byEpoch.get(ctx.epoch);
    if (!prior) {
      const done = wipeLocalSession(deps, ctx);
      byEpoch.set(ctx.epoch, { reason: ctx.reason, done });
      return done;
    }
    if (PRECEDENCE[ctx.reason] <= PRECEDENCE[prior.reason]) return prior.done;
    const ms = deps.stepTimeoutMs ?? TEARDOWN_STEP_MS;
    const done = prior.done.then(async () => {
      if (ctx.reason !== 'accountDeleted') return;
      if (!superseded(deps, ctx)) await bounded(deps.revokeProvider, ms);
      if (!superseded(deps, ctx)) await bounded(deps.signOutProvider, ms);
      await removeKeys(deps, ctx, ms);
    });
    byEpoch.set(ctx.epoch, { reason: ctx.reason, done });
    return done;
  };
}
