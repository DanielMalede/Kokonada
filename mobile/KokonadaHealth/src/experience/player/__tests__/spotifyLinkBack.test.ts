/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { Linking, Platform } from 'react-native';

// The App Remote wake path is the production `player` (SpotifyPlayerController) singleton; mock it so
// the wiring's reuse of the EXISTING connect/wake path is observable without the native graph.
jest.mock('../../playback/playbackServices', () => ({
  player: { connect: jest.fn().mockResolvedValue(true) },
}));

import { SpotifyRemote } from '@kokonada/spotify-remote';
import { player } from '../../playback/playbackServices';
import { isSpotifyInstalled, foregroundSpotify, openSpotifyWebPage, openSpotifyStoreListing } from '../spotifyLinkBack';

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

  // HX-4 round 1 (resilience LOW): the install probe runs once per mount, so Spotify can be
  // uninstalled while OPEN SPOTIFY is still on screen. The app URI then has no handler — fall back to
  // the SAME item's open.spotify.com page instead of leaving a dead control.
  it('when the app URI has no handler (Spotify uninstalled mid-session), opens the same item\'s web page', async () => {
    openURL.mockRejectedValueOnce(new Error('No Activity found to handle Intent'));
    await foregroundSpotify(TRACK_URI);
    expect(openURL.mock.calls).toEqual([[TRACK_URI], [`https://open.spotify.com/track/${TRACK_ID}`]]);
  });

  it('never throws into the UI when the web fallback rejects too', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler')).mockRejectedValueOnce(new Error('no browser'));
    await expect(foregroundSpotify(TRACK_URI)).resolves.toBeUndefined();
    expect(openURL).toHaveBeenCalledTimes(2);
  });

  it('opens the web page ONLY on failure: a successful app open is the single call', async () => {
    await foregroundSpotify(TRACK_URI);
    expect(openURL.mock.calls).toEqual([[TRACK_URI]]);
  });

  it('never throws into the UI when the wake connect rejects', async () => {
    connect.mockRejectedValueOnce(new Error('remote severed'));
    await expect(foregroundSpotify(TRACK_URI)).resolves.toBeUndefined();
  });
});

// REVERSED, signed by the owner 2026-09-30 (DEC-112; not in DEC-091): this pinned the download page
// ("getSpotifyApp fallback opens the download URL"). HX-4 M2: not installed ("GET SPOTIFY FREE") →
// the SAME item's open.spotify.com page, never the download page; brief M2 reverses it.
// DEC-193 (2026-11-25, which supersedes DEC-112) sends GET SPOTIFY FREE to the store listing (below);
// this page stays as the link of the title and the cover on Now Playing, in either install state.
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

  it('never wakes the App Remote (a web page is no trip into the app)', async () => {
    await openSpotifyWebPage(TRACK_URI);
    expect(connect).not.toHaveBeenCalled();
  });

  it('never throws when Linking fails', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(openSpotifyWebPage(TRACK_URI)).resolves.toBeUndefined();
  });
});

// DEC-193 (supersedes DEC-112; CMP-008; the compliance-auditor's CA307-15): Spotify is not installed
// ("GET SPOTIFY FREE") → Spotify's own app-store listing. Spotify's Design Guidelines, "Linking to
// Spotify": "If the app is not installed, the user should be directed to the app store so that they
// can install Spotify." The listing is Spotify's, not the item's: one URL for every item, with no
// parameters.
describe('spotifyLinkBack — openSpotifyStoreListing opens Spotify\'s app-store listing (DEC-193)', () => {
  const PLAY_APP = 'market://details?id=com.spotify.music';
  const PLAY_WEB = 'https://play.google.com/store/apps/details?id=com.spotify.music';
  const APP_STORE = 'https://apps.apple.com/app/spotify-music-and-podcasts/id324684580';
  const ORIGINAL_OS = Platform.OS;
  afterEach(() => { (Platform as any).OS = ORIGINAL_OS; });

  // A stateful fake of Android's intent resolution behind Linking.openURL (React Native's
  // IntentModule.openURL starts an ACTION_VIEW activity): a URL opens when an installed app handles
  // its scheme, and otherwise the promise rejects with the native "No Activity found to handle
  // Intent". A browser handles https; the Play Store app handles market:// only where Google Play is
  // installed, which is not every phone or emulator.
  function android({ playStore, browser = true }: { playStore: boolean; browser?: boolean }) {
    (Platform as any).OS = 'android';
    const landed: string[] = [];
    openURL.mockImplementation(async (url: string) => {
      const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
      const handled = (scheme === 'market' && playStore) || (scheme === 'https' && browser);
      if (!handled) throw new Error(`Could not open URL '${url}': No Activity found to handle Intent`);
      landed.push(url);
      return true;
    });
    return landed;
  }

  it('Android with Google Play: opens Spotify\'s listing in the Play Store app, exactly once', async () => {
    const landed = android({ playStore: true });
    await openSpotifyStoreListing(TRACK_URI);
    expect(openURL.mock.calls).toEqual([[PLAY_APP]]);
    expect(landed).toEqual([PLAY_APP]);
  });

  it('Android without Google Play: market:// has no handler, so the same listing opens on the Play web page', async () => {
    const landed = android({ playStore: false });
    await openSpotifyStoreListing(TRACK_URI);
    expect(openURL.mock.calls).toEqual([[PLAY_APP], [PLAY_WEB]]);
    expect(landed).toEqual([PLAY_WEB]);
  });

  it('never throws into the UI when neither the Play Store nor a browser can open it', async () => {
    const landed = android({ playStore: false, browser: false });
    await expect(openSpotifyStoreListing(TRACK_URI)).resolves.toBeUndefined();
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(landed).toEqual([]);
  });

  // On Android 11+ canOpenURL answers through package visibility, so without a <queries> entry it
  // says false for market:// and would skip the Play Store; opening and falling back on failure
  // needs no manifest change.
  it('never asks canOpenURL first', async () => {
    const canOpen = jest.spyOn(Linking, 'canOpenURL');
    android({ playStore: true });
    await openSpotifyStoreListing(TRACK_URI);
    expect(canOpen).not.toHaveBeenCalled();
  });

  it.each([
    TRACK_URI,
    'spotify:album:4aawyAB9vmqN3uQ7FjRGTy',
    'spotify:playlist:3cEYpjA9oz9GiPac4AsH4n',
  ])('the listing is Spotify\'s, not the item\'s: %s opens the same listing, never an open.spotify.com page or the download page', async (uri) => {
    android({ playStore: true });
    await openSpotifyStoreListing(uri);
    expect(openURL.mock.calls).toEqual([[PLAY_APP]]);
    const opened = openURL.mock.calls.map((c) => String(c[0]));
    expect(opened.filter((u) => /open\.spotify\.com/.test(u) || DOWNLOAD_PAGE.test(u))).toEqual([]);
  });

  // iOS is frozen (no Mac): this branch is pinned here and has never run on a device.
  it('iOS: opens Spotify\'s App Store listing, exactly once, and no Android store URL', async () => {
    (Platform as any).OS = 'ios';
    await openSpotifyStoreListing(TRACK_URI);
    expect(openURL.mock.calls).toEqual([[APP_STORE]]);
  });

  it('iOS: never throws into the UI when the App Store listing cannot open', async () => {
    (Platform as any).OS = 'ios';
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(openSpotifyStoreListing(TRACK_URI)).resolves.toBeUndefined();
  });

  it.each(UNLINKABLE)('opens NOTHING for an unlinkable URI (no item on screen, no link-back): %p', async (uri) => {
    android({ playStore: true });
    await openSpotifyStoreListing(uri);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('never wakes the App Remote (Spotify is not installed on this branch)', async () => {
    android({ playStore: true });
    await openSpotifyStoreListing(TRACK_URI);
    expect(connect).not.toHaveBeenCalled();
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
