// jest.setup.js globally mocks '@kokonada/spotify-remote' (the package specifier)
// for app-level consumers; since that specifier resolves to this very file, the
// global mock would otherwise clobber the real implementation under test here.
// Unmock it so this suite exercises the actual wrapper, not the app-wide stub.
jest.unmock('@kokonada/spotify-remote');

// The native spec calls TurboModuleRegistry.getEnforcing which throws under jest,
// so mock the spec module and the emitter. We verify the wrapper's thin mapping.
jest.mock('../NativeSpotifyRemote', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    isSpotifyInstalled: jest.fn().mockResolvedValue(true),
    connect: jest.fn().mockResolvedValue(undefined),
    playUri: jest.fn().mockResolvedValue(undefined),
    getTrackImage: jest.fn().mockResolvedValue('file:///cache/cover.jpg'),
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

test('getTrackImage delegates to the native spec (resolves a file:// path)', async () => {
  await expect(SpotifyRemote.getTrackImage('spotify:image:abc')).resolves.toBe('file:///cache/cover.jpg');
});

test('onPlayerStateChanged forwards the current track imageUri to the callback', () => {
  let captured: (p: any) => void = () => {};
  mockAddListener.mockImplementationOnce((_e: string, cb: (p: any) => void) => { captured = cb; return { remove: jest.fn() }; });
  const seen: any[] = [];
  SpotifyRemote.onPlayerStateChanged((s) => seen.push(s));
  captured({ trackUri: 'spotify:track:z', isPaused: false, imageUri: 'spotify:image:zz' });
  expect(seen[0].imageUri).toBe('spotify:image:zz');
});
