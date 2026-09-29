import { Platform } from 'react-native';
import { initialize, getGrantedPermissions } from 'react-native-health-connect';
import { createHealthLane, type HealthLane } from './healthLane';
import { startBiometrics, clearBiometricFeed } from './biometricsWiring';
import { fetchConsentStatus } from './consentApi';
import { clearWatchToken } from './liveHrClient';
import { liveHrSwitch } from './liveHrSwitch';
import { warmStore } from '../state/store';

// H2 — the production health lane and the handful of moments that drive it. The lane itself (the
// gate, the single session, the teardown order) is healthLane.ts; this file only binds it to the
// real device and names the triggers, so every caller goes through ONE singleton:
//
//   boot / sign-in ......... healthLane.evaluate({ allowStart: true })   (prodBootstrap)
//   a new wearable link .... onWearableLinked()                          (connectController)
//   back to the foreground . recheckHealthOnForeground() — stop only     (AppLifecycle, DT-H2-5 F1)
//   consent withdrawn ...... onConsentWithdrawn()                        (ProfileScreen)
//   Disconnect (live HR) ... onLiveHrDisconnected()                      (ProfileScreen)
//   logout / delete ........ stopLaneThenClearToken(...)                 (profileServices)

/**
 * This PHONE holds a Health Connect grant for Kokonada. Reads the OS grant table and never shows
 * UI; not Android, or any failure, reads as no link. The grant belongs to the phone, not to an
 * account, so on its own it is never the opt-in (review H2-C1) — see hasWearableOptIn.
 */
export async function hasHealthConnectLink(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    if (!(await initialize())) return false;
    const granted = await getGrantedPermissions();
    return Array.isArray(granted) && granted.length > 0;
  } catch {
    return false;
  }
}

/**
 * The wearable opt-in (compliance B5, review H2-C1): the signed-in ACCOUNT made an explicit wearable
 * link on THIS phone (the per-account marker, written only by onWearableLinked) AND the phone still
 * holds the Health Connect grant (it can be revoked in Settings). The marker is read first, so an
 * account that never linked here costs nothing at all: no Health Connect call, no network.
 */
export async function hasWearableOptIn(): Promise<boolean> {
  if (!liveHrSwitch.isLinkedHere()) return false;
  return hasHealthConnectLink();
}

export const healthLane: HealthLane = createHealthLane({
  hasWearableOptIn,
  fetchConsentStatus,
  startFeed: (isActive) => startBiometrics({ warm: warmStore, isActive }),
  clearFeed: () => clearBiometricFeed(warmStore),
  clearWatchToken,
  feedSwitchedOff: () => liveHrSwitch.isOff(),
  forgetWearableOptIn: () => liveHrSwitch.unlink(),
});

/**
 * The logout / account-delete binding for sessionTeardown's watch-credential step: the running
 * feed stops FIRST (so a late reading can never refill the warm store after its reset, and no push
 * rides the credential being wiped), then the credential is cleared. The teardown ORDER itself is
 * unchanged — this only adds the stop inside the existing slot. A failing stop never blocks the wipe.
 */
export async function stopLaneThenClearToken(
  lane: Pick<HealthLane, 'stop'>,
  clear: () => Promise<void>,
): Promise<void> {
  try { await lane.stop(); } catch { /* the credential wipe must still happen */ }
  await clear();
}

/** The explicit wearable-path action — a real Health Connect grant through the consent wall on THIS
 *  phone (connectController.runSync) — and the ONLY way an account becomes linked here: it marks
 *  the account linked with live HR on, and starts the feed if the gate is open. */
export function onWearableLinked(): Promise<boolean> {
  liveHrSwitch.markLinked();
  return healthLane.evaluate({ allowStart: true });
}

/** Disconnect on the Live heart rate card: switch live HR off for this account, durably (it stays
 *  off across restarts until the next wearable link), stop the feed and forget the credential. The
 *  link itself stays, so the Art.9 sync keeps running; a Disconnect never creates a link. */
export async function onLiveHrDisconnected(): Promise<void> {
  liveHrSwitch.switchOff();
  await healthLane.stop({ forgetToken: true });
}

/** A successful consent withdrawal: the account's wearable link on this phone ends (compliance B5 —
 *  a re-consent given elsewhere never reopens it; only a new link here does), the feed stops and
 *  the credential the server just revoked is forgotten, so a later re-link mints a fresh one. */
export async function onConsentWithdrawn(): Promise<void> {
  liveHrSwitch.unlink();
  await healthLane.stop({ forgetToken: true });
}

/** Return to the foreground (DT-H2-5 F1): re-check the gate, which can only STOP a running feed —
 *  it never starts one, so it can never silently mint right after a Disconnect. */
export function recheckHealthOnForeground(): Promise<boolean> {
  return healthLane.evaluate({ allowStart: false });
}
