import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  configure(clientId: string, redirectUri: string): void;
  isSpotifyInstalled(): Promise<boolean>;
  authorize(): Promise<string>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  playUri(uri: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  // D-1 context playback: operate on Spotify's own context/queue so RN and Spotify
  // can never diverge (skips act on the SAME queue the auto-advance uses).
  skipNext(): Promise<void>;
  skipPrevious(): Promise<void>;
  skipToIndex(contextUri: string, index: number): Promise<void>;
  setShuffle(enabled: boolean): Promise<void>;
  setRepeat(mode: number): Promise<void>;
  getPlayerState(): Promise<{ isPaused: boolean; trackUri: string | null }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SpotifyRemote');
