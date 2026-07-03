// The HOT→COLD boundary. The radial wheel gesture runs in a Reanimated worklet at
// up to 120Hz (untestable native), but the moment a tap is COMMITTED to the cold
// lane is pure logic — and it's where two attacks bite:
//   #2 Three-Lane Race: rapid hot updates + a delayed cold commit must not corrupt
//      the tap (no torn/aliased coordinates); the worklet reuses one frame object.
//   #6 Thermal/Low-Power (120Hz→60Hz→30Hz): the aura smoothing must be TIME-based,
//      so it converges at the same wall-clock rate regardless of frame rate.

import { clampToDisc, TapCommitter, smoothTowards } from '../laneCommit';

describe('clampToDisc — keep taps inside the wheel', () => {
  it('leaves an in-disc point untouched', () => {
    expect(clampToDisc({ x: 0.3, y: -0.4 })).toEqual({ x: 0.3, y: -0.4 });
  });
  it('projects an out-of-disc point onto the unit circle', () => {
    const c = clampToDisc({ x: 3, y: 4 }); // radius 5 → scale to 1
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(1, 6);
    expect(c.x).toBeCloseTo(0.6, 6);
    expect(c.y).toBeCloseTo(0.8, 6);
  });
  it('sanitizes NaN/Infinity coordinates to the center', () => {
    expect(clampToDisc({ x: NaN, y: 0.5 })).toEqual({ x: 0, y: 0 });
    expect(clampToDisc({ x: Infinity, y: -Infinity })).toEqual({ x: 0, y: 0 });
  });
});

describe('TapCommitter — aliasing-safe commits (attack #2)', () => {
  it('commits a defensive COPY — a mutated worklet frame object cannot corrupt a committed tap', () => {
    const committed: Array<{ x: number; y: number }> = [];
    const c = new TapCommitter({ dispatch: (t) => committed.push(t), now: () => 0, minGapMs: 0 });

    // The worklet reuses ONE frame object, mutating x/y between gesture-ends.
    // Both points are inside the unit disc, isolating the aliasing property.
    const frame = { x: 0.1, y: 0.1 };
    c.commit(frame);
    frame.x = 0.5; frame.y = 0.5; // hot lane moves on
    c.commit(frame);

    expect(committed[0]).toEqual({ x: 0.1, y: 0.1 }); // first snapshot NOT retroactively mutated
    expect(committed[1]).toEqual({ x: 0.5, y: 0.5 });
    expect(committed[0]).not.toBe(frame);
  });

  it('debounces a double-fired gesture-end within minGapMs (no duplicate tap)', () => {
    let t = 1000;
    const committed: Array<{ x: number; y: number }> = [];
    const c = new TapCommitter({ dispatch: (t2) => committed.push(t2), now: () => t, minGapMs: 50 });

    expect(c.commit({ x: 0.2, y: 0.2 })).toBe(true);
    t = 1020; // 20ms later — a bounce
    expect(c.commit({ x: 0.2, y: 0.2 })).toBe(false); // swallowed
    t = 1100; // 100ms later — a real new tap
    expect(c.commit({ x: 0.5, y: 0.5 })).toBe(true);

    expect(committed).toHaveLength(2);
  });

  it('clamps every committed tap to the disc', () => {
    const committed: Array<{ x: number; y: number }> = [];
    const c = new TapCommitter({ dispatch: (t) => committed.push(t), now: () => 0, minGapMs: 0 });
    c.commit({ x: 10, y: 0 });
    expect(Math.hypot(committed[0].x, committed[0].y)).toBeCloseTo(1, 6);
  });

  it('a burst of 100 rapid commits never produces a NaN or out-of-disc tap', () => {
    const committed: Array<{ x: number; y: number }> = [];
    let t = 0;
    const c = new TapCommitter({ dispatch: (tap) => committed.push(tap), now: () => t, minGapMs: 0 });
    for (let i = 0; i < 100; i++) { t += 10; c.commit({ x: Math.sin(i) * 2, y: Math.cos(i) * 2 }); }
    for (const tap of committed) {
      expect(Number.isFinite(tap.x) && Number.isFinite(tap.y)).toBe(true);
      expect(Math.hypot(tap.x, tap.y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('smoothTowards — frame-rate independence (attack #6)', () => {
  const tau = 100; // ms time-constant

  it('converges to the same value in one big step as in many small steps', () => {
    // one 120ms step at "30Hz-ish"
    const coarse = smoothTowards(60, 90, 120, tau);
    // twelve 10ms steps at "120Hz"
    let fine = 60;
    for (let i = 0; i < 12; i++) fine = smoothTowards(fine, 90, 10, tau);
    expect(coarse).toBeCloseTo(fine, 1); // same wall-clock convergence, ±0.05
  });

  it('a dropped frame (huge dt) does not overshoot past the target', () => {
    const v = smoothTowards(60, 90, 100000, tau); // app was backgrounded, dt is enormous
    expect(v).toBeGreaterThan(89.9);
    expect(v).toBeLessThanOrEqual(90); // never past target, no oscillation
  });

  it('a zero/negative dt is a no-op (clock glitch guard)', () => {
    expect(smoothTowards(60, 90, 0, tau)).toBe(60);
    expect(smoothTowards(60, 90, -50, tau)).toBe(60);
  });
});
