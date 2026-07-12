import { PlaybackQueue, type QueueTrack } from './playbackQueue';

// The playback conductor. Owns the queue, drives the Spotify controller, and keeps
// its model reconciled with the native truth. All fragile edges are handled here:
// skip spam is coalesced into one command, a dead socket is revived on track-end,
// and a late track-end event can't skip behind the user's back.

export interface PlaybackPlayer {
  play(uri: string): Promise<{ ok: boolean }>;
  pause(): Promise<{ ok: boolean }>;
  resume(): Promise<{ ok: boolean }>;
  // D-1 context playback (optional — absent on legacy fakes → track-play fallback).
  playContext?(contextUri: string, index: number): Promise<{ ok: boolean }>;
  skipToIndex?(contextUri: string, index: number): Promise<{ ok: boolean }>;
}

export interface PlaybackSocket {
  requestPlaylist(): number;
  requestHeartPlaylist(hr: number | null): number;
  ensureConnected(): void;
}

export interface Scheduler {
  schedule(fn: () => void, ms: number): number;
  cancel(handle: number): void;
}

export interface NowPlaying {
  track: QueueTrack | null;
  isPlaying: boolean;
}

export interface PlaybackOrchestratorDeps {
  player: PlaybackPlayer;
  socket: PlaybackSocket;
  queue?: PlaybackQueue;
  scheduler?: Scheduler;
  onNowPlaying?: (state: NowPlaying) => void;
  coalesceMs?: number;
  // Safety net: if a generation request is lost (socket died mid-flight, server
  // never emits playlist OR playlist_error), the single-flight guard must not wedge
  // forever. After this long with no answer, the guard self-heals. (QA4 Q4)
  generationTimeoutMs?: number;
  // Report a dead DISCOVERY track (one carrying a recordingKey) so the backend can null
  // its stale cached resolved URI (T3 self-heal). A familiar track (recordingKey null) is
  // never reported. (Phase 2 discovery playback report)
  onPlaybackFailed?: (recordingKey: string) => void;
  // Cap on CONSECUTIVE failed plays before the auto-skip gives up. A severed remote also
  // yields ok:false, so without this a dead connection would runaway-skip the whole queue.
  // Default 3.
  maxConsecutiveFailures?: number;
}

const realScheduler: Scheduler = {
  schedule: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  cancel: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
};

export class PlaybackOrchestrator {
  private readonly player: PlaybackPlayer;
  private readonly socket: PlaybackSocket;
  private readonly queue: PlaybackQueue;
  private readonly scheduler: Scheduler;
  private readonly onNowPlaying?: (state: NowPlaying) => void;
  private readonly coalesceMs: number;
  private readonly generationTimeoutMs: number;
  private readonly onPlaybackFailed?: (recordingKey: string) => void;
  private readonly maxConsecutiveFailures: number;
  // Streak of back-to-back failed plays; cleared by any real play. Caps the auto-skip.
  private consecutiveFailures = 0;

  private isPlaying = false;
  private currentTrackId: string | null = null;
  private pendingPlayHandle: number | null = null;
  // D-1: the session-playlist context backing this queue (null → legacy track playback).
  // With a context, Spotify OWNS the queue order: skips are absolute jumps within it and
  // its auto-advance walks our tracks — divergence is structurally impossible.
  private contextUri: string | null = null;
  private generationPending = false; // a "generate more" request is in flight
  private generationTimeoutHandle: number | null = null;
  // Per-current-track latch: has the native player reported this track actively
  // PLAYING yet? Distinguishes "position 0 at track-end" from "position 0 at start".
  private sawActivePlayback = false;

  constructor(deps: PlaybackOrchestratorDeps) {
    this.player = deps.player;
    this.socket = deps.socket;
    this.queue = deps.queue ?? new PlaybackQueue();
    this.scheduler = deps.scheduler ?? realScheduler;
    this.onNowPlaying = deps.onNowPlaying;
    this.coalesceMs = deps.coalesceMs ?? 250;
    this.generationTimeoutMs = deps.generationTimeoutMs ?? 20000;
    this.onPlaybackFailed = deps.onPlaybackFailed;
    this.maxConsecutiveFailures = deps.maxConsecutiveFailures ?? 3;
  }

  getNowPlaying(): NowPlaying {
    return { track: this.queue.current(), isPlaying: this.isPlaying };
  }

  private emit(): void {
    this.onNowPlaying?.(this.getNowPlaying());
  }

  // Play the queue's current track NOW. In context mode the command is against the
  // session playlist: a fresh start plays the context at the cursor's playlist row; a
  // user skip is an ABSOLUTE jump (skipToIndex) — burst-safe, because N coalesced skips
  // land as one jump to wherever the cursor ended up. Legacy (no context) plays the URI.
  private async playCurrent(viaSkip = false): Promise<void> {
    const track = this.queue.current();
    if (!track || !track.uri) {
      console.log('[koko] playCurrent: NO playable track (uri missing) — nothing to play');
      this.isPlaying = false; this.currentTrackId = null; this.emit(); return;
    }
    this.currentTrackId = track.id;
    this.sawActivePlayback = false; // fresh track — await the native "playing" confirmation
    let res: { ok: boolean };
    if (this.contextUri && this.player.playContext) {
      const row = this.queue.playableIndex();
      console.log('[koko] playCurrent → context', viaSkip ? 'skipToIndex' : 'playContext', 'row=', row);
      res = viaSkip && this.player.skipToIndex
        ? await this.player.skipToIndex(this.contextUri, row)
        : await this.player.playContext(this.contextUri, row);
    } else {
      console.log('[koko] playCurrent → player.play uri=', track.uri);
      res = await this.player.play(track.uri);
    }
    console.log('[koko] play RESULT ok=', res.ok, 'uri=', track.uri);
    if (res.ok) {
      this.consecutiveFailures = 0; // a real play clears the failure streak
      this.isPlaying = true;
      this.emit();
      return;
    }
    // res.ok === false. Two indistinguishable causes (a dead discovery track vs a severed
    // remote) both land here; ACCEPT-AND-CAP: report the failed DISCOVERY track (harmless if
    // it was really a connection drop — the backend re-resolves to the same uri), then
    // SILENTLY skip to the next so audio continues. The cap stops a severed remote from
    // runaway-skipping the whole queue.
    if (track.recordingKey) this.onPlaybackFailed?.(track.recordingKey);
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures <= this.maxConsecutiveFailures && this.queue.hasNext()) {
      this.queue.next();
      await this.playCurrent(viaSkip); // try the next track (bounded recursion ≤ cap)
      return;
    }
    // cap reached, or nothing left to try → stop cleanly and reset the streak for the next action.
    this.consecutiveFailures = 0;
    this.isPlaying = false;
    this.emit();
  }

  async handlePlaylist(payload: { tracks: QueueTrack[]; contextUri?: string | null }): Promise<void> {
    console.log('[koko] orchestrator.handlePlaylist tracks=', payload?.tracks?.length ?? 0,
      'first=', payload?.tracks?.[0]?.uri, 'context=', payload?.contextUri ?? '(none)');
    this.cancelPendingPlay();
    this.clearGenerationGuard(); // the requested generation arrived
    this.contextUri = typeof payload?.contextUri === 'string' && payload.contextUri.length > 0
      ? payload.contextUri
      : null;
    this.queue.load(payload?.tracks ?? []);
    await this.playCurrent();
  }

  // Wire to the socket's playlist_error event so a failed generation unblocks the
  // guard instead of wedging it permanently.
  onGenerationError(): void {
    this.clearGenerationGuard();
  }

  private clearGenerationGuard(): void {
    this.generationPending = false;
    if (this.generationTimeoutHandle !== null) {
      this.scheduler.cancel(this.generationTimeoutHandle);
      this.generationTimeoutHandle = null;
    }
  }

  private cancelPendingPlay(): void {
    if (this.pendingPlayHandle !== null) {
      this.scheduler.cancel(this.pendingPlayHandle);
      this.pendingPlayHandle = null;
    }
  }

  // Coalesce a burst of skips: advance the cursor now (cheap), but debounce the
  // actual command so a frantic spam issues exactly ONE network/SDK call. In context
  // mode that one command is an absolute skipToIndex — N skips still land correctly.
  private scheduleCoalescedPlay(): void {
    this.cancelPendingPlay();
    this.pendingPlayHandle = this.scheduler.schedule(() => {
      this.pendingPlayHandle = null;
      void this.playCurrent(true);
    }, this.coalesceMs);
  }

  skipNext(): void {
    const t = this.queue.next();
    if (t === null) { this.requestMore(); return; } // ran off the end → generate more
    this.currentTrackId = t.id; // mark intent immediately so a stale end-event is ignored
    this.scheduleCoalescedPlay();
  }

  skipPrev(): void {
    const t = this.queue.prev();
    if (t === null) return;
    this.currentTrackId = t.id;
    this.scheduleCoalescedPlay();
  }

  // Fired when a track finishes. Ignore a stale end-event for a track the user has
  // already skipped past (it would otherwise double-advance behind their back).
  async onTrackEnded(endedTrackId?: string): Promise<void> {
    if (endedTrackId !== undefined && endedTrackId !== this.currentTrackId) return;
    if (this.queue.hasNext()) {
      this.queue.next();
      await this.playCurrent();
    } else {
      this.requestMore();
    }
  }

  async togglePlayPause(): Promise<void> {
    if (this.isPlaying) {
      await this.player.pause();
      this.isPlaying = false;
    } else {
      await this.player.resume();
      this.isPlaying = true;
    }
    this.emit();
  }

  // Live push from the native PlayerState stream (D-1). This is what ends the "phantom
  // track": a native auto-advance (track end → next) moves the QUEUE CURSOR to the
  // reported track and emits now-playing — WITHOUT re-commanding play (Spotify already
  // advanced; a play command would restart the track). A URI we never queued means the
  // user is driving Spotify directly — reflect not-playing, same rule as reconcile.
  syncToRemote(uri: string | null, isPaused: boolean, positionMs?: number, durationMs?: number): void {
    // A user skip is mid-coalesce: the remote still reports the pre-skip track, and the
    // scheduled play will assert the user's intent in a moment — don't fight it.
    if (this.pendingPlayHandle !== null) return;
    if (!uri) { this.isPlaying = false; this.emit(); return; }
    const ours = this.queue.current();
    if (ours && ours.uri === uri) {
      if (!isPaused) this.sawActivePlayback = true; // native confirms this track is playing
      // D-7/D-8: track-mode auto-advance. With no Spotify context (session-playlist
      // attach 403'd → contextUri=null), Spotify plays a single URI and will NOT walk
      // our queue — a finished track just pauses in place, so playback dead-ends. Detect
      // the finish from the native playback position and drive the SAME onTrackEnded
      // advance that context mode gets for free. In context mode Spotify owns the queue
      // and reports the NEXT uri (the adopt path below), so we must stay out here.
      if (this.contextUri === null && isPaused && this.isTrackFinished(positionMs, durationMs)) {
        void this.onTrackEnded(this.currentTrackId ?? undefined);
        return;
      }
      // Same track — a pause/resume done inside the Spotify app. Mirror it.
      this.isPlaying = !isPaused;
      this.emit();
      return;
    }
    const adopted = this.queue.seekToUri(uri);
    if (adopted) {
      this.currentTrackId = adopted.id;
      this.sawActivePlayback = !isPaused; // adopted a new current track (context auto-advance)
      this.isPlaying = !isPaused;
      this.emit();
      return;
    }
    // FOREIGN track — not ours, not in our queue. In no-context mode Spotify swaps trackUri
    // SEAMLESSLY to its OWN radio when our single-URI track ends (device evidence: it never
    // emits a paused-at-end, so position detection can't catch it). That foreign track IS the
    // reliable "our track finished" signal → reclaim: advance our queue and play our next,
    // instead of freezing NowPlaying on the finished track (defect A). The sawActivePlayback
    // latch fires this exactly ONCE per incursion (playCurrent resets it), so radio bleeding a
    // few more events can't runaway-skip the queue. Guarded to no-context + a track we actually
    // saw playing, so context mode and "user is driving Spotify directly" still yield (S11-1).
    if (this.contextUri === null && this.sawActivePlayback && this.queue.current()) {
      this.sawActivePlayback = false;
      void this.onTrackEnded(this.currentTrackId ?? undefined);
      return;
    }
    this.isPlaying = false; // foreign track, and we are not driving — reflect reality (S11-1)
    this.emit();
  }

  // A single-URI (no-context) track has finished when the native player is PAUSED and
  // the position sits at the very end — OR has reset to the start after we saw the track
  // actively playing. Without native position (a legacy native build emits only
  // {uri,isPaused}) end is indistinguishable from a user pause, so we report false and
  // fall back to mirroring the pause — today's behaviour, no phantom skips.
  private isTrackFinished(positionMs?: number, durationMs?: number): boolean {
    if (typeof positionMs !== 'number' || typeof durationMs !== 'number' || durationMs <= 0) return false;
    const END_EPSILON_MS = 1500; // "at the end" tolerance for the final PlayerState tick
    if (positionMs >= durationMs - END_EPSILON_MS) return true;
    if (positionMs <= 250 && this.sawActivePlayback) return true; // reset-to-0-at-end variant
    return false;
  }

  // Reconcile the local model with the native Spotify truth (foreground / desync).
  // If the remote reports one of OUR queued tracks, adopt it (the cursor may have
  // drifted while backgrounded — same lockstep rule as syncToRemote). A track we did
  // NOT queue (the user played something else in the Spotify app directly) means
  // Kokonada is not driving playback — reflect that truthfully as not-playing rather
  // than leaving a "ghost" claiming our track. (S11-1)
  reconcile(remote: { isPlaying: boolean; uri?: string } | 'disconnected'): void {
    if (remote === 'disconnected') { this.isPlaying = false; this.emit(); return; }
    const ours = this.queue.current();
    if (typeof remote.uri === 'string' && remote.uri.length > 0 && (!ours || remote.uri !== ours.uri)) {
      const adopted = this.queue.seekToUri(remote.uri);
      if (adopted) { this.currentTrackId = adopted.id; this.isPlaying = !!remote.isPlaying; this.emit(); return; }
      this.isPlaying = false; this.emit(); return; // truly foreign
    }
    this.isPlaying = !!remote.isPlaying;
    this.emit();
  }

  // Single-flight: a frantic skip past the end (or repeated track-ends) must not
  // fire a storm of generation requests / hit Spotify rate limits. One request is
  // in flight until its playlist arrives (or errors). (S11-2)
  private requestMore(): void {
    if (this.generationPending) return;
    this.generationPending = true;
    this.socket.ensureConnected(); // revive a background-killed socket first
    this.socket.requestPlaylist();
    // Arm the self-heal watchdog: if neither playlist nor playlist_error comes back
    // (a lost request over a dead socket), release the guard so the user isn't stuck
    // with a permanently-disabled "generate" and a spinner that never resolves.
    this.generationTimeoutHandle = this.scheduler.schedule(() => {
      this.generationTimeoutHandle = null;
      this.generationPending = false;
    }, this.generationTimeoutMs);
  }
}
