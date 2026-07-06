import { bootstrapApp, type ColdPersistenceLike } from './appBootstrap';
import { authSession } from './auth/session';
import { apiGet } from './net/apiClient';
import { currentUserStore, getCurrentUserId } from './auth/currentUser';
import type { KokonadaUser } from './auth/auth';
import { playbackSocket, player } from './experience/playback/playbackServices';
import { startBiometrics } from './health/biometricsWiring';
import { warmStore, store } from './state/store';
import { ColdPersistence } from './state/cold/coldPersistence';
import { setColdPersistence } from './state/cold/coldPersistenceHolder';
import { createSecureStore } from './storage/secureStoreFactory';
import { bindLiveModeKV } from './experience/generate/liveModeStore';
import type { SecureStore } from './storage/secureStore';

// Production ignition. Composes the tested `bootstrapApp` sequence with the real
// singletons, adds identity recovery (a stored session → GET /api/auth/me → currentUser
// so a returning user lands on the tabs), and exposes onSignedIn() for the login flow
// to wire the authenticated session. Everything is guarded — bootstrap must never throw
// into React's render.

let secureStore: SecureStore | null = null;

function makeColdPersistence(): ColdPersistenceLike {
  if (!secureStore) return { rehydrate() {}, attach() {} };
  const cp = new ColdPersistence({ store, secure: secureStore, getUserId: getCurrentUserId, throttleMs: 400 });
  setColdPersistence(cp);
  return cp;
}

export async function startApp(): Promise<void> {
  try {
    secureStore = await createSecureStore();
  } catch {
    secureStore = null;
  }

  // Persist the Live/Manual preference through the same encrypted store (Part 2b),
  // adapted to the KV port bindLiveModeKV expects. Best-effort — a null store just
  // leaves liveMode at its in-memory Manual default.
  const s = secureStore;
  if (s) bindLiveModeKV({ getString: (k) => s.getItem(k) ?? undefined, set: (k, v) => { s.setItem(k, v); } });

  // Recover the logged-in identity from a stored session (currentUser is in-memory and
  // does not survive a restart; the token does).
  try {
    if (await authSession.bootstrap()) {
      const me = await apiGet<KokonadaUser>('/api/auth/me');
      if (me.ok) currentUserStore.getState().setUser(me.data);
      else await authSession.clear(); // dead token → land on SignIn
    }
  } catch {
    /* degrade to signed-out */
  }

  await bootstrapApp({
    bootstrapSession: async () => authSession.getAccessToken() !== null,
    getUserId: getCurrentUserId,
    connectSocket: () => playbackSocket.ensureConnected(),
    connectPlayer: () => { void player.connect(); },
    startBiometrics: () => startBiometrics({ warm: warmStore }),
    setupColdPersistence: makeColdPersistence,
  });
}

// After a fresh login: wire the authenticated session (socket + biometrics + cold
// persistence for the now-known user). Mirrors bootstrapApp's post-auth steps.
export async function onSignedIn(): Promise<void> {
  try {
    playbackSocket.ensureConnected();
    void startBiometrics({ warm: warmStore });
    if (getCurrentUserId()) {
      const cp = makeColdPersistence();
      cp.rehydrate();
      cp.attach();
    }
  } catch {
    /* best-effort */
  }
}
