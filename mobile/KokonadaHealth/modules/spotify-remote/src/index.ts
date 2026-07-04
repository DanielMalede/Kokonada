import { NativeEventEmitter, NativeModules } from 'react-native';
import Native from './NativeSpotifyRemote';

const REMOTE_DISCONNECTED = 'remoteDisconnected';

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
  connect: (): Promise<void> => Native.connect(),
  disconnect: (): Promise<void> => Native.disconnect(),
  isConnected: (): Promise<boolean> => Native.isConnected(),
  playUri: (uri: string): Promise<void> => Native.playUri(uri),
  pause: (): Promise<void> => Native.pause(),
  resume: (): Promise<void> => Native.resume(),
  getPlayerState: (): Promise<{ isPaused: boolean; trackUri: string | null }> =>
    Native.getPlayerState(),
  onRemoteDisconnected: (cb: () => void): (() => void) => {
    const sub = getEmitter().addListener(REMOTE_DISCONNECTED, cb);
    return () => sub.remove();
  },
};

export type { Spec } from './NativeSpotifyRemote';
