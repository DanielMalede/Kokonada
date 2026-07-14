import { Linking } from 'react-native';

// The App Remote wake path is the production `player` (SpotifyPlayerController) singleton; mock it so
// the wiring's reuse of the EXISTING connect/wake path is observable without the native graph.
jest.mock('../../playback/playbackServices', () => ({
  player: { connect: jest.fn().mockResolvedValue(true) },
}));

import { SpotifyRemote } from '@kokonada/spotify-remote';
import { player } from '../../playback/playbackServices';
import { isSpotifyInstalled, foregroundSpotify, getSpotifyApp } from '../spotifyLinkBack';

const connect = player.connect as jest.Mock;
const installed = SpotifyRemote.isSpotifyInstalled as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  connect.mockResolvedValue(true);
});

describe('spotifyLinkBack — installed check reuses the existing native probe', () => {
  it('reflects SpotifyRemote.isSpotifyInstalled() → true', async () => {
    installed.mockResolvedValueOnce(true);
    expect(await isSpotifyInstalled()).toBe(true);
  });
  it('reflects SpotifyRemote.isSpotifyInstalled() → false', async () => {
    installed.mockResolvedValueOnce(false);
    expect(await isSpotifyInstalled()).toBe(false);
  });
  it('returns false (never throws) when the native probe rejects', async () => {
    installed.mockRejectedValueOnce(new Error('native boom'));
    await expect(isSpotifyInstalled()).resolves.toBe(false);
  });
});

describe('spotifyLinkBack — foregroundSpotify reuses the App Remote connect/wake path', () => {
  it('wakes Spotify through player.connect() (the existing path, not a new native call)', async () => {
    await foregroundSpotify();
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it('never throws into the UI when the wake connect rejects', async () => {
    connect.mockRejectedValueOnce(new Error('remote severed'));
    await expect(foregroundSpotify()).resolves.toBeUndefined();
  });
});

describe('spotifyLinkBack — getSpotifyApp fallback opens the download URL', () => {
  it('opens the Spotify download URL via Linking', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    await getSpotifyApp();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toMatch(/spotify\.com/);
  });
  it('never throws when Linking fails', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no handler'));
    await expect(getSpotifyApp()).resolves.toBeUndefined();
  });
});
