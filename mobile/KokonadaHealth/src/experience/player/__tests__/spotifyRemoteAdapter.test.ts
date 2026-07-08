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
    authorize: jest.fn().mockResolvedValue('token'),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockResolvedValue(true),
    playUri: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    skipNext: jest.fn().mockResolvedValue(undefined),
    skipPrevious: jest.fn().mockResolvedValue(undefined),
    skipToIndex: jest.fn().mockResolvedValue(undefined),
    setShuffle: jest.fn().mockResolvedValue(undefined),
    setRepeat: jest.fn().mockResolvedValue(undefined),
    getPlayerState: jest.fn().mockResolvedValue({ isPaused: true, trackUri: 'spotify:track:x' }),
    onRemoteDisconnected: jest.fn(() => () => {}),
    onPlayerStateChanged: jest.fn(() => () => {}),
  },
}));

import { SpotifyRemote } from '@kokonada/spotify-remote';
import { spotifyRemoteAdapter, getSpotifyReadiness } from '../spotifyRemoteAdapter';

// jest.mocked() gives back the same runtime object with each method's static type
// widened to include the jest.Mock matchers (e.g. mockResolvedValueOnce) used below.
const mockMod = jest.mocked(SpotifyRemote);

beforeEach(() => { jest.clearAllMocks(); }); // clears calls only — factory implementations survive

test('AUTHORIZE-ONCE: a silent connect succeeds with NO authorize Activity (the foreground-steal fix)', async () => {
  await spotifyRemoteAdapter.connect('IGNORED_TOKEN');
  expect(mockMod.authorize).not.toHaveBeenCalled(); // no login Activity — Spotify stays backgrounded
  expect(mockMod.connect).toHaveBeenCalledTimes(1);
  expect(mockMod.connect).toHaveBeenCalledWith(); // no args passed through
});

test('AUTHORIZE-ONCE: only a NOT_LOGGED_IN failure runs the one-time authorize, then reconnects', async () => {
  mockMod.connect
    .mockRejectedValueOnce(Object.assign(new Error('no grant'), { code: 'NOT_LOGGED_IN' }))
    .mockResolvedValueOnce(undefined);
  await spotifyRemoteAdapter.connect('IGNORED_TOKEN');
  expect(mockMod.authorize).toHaveBeenCalledTimes(1);
  expect(mockMod.connect).toHaveBeenCalledTimes(2); // silent attempt + post-grant attempt
});

test('AUTHORIZE-ONCE: a UserNotAuthorized failure ("Explicit user authorization is required") also runs authorize', async () => {
  // The Spotify App Remote SDK raises UserNotAuthorizedException when the app is logged in
  // but THIS app was never granted on-device access. It must drive the same one-time
  // authorize() as NOT_LOGGED_IN — matched by message even if the native code differs.
  mockMod.connect
    .mockRejectedValueOnce(
      Object.assign(new Error('Explicit user authorization is required to use Spotify.'), { code: 'USER_NOT_AUTHORIZED' }),
    )
    .mockResolvedValueOnce(undefined);
  await spotifyRemoteAdapter.connect('IGNORED_TOKEN');
  expect(mockMod.authorize).toHaveBeenCalledTimes(1);
  expect(mockMod.connect).toHaveBeenCalledTimes(2);
});

test('AUTHORIZE-ONCE: any other connect failure propagates without launching authorize', async () => {
  mockMod.connect.mockRejectedValueOnce(Object.assign(new Error('ipc'), { code: 'CONNECTION_FAILED' }));
  await expect(spotifyRemoteAdapter.connect('x')).rejects.toThrow('ipc');
  expect(mockMod.authorize).not.toHaveBeenCalled();
});

test('playContext plays the context uri, jumps to the row (when > 0), and pins shuffle/repeat off', async () => {
  await spotifyRemoteAdapter.playContext!('spotify:playlist:pl1', 3);
  expect(mockMod.playUri).toHaveBeenCalledWith('spotify:playlist:pl1');
  expect(mockMod.skipToIndex).toHaveBeenCalledWith('spotify:playlist:pl1', 3);
  expect(mockMod.setShuffle).toHaveBeenCalledWith(false);
  expect(mockMod.setRepeat).toHaveBeenCalledWith(0);

  jest.clearAllMocks();
  await spotifyRemoteAdapter.playContext!('spotify:playlist:pl1', 0);
  expect(mockMod.skipToIndex).not.toHaveBeenCalled(); // row 0 needs no jump
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

test('addListener wires playerStateChanged through onPlayerStateChanged (D-1)', () => {
  const cb = jest.fn();
  spotifyRemoteAdapter.addListener('playerStateChanged', cb);
  expect((mockMod as any).onPlayerStateChanged).toHaveBeenCalledWith(cb);
});
