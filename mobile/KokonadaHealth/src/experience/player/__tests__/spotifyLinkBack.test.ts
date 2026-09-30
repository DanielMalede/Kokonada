/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { Linking } from 'react-native';

// The App Remote wake path is the production `player` (SpotifyPlayerController) singleton; mock it so
// the wiring's reuse of the EXISTING connect/wake path is observable without the native graph.
jest.mock('../../playback/playbackServices', () => ({
  player: { connect: jest.fn().mockResolvedValue(true) },
}));

import { SpotifyRemote } from '@kokonada/spotify-remote';
import { player } from '../../playback/playbackServices';
import { isSpotifyInstalled, foregroundSpotify, openSpotifyWebPage } from '../spotifyLinkBack';

const connect = player.connect as jest.Mock;
const installed = SpotifyRemote.isSpotifyInstalled as jest.Mock;

const TRACK_ID = '11dFghVXANMlKmJXsNCbNl';
const TRACK_URI = `spotify:track:${TRACK_ID}`;
const DOWNLOAD_PAGE = /spotify\.com\/download/;

// Every URI a link-back action must refuse: nothing is opened for any of them.
const UNLINKABLE: Array<string | null> = [
  null,
  '',
  'spotify:',
  'spotify:track:',
  'spotify:user:someone',
  `spotify:track:${TRACK_ID}?si=abc`,
  `spotify:track:${TRACK_ID} `,
];

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  connect.mockResolvedValue(true);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
});
afterEach(() => openURL.mockRestore());

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

// HX-4 M1: installed → open EXACTLY the displayed item's URI. This retires the bare-scheme pin that
// stood here (`openURL('spotify:')`, which landed on Spotify's home screen, not the item) — a RETIRE
// pre-approved by DEC-091.
describe('spotifyLinkBack — foregroundSpotify opens the exact item in the Spotify app', () => {
  it('opens exactly the track URI it is given — once, and never the bare "spotify:" scheme', async () => {
    await foregroundSpotify(TRACK_URI);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(TRACK_URI);
    expect(openURL).not.toHaveBeenCalledWith('spotify:');
  });

  it.each(['spotify:album:4aawyAB9vmqN3uQ7FjRGTy', 'spotify:playlist:3cEYpjA9oz9GiPac4AsH4n'])(
    'opens an album or playlist URI exactly: %s',
    async (uri) => {
      await foregroundSpotify(uri);
      expect(openURL.mock.calls).toEqual([[uri]]);
    },
  );

  it('still wakes the App Remote through the existing connect path after opening (playback continuity)', async () => {
    await foregroundSpotify(TRACK_URI);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(openURL.mock.invocationCallOrder[0]).toBeLessThan(connect.mock.invocationCallOrder[0]);
  });

  it.each(UNLINKABLE)('opens NOTHING (and wakes nothing) for an unlinkable URI: %p', async (uri) => {
    await foregroundSpotify(uri);
    expect(openURL).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('never throws into the UI when the link-back openURL rejects', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(foregroundSpotify(TRACK_URI)).resolves.toBeUndefined();
  });

  it('never throws into the UI when the wake connect rejects', async () => {
    connect.mockRejectedValueOnce(new Error('remote severed'));
    await expect(foregroundSpotify(TRACK_URI)).resolves.toBeUndefined();
  });
});

// HX-4 M2: not installed ("GET SPOTIFY FREE") → the SAME item's open.spotify.com page, never the
// download page (the pin that stood here asserted the download URL; brief M2 reverses it).
describe('spotifyLinkBack — openSpotifyWebPage opens the same item on open.spotify.com', () => {
  it.each([
    [TRACK_URI, `https://open.spotify.com/track/${TRACK_ID}`],
    ['spotify:album:4aawyAB9vmqN3uQ7FjRGTy', 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy'],
    ['spotify:playlist:3cEYpjA9oz9GiPac4AsH4n', 'https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n'],
  ])('%s → %s, exactly once, never the download page', async (uri, web) => {
    await openSpotifyWebPage(uri);
    expect(openURL.mock.calls).toEqual([[web]]);
    expect(String(openURL.mock.calls[0][0])).not.toMatch(DOWNLOAD_PAGE);
  });

  it.each(UNLINKABLE)('opens NOTHING for an unlinkable URI (no download-page fallback): %p', async (uri) => {
    await openSpotifyWebPage(uri);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('never wakes the App Remote (Spotify is not installed on this branch)', async () => {
    await openSpotifyWebPage(TRACK_URI);
    expect(connect).not.toHaveBeenCalled();
  });

  it('never throws when Linking fails', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(openSpotifyWebPage(TRACK_URI)).resolves.toBeUndefined();
  });
});

// A static guard over the real production tree: the two destinations HX-4 retires cannot come back
// through another file.
describe('spotifyLinkBack — the retired destinations are spelled nowhere in production', () => {
  const SRC = path.resolve(__dirname, '../../..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full, out); }
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(full);
    }
    return out;
  };
  const isTest = (f: string) => /[\\/]__tests__[\\/]/.test(f) || /\.test\.(ts|tsx|js|jsx)$/.test(f);
  const PROD = walk(SRC).filter((f) => !isTest(f));
  const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
  const matching = (re: RegExp) => PROD.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map(rel);

  it('the scan sees the real tree (a walk that finds nothing must fail, not pass)', () => {
    expect(PROD.length).toBeGreaterThan(100);
    expect(PROD.map(rel)).toContain('experience/player/spotifyLinkBack.ts');
  });

  it('no production file names the Spotify download page', () => {
    expect(matching(DOWNLOAD_PAGE)).toEqual([]);
  });

  it('no production file spells a bare "spotify:" scheme literal', () => {
    expect(matching(/(['"`])spotify:\1/)).toEqual([]);
  });
});
