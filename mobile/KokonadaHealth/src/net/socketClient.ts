// Typed Socket.IO client for the Kokonada backend. Owns the whole connection
// lifecycle so no screen has to: reqId correlation (stale-response discard),
// reconnect re-hydration (the server's emotion cache is per-socketId), and the
// auth_expired refresh-then-reconnect that stops a dead-token reconnect storm.

import { finalizePrompt } from '../experience/generate/promptSanitizer';

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
  // C4: true while the session still holds its token pair. A null refresh with the session still
  // active was `unavailable` (no verdict from the server): the socket stays down without a logout,
  // and the next ensureOpen() or reconnect() refreshes first. Absent: every null refresh logs out.
  isSessionActive?: () => boolean;
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
// Building auto-retry: each playlist_building (profile build OR the server's warmup
// heartbeat — a retry mid-generation is adopted and answered, never dropped) refreshes
// the loader and schedules a re-request. Patience must OUTLAST the server's 180s warmup
// ceiling so its final verdict (playlist or error) arrives before we give up locally.
const DEFAULT_BUILDING_RETRY_MS = 4_000;
const DEFAULT_MAX_BUILDING_RETRIES = 55; // ≈220s at 4s cadence

// RA-47: a connect_error is logged as a fixed code, never its own text — a release build writes every
// console argument to logcat, and the text is the server's or the transport's, not ours.
function connectErrorCode(err: any): 'unauthorized' | 'transport' | 'other' {
  if (err?.message === 'unauthorized') return 'unauthorized'; // the handshake middleware's refusal (backend/app/sockets/index.js)
  if (err?.type === 'TransportError') return 'transport'; // socket.io-client's transport failure
  return 'other';
}

export class KokonadaSocket {
  private socket: SocketLike | null = null;
  private reqCounter = 0;
  private latestReqId = 0;
  private closedByUser = false;
  // The one refresh-then-open in flight (auth_expired or reconnect()): single-flight.
  private recovery: Promise<void> | null = null;
  // Set when the socket's access token was refused and the refresh was unavailable: the next
  // open must go through a refresh, never the refused token.
  private needsRefresh = false;
  // Bumped by disconnect(), so a recovery in flight never reopens after a manual close.
  private closes = 0;
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
    if (this.socket || this.recovery) return; // a live socket, or one being opened on a fresh token
    if (this.needsRefresh) { void this.reconnect(); return; } // its token was refused: refresh first
    console.log('[koko] ensureOpen: no live socket — connecting before send');
    this.connect();
  }

  // C4: replace whatever socket there is with one opened on a REFRESHED token — the way back after a
  // refresh that came back unavailable left the socket down (the session stands; C1). Single-flight;
  // a refresh that is unavailable again stays down without a logout, a dead session logs out, and a
  // disconnect() while it waits wins.
  reconnect(): Promise<void> {
    if (!this.recovery) {
      const run = this.refreshAndReconnect();
      this.recovery = run;
      const settle = () => { if (this.recovery === run) this.recovery = null; };
      run.then(settle, settle); // both paths handled: this promise cannot reject
    }
    return this.recovery;
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
    socket.on('reconnect_failed', this.handleReconnectFailed);
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
    s.off('reconnect_failed', this.handleReconnectFailed);
  }

  // RA-6: forget a socket socket.io will never bring back, so ensureOpen() opens a new one instead of
  // trusting it for the rest of the process. No listener is left on it, and it is closed.
  private dropSocket(): void {
    this.teardown();
    this.socket?.disconnect();
    this.socket = null;
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
    const code = connectErrorCode(err);
    console.warn('[koko] socket connect_error:', code);
    this.deps.onConnectionChange?.('disconnected');
    // RA-6 / MB-183: the handshake middleware refused the token, and socket.io destroyed the socket on
    // that refusal (socket.js:520-527): it never retries it. Drop it, and refresh before the next open,
    // never reusing the refused token. A transport error stays: the Manager retries that socket.
    if (code === 'unauthorized') {
      this.dropSocket();
      this.needsRefresh = true;
    }
  };

  // RA-6: the Manager spent its reconnection attempts (manager.js:365-369, through socketFactory's
  // port): this socket is dead for good. Its token was never refused, so the next ensureOpen() opens a
  // new socket on the current token, no refresh first.
  private handleReconnectFailed = () => {
    console.warn('[koko] socket reconnect_failed: the socket is dropped');
    this.dropSocket();
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
    console.log('[koko] playlist_building received: hasMessage=', typeof payload?.message === 'string', 'reqId=', payload?.reqId,
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
    console.log('[koko] playlist_error received: hasMessage=', typeof payload?.message === 'string', 'reqId=', payload?.reqId, 'latest=', this.latestReqId);
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
      // A fresh token keeps dying immediately — stop the loop. That is no proof the session is
      // dead, so a live one stays (down) and only an ended one logs out (C4).
      this.stopOrStayDown();
      return;
    }
    void this.reconnect();
  };

  // Transient disconnects (transport close/error) are handled by the injected socket's
  // own reconnection — we do NOT replace the socket here, so we never fight the library's
  // backoff or spawn a parallel one. We reflect the down state to the UI badge.
  // RA-6: a server disconnect is not transient: socket.io destroys the socket the server closed
  // (socket.js:639-643) and never reconnects it, so it is dropped and the next ensureOpen() opens anew.
  private handleDisconnect = (reason?: any) => {
    console.log('[koko] socket DISCONNECTED:', reason);
    this.deps.onConnectionChange?.('disconnected');
    if (reason === 'io server disconnect') this.dropSocket();
  };

  private async refreshAndReconnect(): Promise<void> {
    const closes = this.closes;
    try {
      this.socket?.disconnect(); // tear the dead-token socket down first
      let fresh: string | null = null;
      try { fresh = await this.deps.refreshToken(); } catch { /* no verdict: as a null refresh */ }
      if (closes !== this.closes) return; // disconnect() while the refresh was in flight: the close wins
      if (!fresh) { this.stopOrStayDown(); return; }
      this.needsRefresh = false;
      this.closedByUser = false; // permit the fresh session's lifecycle again
      this.open(fresh);
    } catch {
      this.stopOrStayDown();
    }
  }

  // The socket cannot authenticate now. Either way no dead socket is left listening, or trusted by
  // ensureOpen(). A session that has ended (or never was) logs out; a live one — its refresh was
  // unavailable (C1) — stays down, and the next ensureOpen() or reconnect() refreshes first.
  private stopOrStayDown(): void {
    this.dropSocket();
    if (this.deps.isSessionActive?.()) {
      this.needsRefresh = true;
      this.deps.onConnectionChange?.('disconnected');
      return;
    }
    this.deps.onLoggedOut();
  }

  private emitEmotion(): void {
    if (!this.socket) return;
    const intent = this.deps.getEmotionIntent();
    this.socket.emit('emotion_update', {
      taps: intent.taps,
      // The cold store keeps the prompt verbatim while typing (so spaces never glue); this is the
      // single SUBMIT/re-hydration point where it's finalized (.trim()) before it crosses the wire.
      textPrompt: finalizePrompt(intent.textPrompt),
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
    // RA-45: whether a heart rate rides along, never the value (a release build logs to logcat).
    console.log('[koko] → request_heart_playlist reqId=', this.latestReqId, 'hasHr=', heartRate != null, 'hasSocket=', !!this.socket);
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
    this.closes += 1; // a recovery in flight must not reopen after a manual close
    // ARCH-309-1 = RA-1: ...nor be trusted by ensureOpen() or returned by reconnect() for the next
    // account: the abandoned run settles on its own and its settle leaves a newer run alone.
    this.recovery = null;
    this.needsRefresh = false;
    this.closedByUser = true;
    // RA-5 = MB-016: a disconnect() is the account boundary. An unanswered request belongs to the
    // session that sent it (a heart request carries its heart rate), so the next connect re-sends
    // nothing and a late reply to it is dropped by the gate. reqCounter is NOT reset: reqIds never
    // repeat, so no reply of the old session can pass for a request of the next one.
    this.pending = null;
    this.latestReqId = 0;
    this.buildingRetries = 0;
    this.authFailures = 0; // one account's auth storm never spends the next account's refresh budget
    this.lastAuthExpiredAt = -Infinity;
    this.clearBuildingTimer(); // no building retry may outlive a manual close (D-6)
    this.teardown();          // late events after a manual close are inert
    this.socket?.disconnect();
    this.socket = null;
  }
}
