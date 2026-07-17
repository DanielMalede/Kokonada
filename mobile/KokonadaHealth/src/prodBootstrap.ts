import { bootstrapApp, type ColdPersistenceLike } from './appBootstrap';
import { authSession } from './auth/session';
import { apiGet } from './net/apiClient';
import { currentUserStore, getCurrentUserId } from './auth/currentUser';
import type { KokonadaUser } from './auth/auth';
import { playbackSocket, player } from './experience/playback/playbackServices';
import { startBiometrics } from './health/biometricsWiring';
import { syncMedicalProfile } from './health/healthSync';
import { warmStore, store } from './state/store';
import { ColdPersistence } from './state/cold/coldPersistence';
import { setColdPersistence } from './state/cold/coldPersistenceHolder';
import { createSecureStore } from './storage/secureStoreFactory';
import { bindLiveModeKV } from './experience/generate/liveModeStore';
import { bindOnboardingKV } from './onboarding/onboardingStore';
import { bindConnectKV } from './experience/connect/connectStore';
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
  if (s) {
    const kv = { getString: (k: string) => s.getItem(k) ?? undefined, set: (k: string, v: string) => { s.setItem(k, v); } };
    bindLiveModeKV(kv);
    // Hydrate the one-shot FTUE flag so the splash can resolve straight to Sign-in for a
    // returning (but logged-out) device, skipping Onboarding.
    bindOnboardingKV(kv);
  }

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

  // §4: hydrate the Connect gate for THIS account (per-userId keys) AFTER /me recovery, so the
  // splash resolves straight to the app for an already-resolved returning user (no connect flash),
  // and to Connect Services for a fresh/unresolved one. Runs before the dwell (startApp is awaited).
  if (s) {
    const connectKv = { getString: (k: string) => s.getItem(k) ?? undefined, set: (k: string, v: string) => { s.setItem(k, v); } };
    bindConnectKV(connectKv, getCurrentUserId);
  }

  await bootstrapApp({
    bootstrapSession: async () => authSession.getAccessToken() !== null,
    getUserId: getCurrentUserId,
    connectSocket: () => playbackSocket.ensureConnected(),
    connectPlayer: () => { void player.connect(); },
    startBiometrics: () => startBiometrics({ warm: warmStore }),
    setupColdPersistence: makeColdPersistence,
  });

  // D-4a: silent incremental medical-profile sync — only runs if Health Connect
  // permission was already granted (never prompts), throttled to 12h via the encrypted
  // KV, fail-soft (a missing/erroring HC degrades to no-op, never blocks bootstrap).
  const kvForSync = s ? { getString: (k: string) => s.getItem(k), set: (k: string, v: string) => { s.setItem(k, v); } } : null;
  void syncMedicalProfile({ kv: kvForSync });
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
      // §4: hydrate the Connect gate for the freshly-signed-in account — a returning account that
      // already resolved on this device skips Connect Services; a new one sees it.
      if (secureStore) {
        const store = secureStore;
        bindConnectKV({ getString: (k: string) => store.getItem(k) ?? undefined, set: (k: string, v: string) => { store.setItem(k, v); } }, getCurrentUserId);
      }
    }
  } catch {
    /* best-effort */
  }
}
