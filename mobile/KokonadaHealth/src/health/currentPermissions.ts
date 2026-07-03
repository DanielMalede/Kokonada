import { Platform, PermissionsAndroid } from 'react-native';
import { getGrantedPermissions } from 'react-native-health-connect';
import type { Grant } from '../state/warm/warmStore';

// Reads the CURRENT OS permission grants for the biometric lanes, used by the
// foreground reconcile to detect a permission revoked while backgrounded (e.g. the
// user turned Bluetooth off). Best-effort and fail-closed: any read error → denied,
// so a severed lane is reflected rather than a stale "granted". On-device glue.
export async function readCurrentPermissions(): Promise<{ bluetooth: Grant; health: Grant }> {
  let bluetooth: Grant = 'unknown';
  let health: Grant = 'unknown';

  try {
    if (Platform.OS === 'android') {
      const ok = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT as any,
      );
      bluetooth = ok ? 'granted' : 'denied';
    } else {
      bluetooth = 'granted'; // iOS BLE is gated at connect time, not a checkable grant
    }
  } catch {
    bluetooth = 'denied';
  }

  try {
    const granted = await getGrantedPermissions();
    health = Array.isArray(granted) && granted.length > 0 ? 'granted' : 'denied';
  } catch {
    health = 'denied';
  }

  return { bluetooth, health };
}
