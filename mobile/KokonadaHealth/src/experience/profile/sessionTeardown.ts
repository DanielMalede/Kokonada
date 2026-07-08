// The local half of logout / account-deletion: tear down every piece of session
// state on-device in a SAFE ORDER. Each step is injected so the order is unit-tested
// and every step is best-effort (a failing teardown step must never block the rest —
// a half-torn-down session that still shows tabs is worse than a clean sign-out).

export interface SessionTeardownDeps {
  disconnectSocket: () => void;       // detach the live socket first (no late events)
  disposePlayer: () => Promise<void> | void;
  clearAuthSession: () => Promise<void> | void; // rotating pair
  clearWatchToken: () => Promise<void> | void;  // BLE watch device token
  clearLegacyToken: () => Promise<void> | void; // purge any leftover pre-migration session JWT
  wipeColdPersistence: () => void;    // detach writer, clear MMKV, reset intent
  resetWarm: () => void;
  resetNowPlaying: () => void;
  resetPlaybackError: () => void;
  resetLiveMode: () => void;          // D-9: Live/Manual preference is persisted — reset to Manual
  clearCurrentUser: () => void;       // flips the auth gate to SignIn
}

async function safe(fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); } catch { /* best-effort: one failed step must not block the rest */ }
}

export async function wipeLocalSession(deps: SessionTeardownDeps): Promise<void> {
  // 1. Sever the socket BEFORE anything else so no late buffered event lands mid-wipe.
  await safe(deps.disconnectSocket);
  await safe(deps.disposePlayer);
  // 2. Destroy every credential plane.
  await safe(deps.clearAuthSession);
  await safe(deps.clearWatchToken);
  await safe(deps.clearLegacyToken);
  // 3. Wipe persisted + in-memory state (cold persistence detaches its writer first).
  await safe(deps.wipeColdPersistence);
  await safe(deps.resetWarm);
  await safe(deps.resetNowPlaying);
  await safe(deps.resetPlaybackError);
  await safe(deps.resetLiveMode);
  // 4. Drop the identity LAST — this is what flips the UI to the SignIn gate.
  await safe(deps.clearCurrentUser);
}
