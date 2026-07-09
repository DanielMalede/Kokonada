// Wraps the Spotify App Remote (react-native-spotify-remote) behind a port so its
// notoriously fragile lifecycle can be unit-tested. The whole design goal is a
// SINGLE promise: no matter how the native remote fails — connect rejects, a
// command throws mid-song, the Spotify app is killed, or its auth is revoked — the
// controller resolves to a clean state and NEVER lets a rejection escape to crash
// the JS bundle.

export interface SpotifyRemoteLike {
  connect(token: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnectedAsync(): Promise<boolean>;
  playUri(uri: string): Promise<void>;
  // D-1 context playback (optional — legacy fakes without them fall back to track play).
  playContext?(contextUri: string, index: number): Promise<void>;
  skipToIndex?(contextUri: string, index: number): Promise<void>;
  skipNext?(): Promise<void>;
  skipPrevious?(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getPlayerState?(): Promise<{ isPaused: boolean; track?: { uri: string } }>;
  addListener(event: string, cb: (...args: any[]) => void): void;
  removeAllListeners?(): void;
}

export type PlayerState = 'connected' | 'connecting' | 'disconnected';
export interface PlaybackSnapshot { isPlaying: boolean; uri?: string; }
export interface CommandResult { ok: boolean; }

export interface SpotifyControllerDeps {
  remote: SpotifyRemoteLike;
  getToken: () => Promise<string | null>;
  onStateChange?: (state: PlayerState) => void;
  onError?: (err: unknown) => void;
  // D-1: every native PlayerState change (auto-advance, pause/resume, in-Spotify jump) —
  // forwarded so the playback orchestrator can keep its queue in lockstep with reality.
  onRemoteState?: (state: { uri: string | null; isPaused: boolean; positionMs?: number; durationMs?: number }) => void;
  maxReconnects?: number;
}

const DEFAULT_MAX_RECONNECTS = 3;

export class SpotifyPlayerController {
  private state: PlayerState = 'disconnected';
  private reconnectBudget: number;
  // The single in-flight connect promise (null when idle). Overlapping callers reuse it.
  private connectInFlight: Promise<boolean> | null = null;

  constructor(private readonly deps: SpotifyControllerDeps) {
    this.reconnectBudget = deps.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
    // The native side can sever the link at any moment; treat it like any failure.
    this.deps.remote.addListener('remoteDisconnected', () => this.markDisconnected());
    // D-1: surface the native PlayerState stream (normalized to { uri, isPaused }).
    if (this.deps.onRemoteState) {
      this.deps.remote.addListener('playerStateChanged', (s: any) =>
        this.deps.onRemoteState?.({
          uri: s?.trackUri ?? null,
          isPaused: !!s?.isPaused,
          positionMs: typeof s?.positionMs === 'number' ? s.positionMs : undefined,
          durationMs: typeof s?.durationMs === 'number' ? s.durationMs : undefined,
        }));
    }
  }

  getState(): PlayerState {
    return this.state;
  }

  private setState(next: PlayerState): void {
    if (this.state === next) return;
    this.state = next;
    this.deps.onStateChange?.(next);
  }

  private markDisconnected(err?: unknown): void {
    this.setState('disconnected');
    if (err !== undefined) this.deps.onError?.(err);
  }

  async connect(): Promise<boolean> {
    // Coalesce overlapping connects: a burst of plays/skips during the (slow, native)
    // handshake must await the SAME connect — never spawn concurrent native connects or
    // drain the reconnect budget. Mirrors the native module's single in-flight connect.
    if (this.connectInFlight) return this.connectInFlight;
    this.connectInFlight = this.connectOnce();
    try {
      return await this.connectInFlight;
    } finally {
      this.connectInFlight = null;
    }
  }

  private async connectOnce(): Promise<boolean> {
    this.setState('connecting');
    let token: string | null;
    try {
      token = await this.deps.getToken();
    } catch (err) {
      console.warn('[koko] AppRemote.connect readiness-check threw:', (err as any)?.message ?? String(err));
      this.markDisconnected(err);
      return false;
    }
    const ready = token != null;
    console.log('[koko] AppRemote.connect ready=', ready);
    if (!token) {
      console.warn('[koko] AppRemote.connect: Spotify not ready/installed — cannot play');
      this.markDisconnected();
      return false;
    }
    try {
      await this.deps.remote.connect(token);
      console.log('[koko] AppRemote.connect SUCCEEDED');
      this.reconnectBudget = this.deps.maxReconnects ?? DEFAULT_MAX_RECONNECTS; // reset on success
      this.setState('connected');
      return true;
    } catch (err) {
      console.warn('[koko] AppRemote.connect FAILED:', (err as any)?.message ?? String(err));
      this.markDisconnected(err);
      return false;
    }
  }

  // Ensure a live connection, spending from the capped reconnect budget so a
  // permanently-dead remote can't spin forever.
  private async ensureConnected(): Promise<boolean> {
    if (this.state === 'connected') return true;
    // A connect is already in flight (e.g. the first playlist's play) — await it instead of
    // starting a second native connect and burning another unit of the reconnect budget.
    if (this.connectInFlight) return this.connectInFlight;
    if (this.reconnectBudget <= 0) return false;
    this.reconnectBudget -= 1;
    return this.connect();
  }

  private async run(action: (r: SpotifyRemoteLike) => Promise<void>): Promise<CommandResult> {
    const connected = await this.ensureConnected();
    console.log('[koko] AppRemote.run ensureConnected=', connected, 'state=', this.state, 'budget=', this.reconnectBudget);
    if (!connected) return { ok: false };
    try {
      await action(this.deps.remote);
      console.log('[koko] AppRemote command OK');
      return { ok: true };
    } catch (err) {
      // Command threw → the link is gone (severance / revoked auth). Degrade.
      console.warn('[koko] AppRemote command THREW:', (err as any)?.message ?? String(err));
      this.markDisconnected(err);
      return { ok: false };
    }
  }

  async play(uri: string): Promise<CommandResult> {
    if (typeof uri !== 'string' || uri.length === 0) return { ok: false };
    return this.run((r) => r.playUri(uri));
  }

  // D-1: play the session-playlist CONTEXT at a position — Spotify then owns the queue
  // order and its auto-advance walks OUR tracks. Falls back to nothing when the remote
  // lacks context support (the caller checks canPlayContext()).
  canPlayContext(): boolean {
    return typeof this.deps.remote.playContext === 'function';
  }

  async playContext(contextUri: string, index: number): Promise<CommandResult> {
    if (typeof contextUri !== 'string' || contextUri.length === 0 || !this.deps.remote.playContext) return { ok: false };
    const at = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
    return this.run((r) => r.playContext!(contextUri, at));
  }

  async skipToIndex(contextUri: string, index: number): Promise<CommandResult> {
    if (!this.deps.remote.skipToIndex) return { ok: false };
    const at = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
    return this.run((r) => r.skipToIndex!(contextUri, at));
  }

  async skipNext(): Promise<CommandResult> {
    if (!this.deps.remote.skipNext) return { ok: false };
    return this.run((r) => r.skipNext!());
  }

  async skipPrevious(): Promise<CommandResult> {
    if (!this.deps.remote.skipPrevious) return { ok: false };
    return this.run((r) => r.skipPrevious!());
  }

  async pause(): Promise<CommandResult> {
    return this.run((r) => r.pause());
  }

  async resume(): Promise<CommandResult> {
    return this.run((r) => r.resume());
  }

  // Read the native player truth for the foreground reconcile. Any failure (not
  // connected, remote gone) maps to 'disconnected' rather than throwing.
  async getPlaybackState(): Promise<PlaybackSnapshot | 'disconnected'> {
    if (this.state !== 'connected' || !this.deps.remote.getPlayerState) return 'disconnected';
    try {
      const s = await this.deps.remote.getPlayerState();
      return { isPlaying: !s.isPaused, uri: s.track?.uri };
    } catch {
      return 'disconnected';
    }
  }

  async dispose(): Promise<void> {
    this.deps.remote.removeAllListeners?.();
    // Stop audio before severing the link. App Remote's disconnect only drops the
    // CONTROL channel — the Spotify app keeps playing whatever was last commanded —
    // so logout leaked playback until this pause was added. Pause must precede
    // disconnect (native pause needs the live connection) and is guarded on its own
    // so a failing pause never prevents the disconnect. (defect D-2)
    if (this.state === 'connected') {
      try { await this.deps.remote.pause(); } catch { /* best-effort; still disconnect below */ }
    }
    try {
      await this.deps.remote.disconnect();
    } catch {
      /* best-effort teardown */
    }
    this.setState('disconnected');
  }
}
