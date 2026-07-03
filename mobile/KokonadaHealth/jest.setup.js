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

// ── Native visual libraries (Skia / Reanimated / gesture-handler) ────────────
// The A8 wheel/aura are verified on-device; headless renders (App smoke test) use
// lightweight stubs. The math they call (wheelGeometry/auraUniforms/laneCommit) is
// unit-tested directly, so these stubs never hide behavior.
jest.mock('react-native-reanimated', () => ({
  runOnJS: (fn) => fn,
  useSharedValue: (v) => ({ value: v }),
  useAnimatedStyle: (fn) => fn(),
  withTiming: (v) => v,
}));

const StubView = ({ children }) => children ?? null;
jest.mock('@shopify/react-native-skia', () => ({
  Canvas: StubView, Group: StubView, Circle: StubView, Blur: StubView,
  RadialGradient: StubView, vec: (x, y) => ({ x, y }),
}));

jest.mock('react-native-gesture-handler', () => {
  const chain = () => new Proxy(() => chain(), { get: () => chain() });
  return {
    Gesture: { Tap: chain, Pan: chain },
    GestureDetector: ({ children }) => children,
  };
});
