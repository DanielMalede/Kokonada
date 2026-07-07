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
  // The current dual-path mode (Part 2b). Pushed to the server on every (re)connect and
  // whenever it flips, so the server knows whether to auto-drive on HR band transitions.
  getLiveMode?: () => boolean;
  // Live-mode cold-buffer recalibration is warming a buffer — the server asks us to show
  // the loader ("assembling your live biometric soundscape") so the wait is never silent.
  onAssembling?: (message?: string) => void;
  // Onboarding: the server is still building the user's MusicProfile (playlist_building) —
  // show a determinate "setting up your library" loader instead of a hard error (D-6). The
  // client auto-retries the SAME request on a bounded schedule until the build completes.
  onBuilding?: (message?: string) => void;
  buildingRetryMs?: number;
  maxBuildingRetries?: number;
  // Injectable scheduler so the building auto-retry is deterministic in tests.
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  // Surface the live socket lifecycle so the UI can show a truthful connection badge
  // (the Pulse indicator was previously hardcoded to 'disconnected' — nothing wired it).
  onConnectionChange?: (status: 'connected' | 'connecting' | 'disconnected') => void;
  // Cap on auth_expired→refresh cycles within the window before we give up and log
  // out — the guard against a fresh-but-immediately-dead token looping forever.
  maxAuthRefreshes?: number;
  authWindowMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_AUTH_REFRESHES = 5;
const DEFAULT_AUTH_WINDOW_MS = 60_000;
// Building auto-retry: ~2 minutes of patience (a 4k-track profile build with YouTube
// classification can take a while). Each playlist_building refreshes the loader, so the
// wait is visible, never silent.
const DEFAULT_BUILDING_RETRY_MS = 4_000;
const DEFAULT_MAX_BUILDING_RETRIES = 30;

export class KokonadaSocket {
  private socket: SocketLike | null = null;
  private reqCounter = 0;
  private latestReqId = 0;
  private closedByUser = false;
  private refreshing = false;
  private authFailures = 0;
  private lastAuthExpiredAt = -Infinity;
  // The in-flight generation request. Set on send, cleared when its response (playlist or
  // error) arrives. Re-issued on every (re)connect so a request swallowed by a token-expiry
  // gate, a socket churn, or a reply to an orphaned socket is never silently lost.
  private pending: { kind: 'playlist' | 'heart'; reqId: number; heartRate?: number | null } | null = null;
  // Building auto-retry state (D-6): the scheduled retry timer + how many building
  // responses the current request has absorbed. Reset on every new request.
  private buildingTimer: unknown = null;
  private buildingRetries = 0;

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

  // Guarantee a socket to send on. Idempotent: a live socket is left ALONE (never churned),
  // but a session that never opened — a tokenless boot, or a first connect that failed — is
  // (re)opened now. This replaces the one-shot `socketStarted` latch in playbackServices,
  // which permanently blocked reconnection once any initial open failed. Called by every
  // request path so a generation can never be emitted into a null socket. (hasSocket=false bug)
  ensureOpen(): void {
    if (this.socket) return;
    console.log('[koko] ensureOpen: no live socket — connecting before send');
    this.connect();
  }

  private open(token: string): void {
    this.teardown(); // detach the previous socket's listeners BEFORE swapping
    const socket = this.deps.createSocket(token);
    this.socket = socket;
    socket.on('connect', this.handleConnect);
    socket.on('connect_error', this.handleConnectError);
    socket.on('playlist_ready', this.handlePlaylist);
    socket.on('playlist_error', this.handlePlaylistError);
    socket.on('playlist_building', this.handleBuilding);
    socket.on('live_assembling', this.handleAssembling);
    socket.on('auth_expired', this.handleAuthExpired);
    socket.on('disconnect', this.handleDisconnect);
    this.deps.onConnectionChange?.('connecting');
    console.log('[koko] socket opening (connecting)…');
    socket.connect();
  }

  // Remove our listeners from the current socket so a late, buffered event on a
  // replaced (dead) socket can never corrupt the new session — a stale auth_expired
  // must not spuriously log the user out, a stale playlist must not render. (S9-1)
  private teardown(): void {
    const s = this.socket;
    if (!s) return;
    s.off('connect', this.handleConnect);
    s.off('connect_error', this.handleConnectError);
    s.off('playlist_ready', this.handlePlaylist);
    s.off('playlist_error', this.handlePlaylistError);
    s.off('playlist_building', this.handleBuilding);
    s.off('live_assembling', this.handleAssembling);
    s.off('auth_expired', this.handleAuthExpired);
    s.off('disconnect', this.handleDisconnect);
  }

  // Bound handlers so on/off pair up and `this` is stable.
  private handleConnect = () => {
    console.log('[koko] socket CONNECTED');
    this.deps.onConnectionChange?.('connected');
    // Re-hydrate the server's per-socketId emotion cache on EVERY connect —
    // including the transient reconnects the injected socket performs itself.
    this.emitEmotion();
    // Re-assert the dual-path mode too (the server's flag is per-socketId, so a fresh
    // socketId starts Manual): without this a Live-mode user would silently stop being
    // auto-driven after any reconnect.
    this.syncLiveMode();
    // Delivery guarantee: if a generation request is still in flight (no response yet),
    // re-issue it on the fresh socket. Covers a request swallowed by the server's
    // token-expiry gate, a socket churn, or a reply sent to an orphaned socket.
    if (this.pending) {
      const p = this.pending;
      console.log('[koko] RE-SENDING pending request after (re)connect:', p.kind, 'reqId=', p.reqId);
      if (p.kind === 'playlist') this.socket?.emit('request_playlist', { reqId: p.reqId });
      else this.socket?.emit('request_heart_playlist', { reqId: p.reqId, heartRate: p.heartRate ?? null });
    }
  };

  // A failed connection attempt (bad URL, TLS, unauthorized handshake, network). The
  // library keeps retrying per its backoff; reflect the down state so the UI is honest.
  private handleConnectError = (err?: any) => {
    console.warn('[koko] socket connect_error:', err?.message ?? String(err));
    this.deps.onConnectionChange?.('disconnected');
  };

  private handlePlaylist = (payload: any) => {
    console.log('[koko] playlist_ready received tracks=', payload?.tracks?.length,
      'reqId=', payload?.reqId, 'trigger=', payload?.trigger, 'latest=', this.latestReqId);
    if (!payload) return;
    // Live-mode band recalibration: the server auto-pushes a `biometric` playlist with no
    // client reqId to correlate. The server already gated it on our live_mode, so accept it
    // unconditionally and route it to the queue — the reqId gate would otherwise drop it.
    // It does NOT clear a pending manual request (that request is still owed a reply).
    if (payload.trigger === 'biometric') { this.deps.onPlaylist(payload); return; }
    // Drop anything that isn't the answer to our most recent request (zombie nav).
    if (payload.reqId !== this.latestReqId || this.latestReqId === 0) return;
    if (this.pending?.reqId === payload.reqId) this.pending = null; // delivered — stop re-issuing
    this.clearBuildingTimer(); // a real answer ends the building retry loop (D-6)
    this.deps.onPlaylist(payload);
  };

  // The server is warming a cold buffer for the new HR band — surface the loader copy.
  private handleAssembling = (payload?: any) => {
    this.deps.onAssembling?.(payload?.message);
  };

  // Onboarding graceful loading (D-6): the server's MusicProfile row doesn't exist yet
  // (the background build is still running). Keep the loader alive with the building copy
  // and auto-retry the SAME pending request on a bounded schedule — the user never sees a
  // hard error for a brand-new account. Budget-exhausted → degrade to a soft error.
  private handleBuilding = (payload?: any) => {
    console.log('[koko] playlist_building received:', payload?.message, 'reqId=', payload?.reqId,
      'retries=', this.buildingRetries, 'latest=', this.latestReqId);
    // Same reqId gate as every response — a superseded request stays silent.
    if (!payload || payload.reqId !== this.latestReqId || this.latestReqId === 0) return;
    if (!this.pending || this.pending.reqId !== payload.reqId) return;

    this.buildingRetries += 1;
    if (this.buildingRetries > (this.deps.maxBuildingRetries ?? DEFAULT_MAX_BUILDING_RETRIES)) {
      // Give up softly: clear the pending request (stop reconnect re-sends too) and surface
      // a friendly retry-later message through the normal error channel.
      this.clearBuildingTimer();
      this.pending = null;
      this.deps.onGenerationError?.(payload.message ?? 'Your library is still being set up — try again shortly.');
      return;
    }

    this.deps.onBuilding?.(payload.message);
    const reqId = payload.reqId;
    this.clearBuildingTimer();
    const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.buildingTimer = set(() => {
      this.buildingTimer = null;
      // Only re-issue if this exact request is STILL unanswered (ready/error clears pending).
      if (!this.pending || this.pending.reqId !== reqId) return;
      const p = this.pending;
      console.log('[koko] building retry — re-sending request reqId=', reqId);
      if (p.kind === 'playlist') this.socket?.emit('request_playlist', { reqId });
      else this.socket?.emit('request_heart_playlist', { reqId, heartRate: p.heartRate ?? null });
    }, this.deps.buildingRetryMs ?? DEFAULT_BUILDING_RETRY_MS);
  };

  private clearBuildingTimer(): void {
    if (this.buildingTimer == null) return;
    const clear = this.deps.clearTimer ?? ((id: unknown) => clearTimeout(id as any));
    clear(this.buildingTimer);
    this.buildingTimer = null;
  }

  private handlePlaylistError = (payload: any) => {
    console.log('[koko] playlist_error received:', payload?.message, 'reqId=', payload?.reqId, 'latest=', this.latestReqId);
    // Same reqId gate as playlist responses — a superseded request stays silent.
    if (!payload || payload.reqId !== this.latestReqId || this.latestReqId === 0) return;
    if (this.pending?.reqId === payload.reqId) this.pending = null; // delivered — stop re-issuing
    this.clearBuildingTimer(); // a real answer ends the building retry loop (D-6)
    this.deps.onGenerationError?.(payload.message);
  };

  private handleAuthExpired = () => {
    console.warn('[koko] AUTH_EXPIRED — server rejected the session; refreshing + reconnecting (pending request will be re-sent)');
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

  // Transient disconnects (transport close/error) are handled by the injected socket's
  // own reconnection — we do NOT replace the socket here, so we never fight the library's
  // backoff or spawn a parallel one (auth_expired and manual closes are the only paths
  // that swap it). We only reflect the down state to the UI badge.
  private handleDisconnect = (reason?: any) => {
    console.log('[koko] socket DISCONNECTED:', reason);
    this.deps.onConnectionChange?.('disconnected');
  };

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
    this.ensureOpen(); // never emit into a null socket
    this.reqCounter += 1;
    this.latestReqId = this.reqCounter;
    this.pending = { kind: 'playlist', reqId: this.latestReqId };
    this.clearBuildingTimer(); this.buildingRetries = 0; // fresh request → fresh building budget
    console.log('[koko] → request_playlist reqId=', this.latestReqId, 'hasSocket=', !!this.socket);
    this.emitEmotion();
    this.socket?.emit('request_playlist', { reqId: this.latestReqId });
    return this.latestReqId;
  }

  // "Listen to your heart" — generation from the live HR alone (no emotion input).
  // Shares the reqId counter with requestPlaylist, so the playlist response is
  // gated identically. heartRate is only a hint; the server prefers its own window.
  requestHeartPlaylist(heartRate: number | null): number {
    this.ensureOpen(); // never emit into a null socket
    this.reqCounter += 1;
    this.latestReqId = this.reqCounter;
    this.pending = { kind: 'heart', reqId: this.latestReqId, heartRate };
    this.clearBuildingTimer(); this.buildingRetries = 0; // fresh request → fresh building budget
    console.log('[koko] → request_heart_playlist reqId=', this.latestReqId, 'hr=', heartRate, 'hasSocket=', !!this.socket);
    this.socket?.emit('request_heart_playlist', { reqId: this.latestReqId, heartRate });
    return this.latestReqId;
  }

  // Push the current Live/Manual mode to the server (per-socketId, so it must be re-asserted
  // on reconnect). Called on every connect and whenever the user flips the toggle. Safe to
  // call before a socket exists — it no-ops until the next connect re-emits it.
  syncLiveMode(): void {
    this.socket?.emit('live_mode', { enabled: this.deps.getLiveMode?.() ?? false });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearBuildingTimer(); // no building retry may outlive a manual close (D-6)
    this.teardown();          // late events after a manual close are inert
    this.socket?.disconnect();
    this.socket = null;
  }
}
