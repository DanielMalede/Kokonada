import type { Store } from '@reduxjs/toolkit';
import { addTap, type EmotionState, type Tap } from '../../state/cold/emotionSlice';
import { TapCommitter } from '../../state/hot/laneCommit';
import type { WarmStore } from '../../state/warm/warmStore';

// The socket surface the Generate screen needs. KokonadaSocket implements both.
export interface SocketApi {
  requestPlaylist(): number;
  requestHeartPlaylist(hr: number | null): number;
}

interface RootState { emotion: EmotionState; }

export type CtaMode = 'generate' | 'listen-to-heart' | 'disabled';
export interface SubmitResult { mode: Exclude<CtaMode, 'disabled'>; reqId: number; }

export interface GenerateControllerDeps {
  store: Store<RootState>;
  warmStore: WarmStore;
  socket: SocketApi;
  now?: () => number;
  minGapMs?: number;
}

// Orchestrates the Generate screen. The hot lane (wheel worklet) calls commitTap
// on gesture-end; the CTA reflects the current cold intent + live HR; submit fires
// the matching request. The hot→cold path is a synchronous dispatch, so a tap and
// a submit can interleave freely without a torn read or a swallowed coordinate.
export class GenerateController {
  private readonly deps: GenerateControllerDeps;
  private readonly committer: TapCommitter;

  constructor(deps: GenerateControllerDeps) {
    this.deps = deps;
    this.committer = new TapCommitter({
      dispatch: (tap: Tap) => this.deps.store.dispatch(addTap(tap)),
      now: deps.now ?? Date.now,
      minGapMs: deps.minGapMs ?? 0,
    });
  }

  // Hot→cold handoff. Clamps + commits a circumplex point into the cold store.
  commitTap(circumplex: Tap): boolean {
    return this.committer.commit(circumplex);
  }

  private hasEmotionInput(): boolean {
    const e = this.deps.store.getState().emotion;
    return e.taps.length > 0 || e.activity !== null || e.textPrompt.trim().length > 0;
  }

  private liveHr(): number | null {
    return this.deps.warmStore.getState().liveHr;
  }

  ctaMode(): CtaMode {
    if (this.hasEmotionInput()) return 'generate';
    if (this.liveHr() !== null) return 'listen-to-heart';
    return 'disabled';
  }

  submit(): SubmitResult | null {
    const mode = this.ctaMode();
    if (mode === 'generate') {
      return { mode, reqId: this.deps.socket.requestPlaylist() };
    }
    if (mode === 'listen-to-heart') {
      return { mode, reqId: this.deps.socket.requestHeartPlaylist(this.liveHr()) };
    }
    return null;
  }
}
