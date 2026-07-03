import { remote, auth } from 'react-native-spotify-remote';
import type { SpotifyRemoteLike } from './spotifyController';

// On-device adapter mapping react-native-spotify-remote's API onto the
// SpotifyRemoteLike port SpotifyPlayerController drives. All fragility (severance,
// revoked auth) is handled by the controller; this file is a straight bridge and
// stays out of the jest graph — the controller is tested against a fake remote.
export const spotifyRemoteAdapter: SpotifyRemoteLike = {
  connect: async (token: string) => { await remote.connect(token); },
  disconnect: async () => { await remote.disconnect(); },
  isConnectedAsync: () => remote.isConnectedAsync(),
  playUri: async (uri: string) => { await remote.playUri(uri); },
  pause: async () => { await remote.pause(); },
  resume: async () => { await remote.resume(); },
  getPlayerState: async () => {
    const s: any = await remote.getPlayerState();
    return { isPaused: !!s?.isPaused, track: s?.track ? { uri: s.track.uri } : undefined };
  },
  addListener: (event: string, cb: (...args: any[]) => void) => { remote.addListener(event as any, cb); },
  removeAllListeners: () => { remote.removeAllListeners('remoteDisconnected'); },
};

// The Spotify access token is minted by the backend Spotify integration (the app
// authorizes once via `auth.authorize` on first link). Exposed for the controller's
// getToken dependency; returns null when Spotify isn't linked yet.
export async function getSpotifyAccessToken(): Promise<string | null> {
  try {
    const session = await auth.getSession?.();
    return session?.accessToken ?? null;
  } catch {
    return null;
  }
}
