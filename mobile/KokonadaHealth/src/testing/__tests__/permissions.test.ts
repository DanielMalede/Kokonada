import { PermissionsAndroid, Platform } from 'react-native';
import { checkAvailability, requestHealthPermissions, getGranted, hasHistoryAccess, openHealthConnectSettings } from '../../health/healthConnect';
import { checkBlePermissions, requestBlePermissions, requiredBlePermissions } from '../../health/blePermissions';
import { HEALTH_PERMISSIONS } from '../../health/permissions';
import { createConnectController, type ConnectControllerDeps } from '../../experience/connect/connectController';
import { installPermissionFakes, type PermissionFakes } from '../permissions';

// QA-049: Health Connect, Bluetooth and other OS permission outcomes (granted, denied, permanently
// denied, unavailable, install/update required, dismissed) are scripted per test. The global mocks fix
// one answer each ("available, nothing granted", jest.setup.js:16-22; BLE a bare constructor, :6-14),
// and the HC mock lacks SdkAvailabilityStatus and openHealthConnectSettings, which healthConnect.ts
// uses. Semantics kept from Android: an HC request returns the GRANTED SUBSET, so a denial and a
// dismissal both answer [] after a sheet was shown; after two denials the OS stops showing the sheet
// and answers [] at once (the deny-twice throttle, connectController.ts:58-60); a runtime BLE request
// answers granted / denied (a dismissal is denied) / never_ask_again, the last with no dialog.
// Pass rule: QA-143 has one test per outcome on this fake (P6 at G9, owed).

let fakes: PermissionFakes;
beforeEach(() => { fakes = installPermissionFakes(); });
afterEach(() => { fakes.restore(); });

const ALL = HEALTH_PERMISSIONS.length;

describe('QA-049 · Health Connect outcomes through the real healthConnect.ts', () => {
  beforeEach(() => { fakes.platform('android', 34); });

  it('available, then granted: the sheet is shown once and the grant persists', async () => {
    expect(await checkAvailability()).toBe('available');
    fakes.healthConnect.nextRequest('grant');
    expect(await requestHealthPermissions()).toHaveLength(ALL);
    expect(await getGranted()).toHaveLength(ALL);
    expect(await hasHistoryAccess()).toBe(true);
    expect(fakes.healthConnect.sheetsShown()).toBe(1);
  });

  it('partially granted: only the chosen record types come back', async () => {
    fakes.healthConnect.nextRequest({ grant: ['HeartRate'] });
    const granted = await requestHealthPermissions();
    expect(granted.map((p: any) => p.recordType)).toEqual(['HeartRate']);
    expect(await hasHistoryAccess()).toBe(false);
  });

  it.each(['deny', 'dismiss'] as const)('%s: the sheet was shown and the answer is []', async (outcome) => {
    fakes.healthConnect.nextRequest(outcome);
    expect(await requestHealthPermissions()).toEqual([]);
    expect(fakes.healthConnect.sheetsShown()).toBe(1);
  });

  it('permanently denied: after two denials the OS answers [] with no sheet', async () => {
    fakes.healthConnect.nextRequest('deny');
    await requestHealthPermissions();
    fakes.healthConnect.nextRequest('deny');
    await requestHealthPermissions();
    fakes.healthConnect.nextRequest('grant'); // the user would grant, but is never asked
    expect(await requestHealthPermissions()).toEqual([]);
    expect(fakes.healthConnect.sheetsShown()).toBe(2);
    openHealthConnectSettings();
    expect(fakes.healthConnect.settingsOpened()).toBe(1);
  });

  it.each([
    ['unavailable', 1],
    ['update-required', 2],
  ] as const)('%s (SDK status %i): install-required, and no sheet is reachable', async (status) => {
    fakes.healthConnect.setStatus(status);
    expect(await checkAvailability()).toBe('install-required');
  });

  it('initialize failing is an error, never a silent grant', async () => {
    fakes.healthConnect.failInitialize();
    await expect(requestHealthPermissions()).rejects.toThrow(/failed to initialize/);
  });

  it('not Android: unsupported', async () => {
    fakes.platform('ios');
    expect(await checkAvailability()).toBe('unsupported');
  });
});

describe('QA-049 · the real connect controller on the fake', () => {
  beforeEach(() => { fakes.platform('android', 34); });
  const deps = (): ConnectControllerDeps => ({
    checkAvailability,
    fetchConsentStatus: async () => ({ ok: true, data: { granted: true, staleVersion: false } as any }),
    grantConsent: async () => ({ ok: true, data: { granted: true } as any }),
    requestHealthPermissions,
    syncMedicalProfile: async () => ({ synced: true } as any),
    createConsentFlow: jest.fn() as any,
    markResolved: jest.fn(),
  });

  it.each([
    ['granted', () => fakes.healthConnect.nextRequest('grant'), 'connected'],
    ['denied', () => fakes.healthConnect.nextRequest('deny'), 'permission-blocked'],
    ['dismissed', () => fakes.healthConnect.nextRequest('dismiss'), 'permission-blocked'],
    ['permanently denied', () => fakes.healthConnect.setPermanentlyDenied(), 'permission-blocked'],
    ['unavailable', () => fakes.healthConnect.setStatus('unavailable'), 'install-required'],
    ['update required', () => fakes.healthConnect.setStatus('update-required'), 'install-required'],
    ['not Android', () => fakes.platform('ios'), 'unsupported'],
  ] as const)('%s → %s', async (_name, script, kind) => {
    script();
    const d = deps();
    const outcome = await createConnectController(d).begin();
    expect(outcome.kind).toBe(kind);
    expect((d.markResolved as jest.Mock).mock.calls.length).toBe(kind === 'connected' ? 1 : 0);
  });
});

describe('QA-049 · Bluetooth outcomes through the real blePermissions.ts', () => {
  it('API 31+: scan and connect, granted', async () => {
    fakes.platform('android', 34);
    fakes.ble.nextRequest('granted');
    expect(await requestBlePermissions()).toBe(true);
    expect(await checkBlePermissions()).toBe(true);
    expect(fakes.ble.dialogsShown()).toBe(1);
    expect(fakes.ble.requested()).toEqual([PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]);
  });

  it('API 26–30: fine location, the pre-31 model', async () => {
    fakes.platform('android', 29);
    fakes.ble.nextRequest('granted');
    expect(await requestBlePermissions()).toBe(true);
    expect(fakes.ble.requested()).toEqual([PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]);
  });

  it.each(['denied', 'dismissed'] as const)('%s: false, and the check stays false', async (outcome) => {
    fakes.platform('android', 34);
    fakes.ble.nextRequest(outcome);
    expect(await requestBlePermissions()).toBe(false);
    expect(await checkBlePermissions()).toBe(false);
  });

  it('never ask again: false with no dialog from then on', async () => {
    fakes.platform('android', 34);
    fakes.ble.nextRequest('never_ask_again');
    expect(await requestBlePermissions()).toBe(false);
    expect(fakes.ble.dialogsShown()).toBe(1);
    fakes.ble.nextRequest('granted');
    expect(await requestBlePermissions()).toBe(false);
    expect(fakes.ble.dialogsShown()).toBe(1);
  });

  it('unavailable (not Android): no BLE path, nothing requested', async () => {
    fakes.platform('ios');
    expect(requiredBlePermissions()).toEqual([]);
    expect(await requestBlePermissions()).toBe(false);
    expect(fakes.ble.dialogsShown()).toBe(0);
  });

  it('a check that throws fails closed', async () => {
    fakes.platform('android', 34);
    fakes.ble.failCheck();
    expect(await checkBlePermissions()).toBe(false);
  });
});

describe('QA-049 · restore', () => {
  it('puts the platform and both mocks back', () => {
    const os = Platform.OS;
    const check = PermissionsAndroid.check;
    fakes.platform('android', 34);
    fakes.restore();
    expect(Platform.OS).toBe(os);
    expect(PermissionsAndroid.check).not.toBe(check);
    expect(jest.isMockFunction(require('react-native-health-connect').requestPermission)).toBe(true);
    fakes = installPermissionFakes();
  });
});
