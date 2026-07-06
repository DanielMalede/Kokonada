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
  getPlayerState(): Promise<{ isPaused: boolean; trackUri: string | null }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SpotifyRemote');
