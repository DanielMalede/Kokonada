import { PermissionsAndroid, Platform } from 'react-native';

// Android's BLE permission model split at API 31 (Android 12):
//   • API ≥ 31 → runtime BLUETOOTH_SCAN + BLUETOOTH_CONNECT (no location needed if
//     the scan is flagged neverForLocation, which react-native-ble-plx does).
//   • API ≤ 30 → BLE scanning is gated behind ACCESS_FINE_LOCATION.
// The matching <uses-permission> entries live in native-snippets/AndroidManifest.additions.xml.

function apiLevel(): number {
  return typeof Platform.Version === 'number'
    ? Platform.Version
    : parseInt(String(Platform.Version), 10) || 0;
}

/** The runtime permissions this device needs to scan/connect over BLE. */
export function requiredBlePermissions(): string[] {
  if (Platform.OS !== 'android') return [];
  return apiLevel() >= 31
    ? [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
}

/**
 * Report whether ALL the BLE permissions are ALREADY granted, without ever showing a prompt.
 * This is the only BLE permission call the live-HR lane makes (H2): the "Nearby devices"
 * prompt (and the location prompt on API 26–30) needs a prominent in-app disclosure right
 * before it, which does not exist yet. Any read error fails closed to false.
 */
export async function checkBlePermissions(): Promise<boolean> {
  const perms = requiredBlePermissions();
  if (perms.length === 0) return false; // non-Android: no BLE path
  try {
    for (const p of perms) {
      if (!(await PermissionsAndroid.check(p as any))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Request the BLE permissions and report whether ALL were granted. A single denial
 * means the caller must fall back to the REST path — never silently degrade to a
 * broken BLE stream.
 *
 * NOT called by the live-HR lane (H2). Reserved for the Connect page (P6), which must show
 * the Bluetooth disclosure immediately before it; a static guard pins that nothing else calls it.
 */
export async function requestBlePermissions(): Promise<boolean> {
  const perms = requiredBlePermissions();
  if (perms.length === 0) return false; // non-Android: no BLE path
  const result = await PermissionsAndroid.requestMultiple(perms as any);
  return perms.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}
