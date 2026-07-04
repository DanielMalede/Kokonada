// The native spec calls TurboModuleRegistry.getEnforcing which throws under jest,
// so mock the spec module and the emitter. We verify the wrapper's thin mapping.
jest.mock('../NativeSpotifyRemote', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    isSpotifyInstalled: jest.fn().mockResolvedValue(true),
    connect: jest.fn().mockResolvedValue(undefined),
    playUri: jest.fn().mockResolvedValue(undefined),
  },
}));

// Note: jest's mock-hoisting only permits out-of-scope variables prefixed with
// "mock" inside a jest.mock() factory, so this deviates from a plain `addListener`
// name used in the task brief's snippet.
const mockAddListener = jest.fn(() => ({ remove: jest.fn() }));
jest.mock('react-native', () => ({
  NativeModules: { SpotifyRemote: {} },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({ addListener: mockAddListener })),
}));

import { SpotifyRemote } from '../index';

test('isSpotifyInstalled delegates to the native spec', async () => {
  await expect(SpotifyRemote.isSpotifyInstalled()).resolves.toBe(true);
});

test('onRemoteDisconnected subscribes and returns an unsubscribe', () => {
  const off = SpotifyRemote.onRemoteDisconnected(() => {});
  expect(mockAddListener).toHaveBeenCalledWith('remoteDisconnected', expect.any(Function));
  expect(typeof off).toBe('function');
});
