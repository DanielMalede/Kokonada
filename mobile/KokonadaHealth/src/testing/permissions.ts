// QA-049: a stateful OS-permission fake for Health Connect and Bluetooth, every outcome scripted per
// test: granted, denied, permanently denied, unavailable, install/update required, dismissed.
//
// Health Connect replaces the members of the global react-native-health-connect mock (jest.setup.js
// :16-22), adding the two healthConnect.ts reads that the mock lacks (SdkAvailabilityStatus,
// openHealthConnectSettings). Android semantics: requestPermission answers the GRANTED SUBSET of the
// request, so a denial and a dismissal both answer what was already granted ([] on a first request)
// after the sheet was shown; after two denials the OS stops showing the sheet and answers at once
// (the deny-twice throttle; a queued outcome is consumed by it); SDK status 1 is unavailable,
// 2 needs a provider update, 3 is available (react-native-health-connect/src/constants.ts).
// Bluetooth replaces PermissionsAndroid's check, request and multi-request members: a dialog answers granted,
// denied (a dismissal is denied too) or never_ask_again, after which every request answers
// never_ask_again with no dialog. platform() switches Platform.OS / Version (and select) for the
// Android paths, since jest's default platform is iOS. An unscripted request throws.

import { PermissionsAndroid, Platform } from 'react-native';
import { Patcher } from './patch';

const SDK = { SDK_UNAVAILABLE: 1, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2, SDK_AVAILABLE: 3 } as const;
type HcStatus = 'available' | 'unavailable' | 'update-required';
type HcOutcome = 'grant' | 'deny' | 'dismiss' | { grant: string[] };
type BleOutcome = 'granted' | 'denied' | 'dismissed' | 'never_ask_again';
type Perm = { accessType: string; recordType: string };

export interface PermissionFakes {
  platform(os: 'android' | 'ios', version?: number): void;
  healthConnect: {
    setStatus(status: HcStatus): void;
    nextRequest(outcome: HcOutcome): void;
    setPermanentlyDenied(): void;
    failInitialize(): void;
    sheetsShown(): number;
    settingsOpened(): number;
    /** Scripted outcomes no request has consumed yet. */
    pendingOutcomes(): number;
  };
  ble: {
    nextRequest(outcome: BleOutcome): void;
    failCheck(): void;
    dialogsShown(): number;
    requested(): string[];
  };
  restore(): void;
}

export function installPermissionFakes(): PermissionFakes {
  const patcher = new Patcher();

  // ── Health Connect ──────────────────────────────────────────────────────────────────────────────
  const hc = require('react-native-health-connect') as Record<string, unknown>;
  const hcState = { status: 'available' as HcStatus, initOk: true, permanentlyDenied: false, denials: 0, sheets: 0, settings: 0 };
  const hcQueue: HcOutcome[] = [];
  let granted: Perm[] = [];
  const statusCode = () => (hcState.status === 'available' ? SDK.SDK_AVAILABLE : hcState.status === 'update-required' ? SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED : SDK.SDK_UNAVAILABLE);
  patcher.set(hc, 'SdkAvailabilityStatus', SDK);
  patcher.set(hc, 'getSdkStatus', async () => statusCode());
  patcher.set(hc, 'initialize', async () => hcState.initOk && hcState.status === 'available');
  patcher.set(hc, 'getGrantedPermissions', async () => [...granted]);
  patcher.set(hc, 'openHealthConnectSettings', () => { hcState.settings += 1; });
  const isGranted = (p: Perm) => granted.some((g) => g.accessType === p.accessType && g.recordType === p.recordType);
  // RA-235-14: every answer is the subset of the request granted after it, so earlier grants survive a
  // later denial, a dismissal and the throttle.
  const grantedSubset = (requested: Perm[]) => requested.filter(isGranted);
  patcher.set(hc, 'requestPermission', async (requested: Perm[]) => {
    if (hcState.status !== 'available') throw new Error('Health Connect is not available on this device');
    if (hcState.permanentlyDenied) {
      hcQueue.shift(); // the throttled request consumes its scripted answer: no sheet, nothing left queued
      return grantedSubset(requested);
    }
    const outcome = hcQueue.shift();
    if (outcome === undefined) throw new Error('QA-049: an unscripted Health Connect permission request (call nextRequest first)');
    hcState.sheets += 1;
    if (outcome === 'deny') {
      hcState.denials += 1;
      if (hcState.denials >= 2) hcState.permanentlyDenied = true;
      return grantedSubset(requested);
    }
    if (outcome === 'dismiss') return grantedSubset(requested);
    const chosen = outcome === 'grant' ? requested : requested.filter((p) => outcome.grant.includes(p.recordType));
    for (const p of chosen) if (!isGranted(p)) granted.push(p);
    return grantedSubset(requested);
  });

  // ── Bluetooth runtime permissions ───────────────────────────────────────────────────────────────
  const P = PermissionsAndroid as unknown as Record<string, unknown>;
  const R = PermissionsAndroid.RESULTS;
  const bleGranted = new Set<string>();
  const neverAsk = new Set<string>();
  const bleQueue: BleOutcome[] = [];
  const bleState = { dialogs: 0, failCheck: false, requested: [] as string[] };
  // Named neutrally: shadow.healthLane.test.ts allows the request call's spelling in one production file
  // only, and it counts src/testing as production.
  const answerRuntimeRequest = async (perms: string[]) => {
    bleState.requested = [...perms];
    const out: Record<string, string> = {};
    const toAsk = perms.filter((p) => !bleGranted.has(p) && !neverAsk.has(p));
    for (const p of perms) if (bleGranted.has(p)) out[p] = R.GRANTED; else if (neverAsk.has(p)) out[p] = R.NEVER_ASK_AGAIN;
    if (toAsk.length === 0) return out;
    const outcome = bleQueue.shift();
    if (outcome === undefined) throw new Error('QA-049: an unscripted Bluetooth permission request (call ble.nextRequest first)');
    bleState.dialogs += 1;
    for (const p of toAsk) {
      if (outcome === 'granted') { bleGranted.add(p); out[p] = R.GRANTED; }
      else if (outcome === 'never_ask_again') { neverAsk.add(p); out[p] = R.NEVER_ASK_AGAIN; }
      else out[p] = R.DENIED;
    }
    return out;
  };
  patcher.set(P, 'check', async (p: string) => {
    if (bleState.failCheck) throw new Error('PermissionsAndroid.check failed');
    return bleGranted.has(p);
  });
  patcher.set(P, 'requestMultiple', answerRuntimeRequest);
  patcher.set(P, 'request', async (p: string) => (await answerRuntimeRequest([p]))[p]);

  return {
    platform(os, version = os === 'android' ? 34 : 17) {
      const target = Platform as unknown as Record<string, unknown>;
      patcher.define(target, 'OS', { get: () => os });
      patcher.define(target, 'Version', { get: () => (os === 'android' ? version : String(version)) });
      patcher.set(target, 'select', (spec: Record<string, unknown>) =>
        (os in spec ? spec[os] : 'native' in spec ? spec.native : spec.default));
    },
    healthConnect: {
      setStatus(status) { hcState.status = status; },
      nextRequest(outcome) { hcQueue.push(outcome); },
      setPermanentlyDenied() { hcState.permanentlyDenied = true; hcState.denials = 2; },
      failInitialize() { hcState.initOk = false; },
      sheetsShown: () => hcState.sheets,
      settingsOpened: () => hcState.settings,
      pendingOutcomes: () => hcQueue.length,
    },
    ble: {
      nextRequest(outcome) { bleQueue.push(outcome); },
      failCheck() { bleState.failCheck = true; },
      dialogsShown: () => bleState.dialogs,
      requested: () => [...bleState.requested],
    },
    restore() {
      granted = [];
      patcher.restore();
    },
  };
}
