// HOT→COLD boundary logic. The gesture math runs in a Reanimated worklet on the UI
// thread; these pure helpers are what crosses into JS on commit, plus the aura
// smoothing that must survive frame-rate drops.

export interface Point {
  x: number;
  y: number;
}

// Clamp a point to the unit disc (the wheel). Non-finite coordinates collapse to
// the center rather than poisoning the cold lane with NaN.
export function clampToDisc(p: Point): Point {
  const x = Number.isFinite(p.x) ? p.x : NaN;
  const y = Number.isFinite(p.y) ? p.y : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const r = Math.hypot(x, y);
  if (r <= 1) return { x, y };
  return { x: x / r, y: y / r };
}

export interface TapCommitterDeps {
  dispatch: (tap: Point) => void;
  now: () => number;
  minGapMs: number;
}

// Commits a tap from the hot lane into the cold lane. Two safeguards:
//  - Every commit is a fresh CLAMPED COPY, so a worklet reusing one frame object
//    (mutated after commit) can never retroactively corrupt a committed tap.
//  - A second commit within minGapMs is swallowed, absorbing a double-fired
//    gesture-end / bounce without producing a duplicate tap.
export class TapCommitter {
  private lastCommitAt = -Infinity;

  constructor(private readonly deps: TapCommitterDeps) {}

  commit(raw: Point): boolean {
    const t = this.deps.now();
    if (t - this.lastCommitAt < this.deps.minGapMs) return false;
    this.lastCommitAt = t;
    const snapshot = clampToDisc({ x: raw.x, y: raw.y }); // copy + clamp
    this.deps.dispatch(snapshot);
    return true;
  }
}

// Time-based exponential smoothing for the bio-aura. alpha derives from ELAPSED
// TIME, not frame count, so convergence is identical at 120Hz, 60Hz or 30Hz — the
// crux of graceful degradation under thermal throttling / low-power mode. A
// non-positive dt is a no-op (clock glitch / paused clock guard).
export function smoothTowards(prev: number, target: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0 || tauMs <= 0) return prev;
  const alpha = 1 - Math.exp(-dtMs / tauMs); // (0,1], saturates as dt→∞ (never overshoots)
  return prev + (target - prev) * alpha;
}
