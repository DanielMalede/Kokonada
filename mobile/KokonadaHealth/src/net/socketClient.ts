// Typed Socket.IO client for the Kokonada backend. Owns the whole connection
// lifecycle so no screen has to: reqId correlation (stale-response discard),
// reconnect re-hydration (the server's emotion cache is per-socketId), and the
// auth_expired refresh-then-reconnect that stops a dead-token reconnect storm.

export interface SocketLike {
  on(event: string, cb: (payload?: any) => void): void;
  off(event: string, cb: (payload?: any) => void): void;
  emit(event: string, payload?: any): void;
  connect(): void;
  disconnect(): void;
}

export interface EmotionIntent {
  taps: Array<{ x: number; y: number }>;
  textPrompt: string;
  activity: string | null;
}

export interface KokonadaSocketDeps {
  createSocket: (token: string) => SocketLike;
  getAccessToken: () => string | null;
  refreshToken: () => Promise<string | null>;
  getEmotionIntent: () => EmotionIntent;
  onPlaylist: (payload: any) => void;
  onLoggedOut: () => void;
  // Backend emitted a generation failure for our current request (no tracks, LLM
  // outage, no HR yet). Gated to the latest reqId so a superseded request is silent.
  onGenerationError?: (message?: string) => void;
  // Cap on auth_expired→refresh cycles within the window before we give up and log
  // out — the guard against a fresh-but-immediately-dead token looping forever.
  maxAuthRefreshes?: number;
  authWindowMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_AUTH_REFRESHES = 5;
const DEFAULT_AUTH_WINDOW_MS = 60_000;

export class KokonadaSocket {
  private socket: SocketLike | null = null;
  private reqCounter = 0;
  private latestReqId = 0;
  private closedByUser = false;
  private refreshing = false;
  private authFailures = 0;
  private lastAuthExpiredAt = -Infinity;

  constructor(private readonly deps: KokonadaSocketDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  connect(): void {
    const token = this.deps.getAccessToken();
    if (!token) { this.deps.onLoggedOut(); return; }
    this.closedByUser = false;
    this.open(token);
  }

  private open(token: string): void {
    this.teardown(); // detach the previous socket's listeners BEFORE swapping
    const socket = this.deps.createSocket(token);
    this.socket = socket;
    socket.on('connect', this.handleConnect);
    socket.on('playlist', this.handlePlaylist);
    socket.on('playlist_error', this.handlePlaylistError);
    socket.on('auth_expired', this.handleAuthExpired);
    socket.on('disconnect', this.handleDisconnect);
    socket.connect();
  }

  // Remove our listeners from the current socket so a late, buffered event on a
  // replaced (dead) socket can never corrupt the new session — a stale auth_expired
  // must not spuriously log the user out, a stale playlist must not render. (S9-1)
  private teardown(): void {
    const s = this.socket;
    if (!s) return;
    s.off('connect', this.handleConnect);
    s.off('playlist', this.handlePlaylist);
    s.off('playlist_error', this.handlePlaylistError);
    s.off('auth_expired', this.handleAuthExpired);
    s.off('disconnect', this.handleDisconnect);
  }

  // Bound handlers so on/off pair up and `this` is stable.
  private handleConnect = () => {
    // Re-hydrate the server's per-socketId emotion cache on EVERY connect —
    // including the transient reconnects the injected socket performs itself.
    this.emitEmotion();
  };

  private handlePlaylist = (payload: any) => {
    // Drop anything that isn't the answer to our most recent request (zombie nav).
    if (!payload || payload.reqId !== this.latestReqId || this.latestReqId === 0) return;
    this.deps.onPlaylist(payload);
  };

  private handlePlaylistError = (payload: any) => {
    // Same reqId gate as playlist responses — a superseded request stays silent.
    if (!payload || payload.reqId !== this.latestReqId || this.latestReqId === 0) return;
    this.deps.onGenerationError?.(payload.message);
  };

  private handleAuthExpired = () => {
    // The token is dead: the socket's OWN auto-reconnect would storm with it. Kill
    // this socket and refresh instead. closedByUser suppresses the transient path
    // for the disconnect the server fires right after auth_expired.
    this.closedByUser = true;

    const t = this.now();
    this.authFailures = (t - this.lastAuthExpiredAt <= (this.deps.authWindowMs ?? DEFAULT_AUTH_WINDOW_MS))
      ? this.authFailures + 1
      : 1;
    this.lastAuthExpiredAt = t;

    if (this.authFailures > (this.deps.maxAuthRefreshes ?? DEFAULT_MAX_AUTH_REFRESHES)) {
      // A fresh token keeps dying immediately — stop the loop, force a clean re-auth.
      this.socket?.disconnect();
      this.deps.onLoggedOut();
      return;
    }
    void this.refreshAndReconnect();
  };

  // Transient disconnects (transport close/error) are handled by the injected
  // socket's own reconnection — we deliberately do NOTHING here so we never fight
  // the library's backoff or spawn a parallel socket. auth_expired and manual
  // closes are the only paths that replace the socket.
  private handleDisconnect = (_reason?: any) => {};

  private async refreshAndReconnect(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.socket?.disconnect(); // tear the dead-token socket down first
      const fresh = await this.deps.refreshToken();
      if (!fresh) { this.deps.onLoggedOut(); return; }
      this.closedByUser = false; // permit the fresh session's lifecycle again
      this.open(fresh);
    } catch {
      this.deps.onLoggedOut();
    } finally {
      this.refreshing = false;
    }
  }

  private emitEmotion(): void {
    if (!this.socket) return;
    const intent = this.deps.getEmotionIntent();
    this.socket.emit('emotion_update', {
      taps: intent.taps,
      textPrompt: intent.textPrompt,
      activity: intent.activity,
    });
  }

  // Emit the current intent (re-hydrate) THEN trigger generation, correlated by reqId.
  requestPlaylist(): number {
    this.reqCounter += 1;
    this.latestReqId = this.reqCounter;
    this.emitEmotion();
    this.socket?.emit('request_playlist', { reqId: this.latestReqId });
    return this.latestReqId;
  }

  // "Listen to your heart" — generation from the live HR alone (no emotion input).
  // Shares the reqId counter with requestPlaylist, so the playlist response is
  // gated identically. heartRate is only a hint; the server prefers its own window.
  requestHeartPlaylist(heartRate: number | null): number {
    this.reqCounter += 1;
    this.latestReqId = this.reqCounter;
    this.socket?.emit('request_heart_playlist', { reqId: this.latestReqId, heartRate });
    return this.latestReqId;
  }

  disconnect(): void {
    this.closedByUser = true;
    this.teardown();          // late events after a manual close are inert
    this.socket?.disconnect();
    this.socket = null;
  }
}
