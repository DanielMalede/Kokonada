import { NativeEventEmitter, NativeModules } from 'react-native';
import Native from './NativeSpotifyRemote';

const REMOTE_DISCONNECTED = 'remoteDisconnected';
const PLAYER_STATE_CHANGED = 'playerStateChanged';

export interface RemotePlayerState { trackUri: string | null; isPaused: boolean; }

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
  onRemoteDisconnected: (cb: () => void): (() => void) => {
    const sub = getEmitter().addListener(REMOTE_DISCONNECTED, cb);
    return () => sub.remove();
  },
  // Every native PlayerState change: track auto-advance, pause/resume, in-Spotify jumps.
  // The signal that keeps RN's queue/now-playing in lockstep with the real player (D-1).
  onPlayerStateChanged: (cb: (state: RemotePlayerState) => void): (() => void) => {
    const sub = getEmitter().addListener(PLAYER_STATE_CHANGED, (p: any) =>
      cb({ trackUri: p?.trackUri ?? null, isPaused: !!p?.isPaused }));
    return () => sub.remove();
  },
};

export type { Spec } from './NativeSpotifyRemote';
