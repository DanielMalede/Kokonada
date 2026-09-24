import { bootstrapApp, type ColdPersistenceLike } from './appBootstrap';
import { authSession } from './auth/session';
import { apiGet } from './net/apiClient';
import { currentUserStore, getCurrentUserId } from './auth/currentUser';
import type { KokonadaUser } from './auth/auth';
import { playbackSocket, player } from './experience/playback/playbackServices';
import { connectPlayerIfLinked } from './experience/player/playerBootGate';
import type { IntegrationsStatus } from './experience/profile/profileController';
import { healthLane } from './health/healthLaneServices';
import { bindLiveHrSwitchKV } from './health/liveHrSwitch';
import { syncMedicalProfile } from './health/healthSync';
import { store } from './state/store';
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
    // H2: the durable live-HR switch (Disconnect) persists per account through the same store.
    bindLiveHrSwitchKV(kv);
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

  // H2: the health lane's boot answer — does this signed-in account have a wearable link AND a
  // current Art.9 grant? Stays false when bootstrapApp never reaches the biometrics step (no session).
  let laneBoot: Promise<boolean> = Promise.resolve(false);

  await bootstrapApp({
    bootstrapSession: async () => authSession.getAccessToken() !== null,
    getUserId: getCurrentUserId,
    connectSocket: () => playbackSocket.ensureConnected(),
    // H2: only a signed-in account whose Spotify link the server confirms now (fail closed).
    connectPlayer: () => {
      void connectPlayerIfLinked({
        fetchIntegrations: () => apiGet<IntegrationsStatus>('/api/integrations/status'),
        connect: () => player.connect(),
      });
    },
    // H2 (DT-6): the live-HR feed, the whr_ mint and any Bluetooth use start ONLY through the
    // health lane — a wearable link AND a fresh, current Art.9 grant; a mood-only account makes no
    // health request at all. The lane holds the session handle, so logout / withdrawal can stop it.
    startBiometrics: () => (laneBoot = healthLane.evaluate({ allowStart: true })),
    setupColdPersistence: makeColdPersistence,
  });

  // D-4a: silent incremental medical-profile sync — never prompts, throttled to 12h via the
  // encrypted KV, fail-soft. H2: it reads Health Connect and uploads Art.9 data, so it waits for the
  // lane's answer and runs only when the gate is open — never signed out, never for a mood-only
  // account, never after a withdrawal (the OS Health Connect grant survives one).
  const kvForSync = s ? { getString: (k: string) => s.getItem(k), set: (k: string, v: string) => { s.setItem(k, v); } } : null;
  void laneBoot.then((open) => { if (open) void syncMedicalProfile({ kv: kvForSync }); }).catch(() => {});
}

// After a fresh login: wire the authenticated session (socket + biometrics + cold
// persistence for the now-known user). Mirrors bootstrapApp's post-auth steps.
export async function onSignedIn(): Promise<void> {
  try {
    playbackSocket.ensureConnected();
    // H2: the same gate as boot — the lane starts the feed only for a linked, consented account.
    void healthLane.evaluate({ allowStart: true });
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
