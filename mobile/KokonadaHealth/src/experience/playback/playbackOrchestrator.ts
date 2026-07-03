import { PlaybackQueue, type QueueTrack } from './playbackQueue';

// The playback conductor. Owns the queue, drives the Spotify controller, and keeps
// its model reconciled with the native truth. All fragile edges are handled here:
// skip spam is coalesced into one command, a dead socket is revived on track-end,
// and a late track-end event can't skip behind the user's back.

export interface PlaybackPlayer {
  play(uri: string): Promise<{ ok: boolean }>;
  pause(): Promise<{ ok: boolean }>;
  resume(): Promise<{ ok: boolean }>;
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

  private isPlaying = false;
  private currentTrackId: string | null = null;
  private pendingPlayHandle: number | null = null;
  private generationPending = false; // a "generate more" request is in flight

  constructor(deps: PlaybackOrchestratorDeps) {
    this.player = deps.player;
    this.socket = deps.socket;
    this.queue = deps.queue ?? new PlaybackQueue();
    this.scheduler = deps.scheduler ?? realScheduler;
    this.onNowPlaying = deps.onNowPlaying;
    this.coalesceMs = deps.coalesceMs ?? 250;
  }

  getNowPlaying(): NowPlaying {
    return { track: this.queue.current(), isPlaying: this.isPlaying };
  }

  private emit(): void {
    this.onNowPlaying?.(this.getNowPlaying());
  }

  // Play the queue's current track NOW (used for a new playlist / natural advance).
  private async playCurrent(): Promise<void> {
    const track = this.queue.current();
    if (!track || !track.uri) { this.isPlaying = false; this.currentTrackId = null; this.emit(); return; }
    this.currentTrackId = track.id;
    const res = await this.player.play(track.uri);
    this.isPlaying = res.ok; // a severed remote → truthfully not playing
    this.emit();
  }

  async handlePlaylist(payload: { tracks: QueueTrack[] }): Promise<void> {
    this.cancelPendingPlay();
    this.generationPending = false; // the requested generation arrived
    this.queue.load(payload?.tracks ?? []);
    await this.playCurrent();
  }

  // Wire to the socket's playlist_error event so a failed generation unblocks the
  // guard instead of wedging it permanently.
  onGenerationError(): void {
    this.generationPending = false;
  }

  private cancelPendingPlay(): void {
    if (this.pendingPlayHandle !== null) {
      this.scheduler.cancel(this.pendingPlayHandle);
      this.pendingPlayHandle = null;
    }
  }

  // Coalesce a burst of skips: advance the cursor now (cheap), but debounce the
  // actual play command so a frantic spam issues exactly ONE network/SDK call.
  private scheduleCoalescedPlay(): void {
    this.cancelPendingPlay();
    this.pendingPlayHandle = this.scheduler.schedule(() => {
      this.pendingPlayHandle = null;
      void this.playCurrent();
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

  // Reconcile the local model with the native Spotify truth (foreground / desync).
  // If the remote reports a track we did NOT queue (the user played something else
  // in the Spotify app directly), Kokonada is not driving playback — reflect that
  // truthfully as not-playing rather than leaving a "ghost" claiming our track. (S11-1)
  reconcile(remote: { isPlaying: boolean; uri?: string } | 'disconnected'): void {
    if (remote === 'disconnected') { this.isPlaying = false; this.emit(); return; }
    const ours = this.queue.current();
    const foreign = typeof remote.uri === 'string' && ours != null && remote.uri !== ours.uri;
    this.isPlaying = foreign ? false : !!remote.isPlaying;
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
  }
}
