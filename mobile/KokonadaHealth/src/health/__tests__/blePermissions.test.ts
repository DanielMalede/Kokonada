// H2 (DT-H2-2 option 1): the live-HR lane may only CHECK the Bluetooth grant, never ASK for it.
// The "Nearby devices" prompt (and the location prompt on API 26–30) needs a prominent in-app
// disclosure immediately before it (Play User Data policy, compliance C6), and that disclosure
// does not exist yet — it is P6's job. Until then nothing in the lane may reach requestMultiple.
//
// The react-native mock below is a stateful fake of the OS grant table: `check` answers from the
// table and a test can flip entries, so the assertions run against real lookup semantics rather
// than a canned return value.

const mockGrants = new Map<string, boolean>();
const mockPlatform = { OS: 'android', Version: 31 as number | string };

jest.mock('react-native', () => ({
  get Platform() { return mockPlatform; },
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    check: jest.fn(async (p: string) => mockGrants.get(p) === true),
    requestMultiple: jest.fn(),
  },
}));

import { PermissionsAndroid } from 'react-native';
import { checkBlePermissions } from '../blePermissions';

const check = PermissionsAndroid.check as unknown as jest.Mock;
const requestMultiple = PermissionsAndroid.requestMultiple as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGrants.clear();
  mockPlatform.OS = 'android';
  mockPlatform.Version = 31;
});

describe('checkBlePermissions — read the grant, never prompt', () => {
  it('API 31+: true only when BOTH scan and connect are already granted, and never prompts', async () => {
    mockGrants.set('scan', true);
    mockGrants.set('connect', true);
    await expect(checkBlePermissions()).resolves.toBe(true);
    expect(check.mock.calls.map((c) => c[0]).sort()).toEqual(['connect', 'scan']);
    expect(requestMultiple).not.toHaveBeenCalled();
  });

  it('API 31+: one missing grant is a false, never a prompt', async () => {
    mockGrants.set('scan', true);
    await expect(checkBlePermissions()).resolves.toBe(false);
    expect(requestMultiple).not.toHaveBeenCalled();
  });

  it('API 30 and below: checks fine location (the pre-12 BLE scan gate), never prompts', async () => {
    mockPlatform.Version = 30;
    mockGrants.set('loc', true);
    await expect(checkBlePermissions()).resolves.toBe(true);
    expect(check.mock.calls.map((c) => c[0])).toEqual(['loc']);
    expect(requestMultiple).not.toHaveBeenCalled();
  });

  it('a string Platform.Version is parsed like the numeric one', async () => {
    mockPlatform.Version = '29';
    await expect(checkBlePermissions()).resolves.toBe(false);
    expect(check.mock.calls.map((c) => c[0])).toEqual(['loc']);
  });

  it('a throwing permission read fails closed to false', async () => {
    check.mockImplementationOnce(async () => { throw new Error('binder died'); });
    mockGrants.set('scan', true);
    mockGrants.set('connect', true);
    await expect(checkBlePermissions()).resolves.toBe(false);
    expect(requestMultiple).not.toHaveBeenCalled();
  });

  it('non-Android has no BLE path: false without touching the permission API', async () => {
    mockPlatform.OS = 'ios';
    await expect(checkBlePermissions()).resolves.toBe(false);
    expect(check).not.toHaveBeenCalled();
    expect(requestMultiple).not.toHaveBeenCalled();
  });
});
