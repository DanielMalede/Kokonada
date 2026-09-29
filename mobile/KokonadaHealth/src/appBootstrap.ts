// The single ignition sequence for the app. Replaces App.tsx's bare startPlayback()
// call, which left cold persistence un-bootstrapped and (because the socket was gated
// on an empty AuthSession) the socket unconnected. Pure and fully injectable so the
// sequencing is unit-tested; startAppBootstrap() below composes the prod singletons.

export interface ColdPersistenceLike {
  rehydrate(): void;
  attach(): void;
}

export interface AppBootstrapDeps {
  bootstrapSession: () => Promise<boolean>;
  getUserId: () => string | null;
  connectSocket: () => void;
  connectPlayer: () => void;
  startBiometrics: () => Promise<unknown>;
  setupColdPersistence: () => ColdPersistenceLike;
}

export async function bootstrapApp(deps: AppBootstrapDeps): Promise<void> {
  try {
    const authed = await deps.bootstrapSession();

    if (!authed) return;

    // H2: the player is attempted only with a Kokonada session — a signed-out connect fell
    // through to Spotify's login screen at launch. The prod binding adds the "linked" half
    // (experience/player/playerBootGate).
    deps.connectPlayer();

    deps.connectSocket();
    // Fire-and-forget, but never let a rejected biometrics start surface as an
    // unhandled rejection (the real startBiometrics is fail-soft; be defensive).
    Promise.resolve(deps.startBiometrics()).catch(() => {});

    // Cold persistence is namespaced by userId; only wire it once a user is known,
    // so committed intent is never spilled to a global key. rehydrate BEFORE attach.
    if (deps.getUserId()) {
      const cp = deps.setupColdPersistence();
      cp.rehydrate();
      cp.attach();
    }
  } catch {
    // Bootstrap must never throw into React's render — degrade gracefully.
  }
}
