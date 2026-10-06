// The permission gate on the merged manifest of every variant that can be uploaded (MB-093;
// CMP-113). assertManifests.mjs runs it on each such manifest, in CI's Android job.
//
// The merged manifest is what an APK or an AAB declares once every library's manifest is folded in.
// The source manifest is not: rxandroidble 1.17.2 (under react-native-ble-plx) adds
// <uses-permission-sdk-23> COARSE and FINE location with no maxSdkVersion, and a check on the
// source manifest never saw them. So the rules are checked here, by attribute:
//   · no <uses-permission-sdk-23> entry, or its alias <uses-permission-sdk-m>, for any location
//     permission;
//   · no COARSE or BACKGROUND location, in any form;
//   · ACCESS_FINE_LOCATION, BLUETOOTH and BLUETOOTH_ADMIN only with maxSdkVersion <= 30 (the legacy
//     Bluetooth scan on Android 11 and below);
//   · BLUETOOTH_SCAN carries usesPermissionFlags="neverForLocation";
//   · every permission is on the allow-list below, so a library cannot add one silently. A new
//     permission is added here on purpose, in a reviewed change, with its declarations updated.

const P = (p) => `android.permission.${p}`;

// Derived from the merged release manifest at 55d68cc (processReleaseMainManifest), less the two
// rxandroidble rows. `${package}` is the manifest's own package.
export const RELEASE_PERMISSIONS = [
  // The app's own manifest (android/app/src/main/AndroidManifest.xml).
  P('INTERNET'),
  P('health.READ_HEART_RATE'),
  P('health.READ_HEART_RATE_VARIABILITY'),
  P('health.READ_SLEEP'),
  P('health.READ_RESTING_HEART_RATE'),
  P('health.READ_HEALTH_DATA_HISTORY'),
  P('BLUETOOTH_SCAN'),
  P('BLUETOOTH_CONNECT'),
  P('BLUETOOTH'),
  P('BLUETOOTH_ADMIN'),
  P('ACCESS_FINE_LOCATION'),
  // react-native-keychain (biometric unlock of the stored credential).
  P('USE_BIOMETRIC'),
  P('USE_FINGERPRINT'),
  // react-native-haptic-feedback.
  P('VIBRATE'),
  // androidx.core: a signature permission that guards the app's own non-exported receivers.
  '${package}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
];

// The debug build types (debug, debugOptimized) may also hold what react-android's debug library
// declares for the dev overlay. Never release.
export const DEBUG_ONLY_PERMISSIONS = [P('SYSTEM_ALERT_WINDOW')];

/** Which allow-list a variant gets: 'debug' for the debug build types, else 'release', the strictest. */
export const allowListName = (variant) => (/^debug/.test(variant) ? 'debug' : 'release');

/** The permissions a variant may declare. A variant the gate does not know gets release's list. */
export function allowedPermissions(variant, pkg) {
  const names = allowListName(variant) === 'debug' ? [...RELEASE_PERMISSIONS, ...DEBUG_ONLY_PERMISSIONS] : RELEASE_PERMISSIONS;
  return new Set(names.map((n) => n.replace('${package}', pkg)));
}

const CAPPED_AT_30 = new Set([P('ACCESS_FINE_LOCATION'), P('BLUETOOTH'), P('BLUETOOTH_ADMIN')]);
const NEVER_DECLARED = new Set([P('ACCESS_COARSE_LOCATION'), P('ACCESS_BACKGROUND_LOCATION')]);
const isLocation = (name) => /^android\.permission\.\w*LOCATION\w*$/.test(name);
const cappedAt30 = (max) => typeof max === 'string' && /^\d+$/.test(max) && Number(max) <= 30;
const neverForLocation = (flags) => typeof flags === 'string' && flags.split('|').map((f) => f.trim()).includes('neverForLocation');

/**
 * Problems in the permission entries of an uploadable variant's merged manifest. [] when clean.
 * entries: [{ element, name, maxSdkVersion, flags }], as manifestFacts reads them.
 */
export function permissionProblems(entries, { variant, pkg }) {
  const list = allowListName(variant);
  const allowed = allowedPermissions(variant, pkg);
  const problems = [];
  for (const { element, name, maxSdkVersion, flags } of entries) {
    if (!name) problems.push(`declares a <${element}> with no android:name`);
    else if (element !== 'uses-permission' && isLocation(name)) {
      problems.push(`declares <${element}> ${name}: location for API 23 and up, which nothing in the app uses; remove it in the main manifest with tools:node="remove"`);
    } else if (NEVER_DECLARED.has(name)) problems.push(`declares ${name}: COARSE and BACKGROUND location are never declared, in any form`);
    else if (CAPPED_AT_30.has(name) && !cappedAt30(maxSdkVersion)) {
      problems.push(`declares ${name} with maxSdkVersion=${maxSdkVersion ?? 'none'}: it is allowed only up to API 30 (maxSdkVersion <= 30)`);
    } else if (name === P('BLUETOOTH_SCAN') && !neverForLocation(flags)) {
      problems.push('declares BLUETOOTH_SCAN without usesPermissionFlags="neverForLocation": a scan must never derive location');
    } else if (!allowed.has(name)) {
      problems.push(`declares ${name}, which is not on the ${list} permission allow-list (scripts/lab/uploadPermissions.mjs): a permission is added there on purpose, never silently by a library`);
    }
  }
  return problems;
}
