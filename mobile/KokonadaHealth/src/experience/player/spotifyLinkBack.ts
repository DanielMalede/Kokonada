import { Linking, Platform } from 'react-native';
import { SpotifyRemote } from '@kokonada/spotify-remote';
import { player } from '../playback/playbackServices';
import { parseSpotifyContentUri } from './spotifyContentLink';

// The Spotify link-back wiring (compliance C2; HX-4; DEC-193). Every action takes the URI of the exact
// item on screen and opens nothing at all when the URI is not a linkable track, album or playlist.
// SpotifyAttribution's OPEN SPOTIFY opens that item in the app, and its GET SPOTIFY FREE opens
// Spotify's app-store listing; the title and the cover on Now Playing open the item's
// open.spotify.com page. Every function is defensive: a failure here is a cosmetic link-back miss,
// never a crash into the UI.

// Reuses the EXISTING native install probe (the same one getSpotifyReadiness gates connect on).
export async function isSpotifyInstalled(): Promise<boolean> {
  try {
    return !!(await SpotifyRemote.isSpotifyInstalled());
  } catch {
    return false;
  }
}

// "OPEN SPOTIFY": open the item in the Spotify app. On device the App Remote is ALREADY connected at
// boot, so player.connect() no-ops and never foregrounds the app — the URI launch is what surfaces
// Spotify, on the item itself. An unlinkable URI opens nothing and wakes nothing: without a
// destination there is no trip to Spotify for the wake to follow.
export async function foregroundSpotify(uri: string | null): Promise<void> {
  const link = parseSpotifyContentUri(uri);
  if (!link) return;
  try {
    await Linking.openURL(link.uri);
  } catch {
    // No handler for the app URI: Spotify was uninstalled after the mount-time install probe. Open
    // the same item's web page rather than leave OPEN SPOTIFY a dead control.
    try {
      await Linking.openURL(link.webUrl);
    } catch {
      /* link-back is best-effort — never throw into the UI */
    }
  }
  // Keep waking the App Remote for playback continuity (its own guard — connect already swallows).
  try {
    await player.connect();
  } catch {
    /* wake is best-effort — never throw into the UI */
  }
}

// The item's own open.spotify.com page: the link of the title and the cover on Now Playing (DEC-193;
// Policy II.4.2), whether or not Spotify is installed. Until DEC-193 it was GET SPOTIFY FREE's action
// (DEC-112).
export async function openSpotifyWebPage(uri: string | null): Promise<void> {
  const link = parseSpotifyContentUri(uri);
  if (!link) return;
  try {
    await Linking.openURL(link.webUrl);
  } catch {
    /* best-effort — never throw into the UI */
  }
}

// Spotify's own app-store listing: the same for every item, and no parameters.
const SPOTIFY_ANDROID_PACKAGE = 'com.spotify.music';
const SPOTIFY_PLAY_STORE_APP = `market://details?id=${SPOTIFY_ANDROID_PACKAGE}`;
const SPOTIFY_PLAY_STORE_WEB = `https://play.google.com/store/apps/details?id=${SPOTIFY_ANDROID_PACKAGE}`;
// iOS is frozen (no Mac): this listing has never been opened on a device.
const SPOTIFY_APP_STORE = 'https://apps.apple.com/app/spotify-music-and-podcasts/id324684580';

// "GET SPOTIFY FREE" (DEC-193, which supersedes DEC-112): Spotify is not installed, so open Spotify's
// app-store listing. The control exists only beside a linkable item, so an unlinkable URI opens
// nothing. Android tries the Play Store app first and falls back to the Play web page on failure; it
// never asks canOpenURL, which answers through package visibility on Android 11+ and would say false
// for market:// without a <queries> entry.
export async function openSpotifyStoreListing(uri: string | null): Promise<void> {
  if (!parseSpotifyContentUri(uri)) return;
  try {
    if (Platform.OS === 'ios') {
      await Linking.openURL(SPOTIFY_APP_STORE);
      return;
    }
    await Linking.openURL(SPOTIFY_PLAY_STORE_APP).catch(() => Linking.openURL(SPOTIFY_PLAY_STORE_WEB));
  } catch {
    /* best-effort — never throw into the UI */
  }
}
