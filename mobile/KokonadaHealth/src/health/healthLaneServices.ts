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
 * The wearable opt-in (DT-H2-1 option A): this device holds a Health Connect grant for Kokonada.
 * That grant is reachable only through the Art.9 consent wall (connectController), so a mood-only
 * account never has one. Reads the OS grant table and never shows UI; not Android, or any failure,
 * reads as no link.
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

export const healthLane: HealthLane = createHealthLane({
  hasWearableOptIn: hasHealthConnectLink,
  fetchConsentStatus,
  startFeed: (isActive) => startBiometrics({ warm: warmStore, isActive }),
  clearFeed: () => clearBiometricFeed(warmStore),
  clearWatchToken,
  feedSwitchedOff: () => liveHrSwitch.isOff(),
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

/** An explicit wearable-path action (a Health Connect link through the consent wall) switches live
 *  HR back on for this account and starts it if the gate is open. */
export function onWearableLinked(): Promise<boolean> {
  liveHrSwitch.switchOn();
  return healthLane.evaluate({ allowStart: true });
}

/** Disconnect on the Live heart rate card: switch live HR off for this account, durably (it stays
 *  off across restarts until the next wearable link), stop the feed and forget the credential. */
export async function onLiveHrDisconnected(): Promise<void> {
  liveHrSwitch.switchOff();
  await healthLane.stop({ forgetToken: true });
}

/** A successful consent withdrawal: stop the feed and forget the credential the server just
 *  revoked, so a later re-consent mints a fresh one instead of pushing a dead one. */
export async function onConsentWithdrawn(): Promise<void> {
  await healthLane.stop({ forgetToken: true });
}

/** Return to the foreground (DT-H2-5 F1): re-check the gate, which can only STOP a running feed —
 *  it never starts one, so it can never silently mint right after a Disconnect. */
export function recheckHealthOnForeground(): Promise<boolean> {
  return healthLane.evaluate({ allowStart: false });
}
