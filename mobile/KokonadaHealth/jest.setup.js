/* global jest */
// Global mocks for native modules so headless jest runs (App smoke test, screens)
// never touch real BLE / Health Connect / Keychain / Google native code. Per-file
// jest.mock() calls still override these with test-specific behavior.

jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => ({
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    destroy: jest.fn(),
    connectToDevice: jest.fn(),
  })),
  BleErrorCode: {},
}));

jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn().mockResolvedValue(true),
  readRecords: jest.fn().mockResolvedValue({ records: [] }),
  requestPermission: jest.fn().mockResolvedValue([]),
  getSdkStatus: jest.fn().mockResolvedValue(3),
  getGrantedPermissions: jest.fn().mockResolvedValue([]),
}));

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn().mockResolvedValue(true),
  getGenericPassword: jest.fn().mockResolvedValue(false),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
}));
