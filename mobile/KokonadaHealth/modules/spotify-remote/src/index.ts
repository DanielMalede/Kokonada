import { NativeEventEmitter, NativeModules } from 'react-native';
import Native from './NativeSpotifyRemote';

const REMOTE_DISCONNECTED = 'remoteDisconnected';
const PLAYER_STATE_CHANGED = 'playerStateChanged';

// positionMs/durationMs are present on current native builds and drive track-mode
// auto-advance (D-7/D-8); optional so a legacy build (which emits only trackUri+isPaused)
// still type-checks and degrades to pause-mirroring.
export interface RemotePlayerState { trackUri: string | null; isPaused: boolean; positionMs?: number; durationMs?: number; imageUri?: string | null; }

// A single emitter over the native module. NativeModules.SpotifyRemote exists at
// runtime once the TurboModule is registered; the emitter is only constructed lazily.
let emitter: NativeEventEmitter | null = null;
function getEmitter(): NativeEventEmitter {
  if (!emitter) emitter = new NativeEventEmitter(NativeModules.SpotifyRemote as any);
  return emitter;
}

export const SpotifyRemote = {
  configure: (clientId: string, redirectUri: string): void =>
    Native.configure(clientId, redirectUri),
  isSpotifyInstalled: (): Promise<boolean> => Native.isSpotifyInstalled(),
  authorize: (): Promise<string> => Native.authorize(),
  connect: (): Promise<void> => Native.connect(),
  disconnect: (): Promise<void> => Native.disconnect(),
  isConnected: (): Promise<boolean> => Native.isConnected(),
  playUri: (uri: string): Promise<void> => Native.playUri(uri),
  pause: (): Promise<void> => Native.pause(),
  resume: (): Promise<void> => Native.resume(),
  // D-1: context-queue commands — same queue Spotify's auto-advance walks.
  skipNext: (): Promise<void> => Native.skipNext(),
  skipPrevious: (): Promise<void> => Native.skipPrevious(),
  skipToIndex: (contextUri: string, index: number): Promise<void> => Native.skipToIndex(contextUri, index),
  setShuffle: (enabled: boolean): Promise<void> => Native.setShuffle(enabled),
  setRepeat: (mode: number): Promise<void> => Native.setRepeat(mode),
  getPlayerState: (): Promise<{ isPaused: boolean; trackUri: string | null }> =>
    Native.getPlayerState(),
  // Client-side album art for the CURRENT track (App Remote imagesApi → local file path),
  // exactly like the web read cover art off the Playback SDK — no Web API / no 403.
  getTrackImage: (imageUri: string): Promise<string> => Native.getTrackImage(imageUri),
  onRemoteDisconnected: (cb: () => void): (() => void) => {
    const sub = getEmitter().addListener(REMOTE_DISCONNECTED, cb);
    return () => sub.remove();
  },
  // Every native PlayerState change: track auto-advance, pause/resume, in-Spotify jumps.
  // The signal that keeps RN's queue/now-playing in lockstep with the real player (D-1).
  onPlayerStateChanged: (cb: (state: RemotePlayerState) => void): (() => void) => {
    const sub = getEmitter().addListener(PLAYER_STATE_CHANGED, (p: any) =>
      cb({
        trackUri: p?.trackUri ?? null,
        isPaused: !!p?.isPaused,
        positionMs: typeof p?.positionMs === 'number' ? p.positionMs : undefined,
        durationMs: typeof p?.durationMs === 'number' ? p.durationMs : undefined,
        // The current track's art URI (Now Playing cover source, resolved via getTrackImage).
        imageUri: typeof p?.imageUri === 'string' ? p.imageUri : undefined,
      }));
    return () => sub.remove();
  },
};

export type { Spec } from './NativeSpotifyRemote';
