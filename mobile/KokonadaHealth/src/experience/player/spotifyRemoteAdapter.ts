import { SpotifyRemote } from '@kokonada/spotify-remote';
import type { SpotifyRemoteLike } from './spotifyController';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from '../../health/config';

// Configure the native module once with app identity (dashboard-registered client +
// redirect). App Remote authorizes on-device; there is no access token — connect()
// takes none and the token passed by the controller is intentionally ignored.
SpotifyRemote.configure(SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI);

// Track disconnect unsubscribers so removeAllListeners can detach them.
let offDisconnect: (() => void) | null = null;

export const spotifyRemoteAdapter: SpotifyRemoteLike = {
  connect: async (_token: string) => {
    // Establish the app-remote-control grant explicitly first — this returns a real
    // onActivityResult (token / error / cancel) instead of App Remote's inline consent
    // whose result never came back on-device. THEN open the connection against that grant.
    await SpotifyRemote.authorize();
    await SpotifyRemote.connect();
  },
  disconnect: async () => { await SpotifyRemote.disconnect(); },
  isConnectedAsync: () => SpotifyRemote.isConnected(),
  playUri: async (uri: string) => { await SpotifyRemote.playUri(uri); },
  pause: async () => { await SpotifyRemote.pause(); },
  resume: async () => { await SpotifyRemote.resume(); },
  getPlayerState: async () => {
    const s = await SpotifyRemote.getPlayerState();
    return { isPaused: !!s?.isPaused, track: s?.trackUri ? { uri: s.trackUri } : undefined };
  },
  addListener: (event: string, cb: (...args: any[]) => void) => {
    // The controller only listens for 'remoteDisconnected'.
    if (event === 'remoteDisconnected') offDisconnect = SpotifyRemote.onRemoteDisconnected(cb);
  },
  removeAllListeners: () => { offDisconnect?.(); offDisconnect = null; },
};

// Readiness gate replacing the old token fetch: App Remote can only connect when the
// Spotify app is installed. Returns a non-null sentinel so the controller's getToken
// gate passes; null (not installed / error) makes the controller stay disconnected.
export async function getSpotifyReadiness(): Promise<string | null> {
  try {
    return (await SpotifyRemote.isSpotifyInstalled()) ? 'ready' : null;
  } catch {
    return null;
  }
}
