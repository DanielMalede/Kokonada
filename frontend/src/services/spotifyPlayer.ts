import type { SpotifySDKState } from '../store/slices/playerSlice';

// Minimal Spotify Web Playback SDK type declarations
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void;
    Spotify: {
      Player: new (options: SpotifyPlayerOptions) => SpotifyPlayer;
    };
  }
}

interface SpotifyPlayerOptions {
  name: string;
  getOAuthToken: (cb: (token: string) => void) => void;
  volume: number;
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  addListener(event: string, cb: (data: unknown) => void): boolean;
  removeListener(event: string, cb?: (data: unknown) => void): boolean;
}

/**
 * Clamps a requested seek position into the valid [0, duration] window so the
 * SDK never receives a negative, NaN, or past-the-end value. When the duration
 * is unknown (0) we can only enforce the lower bound.
 */
export function clampSeekMs(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs) || positionMs < 0) return 0;
  if (durationMs > 0 && positionMs > durationMs) return durationMs;
  return Math.round(positionMs);
}

type SDKStateCallback = (state: SpotifySDKState) => void;

class SpotifyPlayerService {
  private static _instance: SpotifyPlayerService;
  private player: SpotifyPlayer | null = null;
  private deviceId: string | null = null;
  private stateCallback: SDKStateCallback | null = null;
  private positionInterval: ReturnType<typeof setInterval> | null = null;
  private currentPositionMs = 0;
  private currentDurationMs = 0;
  private isCurrentlyPaused = true;

  static getInstance(): SpotifyPlayerService {
    if (!SpotifyPlayerService._instance) {
      SpotifyPlayerService._instance = new SpotifyPlayerService();
    }
    return SpotifyPlayerService._instance;
  }

  onStateChange(callback: SDKStateCallback): void {
    this.stateCallback = callback;
  }

  private emit(patch: SpotifySDKState): void {
    this.stateCallback?.(patch);
  }

  async init(fetchToken: () => Promise<string>): Promise<void> {
    if (this.player) return;

    this.player = new window.Spotify.Player({
      name: 'Kokonada',
      getOAuthToken: (cb) => { fetchToken().then(cb).catch(console.error); },
      volume: 0.8,
    });

    this.player.addListener('ready', (data: unknown) => {
      const { device_id } = data as { device_id: string };
      this.deviceId = device_id;
      this.emit({ deviceId: device_id, isReady: true });
    });

    this.player.addListener('not_ready', () => {
      console.warn('[SpotifySDK] device went not_ready');
      this.emit({ isReady: false });
    });

    this.player.addListener('initialization_error', (e: unknown) => {
      console.error('[SpotifySDK] initialization_error — Spotify Premium required:', e);
    });
    this.player.addListener('authentication_error', (e: unknown) => {
      console.error('[SpotifySDK] authentication_error — token may be expired:', e);
    });
    this.player.addListener('account_error', (e: unknown) => {
      console.error('[SpotifySDK] account_error — Spotify Premium required for Web Playback SDK:', e);
    });

    this.player.addListener('player_state_changed', (data: unknown) => {
      if (!data) return;
      const s = data as {
        paused: boolean;
        position: number;
        duration: number;
        track_window?: { current_track?: {
          uri?: string;
          album?: { images?: { url?: string }[] };
        } };
      };
      this.isCurrentlyPaused = s.paused;
      this.currentPositionMs = s.position;
      this.currentDurationMs = s.duration;
      this.emit({
        isPaused: s.paused,
        positionMs: s.position,
        durationMs: s.duration,
        currentTrackUri: s.track_window?.current_track?.uri ?? null,
        // Bug 4: surface the cover art (first/largest image) so the player can
        // render it. Optional-chained so podcasts/local tracks with no album art
        // degrade to null rather than throwing on images[0].
        currentTrackImage: s.track_window?.current_track?.album?.images?.[0]?.url ?? null,
      });

      if (!s.paused) {
        this.startProgressInterval();
      } else {
        this.stopProgressInterval();
      }
    });

    await this.player.connect();
  }

  private startProgressInterval(): void {
    if (this.positionInterval) return;
    this.positionInterval = setInterval(() => {
      if (!this.isCurrentlyPaused) {
        this.currentPositionMs = Math.min(
          this.currentPositionMs + 1000,
          this.currentDurationMs,
        );
        this.emit({ positionMs: this.currentPositionMs });
      }
    }, 1000);
  }

  private stopProgressInterval(): void {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
      this.positionInterval = null;
    }
  }

  getDeviceId(): string | null {
    return this.deviceId;
  }

  async pause(): Promise<void> {
    await this.player?.pause();
  }

  async resume(): Promise<void> {
    await this.player?.resume();
  }

  async nextTrack(): Promise<void> {
    await this.player?.nextTrack();
  }

  async previousTrack(): Promise<void> {
    await this.player?.previousTrack();
  }

  /**
   * Seeks to an absolute position (ms). Clamped to the current track length, and
   * the position is emitted immediately so the scrubber reflects the jump without
   * waiting for the next player_state_changed tick.
   */
  async seek(positionMs: number): Promise<void> {
    const target = clampSeekMs(positionMs, this.currentDurationMs);
    await this.player?.seek(target);
    this.currentPositionMs = target;
    this.emit({ positionMs: target });
  }

  destroy(): void {
    this.stopProgressInterval();
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
    this.stateCallback = null;
    this.currentPositionMs = 0;
    this.currentDurationMs = 0;
    this.isCurrentlyPaused = true;
  }
}

export const spotifyPlayerService = SpotifyPlayerService.getInstance();
