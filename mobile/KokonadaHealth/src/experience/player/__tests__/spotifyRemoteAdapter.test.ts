// Verify the adapter maps @kokonada/spotify-remote onto SpotifyRemoteLike, ignoring
// the token arg (App Remote has no token), and maps player state shape.
//
// Note: the mock is built entirely inline inside the jest.mock() factory (rather
// than assigned from an outer `const mod = {...}` as in the task brief's snippet)
// because babel-jest-hoist moves jest.mock() calls above ALL other top-level
// statements — including a preceding `const` — so a factory that just returns an
// outer variable would capture it before it's initialized. Instead the real mock
// object is obtained afterwards by importing the (now-mocked) module directly,
// which is the standard, hoisting-safe Jest pattern.
jest.mock('@kokonada/spotify-remote', () => ({
  SpotifyRemote: {
    configure: jest.fn(),
    isSpotifyInstalled: jest.fn().mockResolvedValue(true),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockResolvedValue(true),
    playUri: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    getPlayerState: jest.fn().mockResolvedValue({ isPaused: true, trackUri: 'spotify:track:x' }),
    onRemoteDisconnected: jest.fn(() => () => {}),
  },
}));

import { SpotifyRemote } from '@kokonada/spotify-remote';
import { spotifyRemoteAdapter, getSpotifyReadiness } from '../spotifyRemoteAdapter';

// jest.mocked() gives back the same runtime object with each method's static type
// widened to include the jest.Mock matchers (e.g. mockResolvedValueOnce) used below.
const mockMod = jest.mocked(SpotifyRemote);

test('connect ignores the token arg and calls native connect', async () => {
  await spotifyRemoteAdapter.connect('IGNORED_TOKEN');
  expect(mockMod.connect).toHaveBeenCalledTimes(1);
  expect(mockMod.connect).toHaveBeenCalledWith(); // no args passed through
});

test('getPlayerState maps trackUri onto track.uri', async () => {
  const s = await spotifyRemoteAdapter.getPlayerState!();
  expect(s).toEqual({ isPaused: true, track: { uri: 'spotify:track:x' } });
});

test('getSpotifyReadiness returns "ready" when installed, null when not', async () => {
  mockMod.isSpotifyInstalled.mockResolvedValueOnce(true);
  await expect(getSpotifyReadiness()).resolves.toBe('ready');
  mockMod.isSpotifyInstalled.mockResolvedValueOnce(false);
  await expect(getSpotifyReadiness()).resolves.toBeNull();
});

test('addListener wires remoteDisconnected through onRemoteDisconnected', () => {
  const cb = jest.fn();
  spotifyRemoteAdapter.addListener('remoteDisconnected', cb);
  expect(mockMod.onRemoteDisconnected).toHaveBeenCalledWith(cb);
});
