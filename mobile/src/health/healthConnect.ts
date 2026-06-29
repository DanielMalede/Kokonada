import { Linking, Platform } from 'react-native';
import {
  initialize,
  getSdkStatus,
  requestPermission,
  getGrantedPermissions,
  SdkAvailabilityStatus,
  type Permission,
} from 'react-native-health-connect';
import { HEALTH_PERMISSIONS, hasGrantedRecord } from './permissions';
import { HEALTH_CONNECT_PACKAGE } from './config';

export type Availability = 'available' | 'install-required' | 'unsupported';

// Step 1 — is Health Connect usable on this device?
export async function checkAvailability(): Promise<Availability> {
  if (Platform.OS !== 'android') return 'unsupported';
  const status = await getSdkStatus();
  if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
  // 1 = SDK_UNAVAILABLE, 2 = SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
  return 'install-required';
}

// Deep-link the user to install/update Health Connect (Android ≤13).
export function openHealthConnectInStore(): void {
  Linking.openURL(`market://details?id=${HEALTH_CONNECT_PACKAGE}`).catch(() =>
    Linking.openURL(
      `https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`,
    ),
  );
}

// Step 2 — initialise the client and request the one-tap permission set.
// Returns the permissions the user actually granted.
export async function requestHealthPermissions(): Promise<Permission[]> {
  const isInitialized = await initialize();
  if (!isInitialized) {
    throw new Error('Health Connect failed to initialize');
  }
  return requestPermission(HEALTH_PERMISSIONS);
}

export async function getGranted(): Promise<Permission[]> {
  return getGrantedPermissions();
}

// True once the history permission is granted — required to read older than 30 days.
export async function hasHistoryAccess(): Promise<boolean> {
  const granted = await getGrantedPermissions();
  return hasGrantedRecord(granted, 'ReadHealthDataHistory');
}
