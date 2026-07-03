// The radial wheel maps a finger position on a Skia canvas to a circumplex
// coordinate (x=valence −1..1, y=arousal −1..1). Screen Y grows DOWN but arousal
// grows UP, so the mapping flips Y. Everything is clamped to the unit disc and
// hardened against garbage input — the gesture worklet feeds this raw, frantic,
// possibly out-of-bounds pointer data (attacks #1 and #3).

import {
  screenToCircumplex, circumplexToScreen, radialFraction, isOnWheel,
  type WheelLayout,
} from '../wheelGeometry';

// A 300px wheel centered at (150,150), radius 150.
const layout: WheelLayout = { cx: 150, cy: 150, radius: 150 };

describe('screenToCircumplex — finger → circumplex', () => {
  it('maps the exact center to (0,0)', () => {
    expect(screenToCircumplex({ x: 150, y: 150 }, layout)).toEqual({ x: 0, y: 0 });
  });

  it('flips Y: a finger ABOVE center is positive arousal', () => {
    const c = screenToCircumplex({ x: 150, y: 75 }, layout); // 75px above center
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.y).toBeCloseTo(0.5, 6); // up = +arousal
  });

  it('a finger to the RIGHT is positive valence', () => {
    const c = screenToCircumplex({ x: 225, y: 150 }, layout);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0, 6);
  });

  it('a finger below-left is negative valence, negative arousal', () => {
    const c = screenToCircumplex({ x: 75, y: 225 }, layout);
    expect(c.x).toBeCloseTo(-0.5, 6);
    expect(c.y).toBeCloseTo(-0.5, 6);
  });

  it('clamps a finger dragged far outside the wheel onto the unit circle', () => {
    const c = screenToCircumplex({ x: 600, y: 150 }, layout); // way past the right edge
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(1, 6);
    expect(c.x).toBeCloseTo(1, 6);
  });

  it('NaN/Infinity finger coordinates collapse to center, never NaN', () => {
    expect(screenToCircumplex({ x: NaN, y: 10 }, layout)).toEqual({ x: 0, y: 0 });
    expect(screenToCircumplex({ x: Infinity, y: -Infinity }, layout)).toEqual({ x: 0, y: 0 });
  });

  it('a degenerate zero-radius layout never divides by zero', () => {
    const c = screenToCircumplex({ x: 10, y: 10 }, { cx: 0, cy: 0, radius: 0 });
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
  });
});

describe('circumplexToScreen — committed dot → canvas', () => {
  it('round-trips an in-disc point', () => {
    const original = { x: 0.3, y: -0.4 };
    const screen = circumplexToScreen(original, layout);
    const back = screenToCircumplex(screen, layout);
    expect(back.x).toBeCloseTo(0.3, 6);
    expect(back.y).toBeCloseTo(-0.4, 6);
  });

  it('places +arousal ABOVE center on screen (Y flipped back)', () => {
    const screen = circumplexToScreen({ x: 0, y: 1 }, layout);
    expect(screen.x).toBeCloseTo(150, 6);
    expect(screen.y).toBeCloseTo(0, 6); // top of the wheel
  });
});

describe('radialFraction / isOnWheel — hit testing', () => {
  it('reports 0 at center, 1 at the rim', () => {
    expect(radialFraction({ x: 150, y: 150 }, layout)).toBeCloseTo(0, 6);
    expect(radialFraction({ x: 300, y: 150 }, layout)).toBeCloseTo(1, 6);
  });

  it('isOnWheel accepts touches inside the rim (with a small slop) and rejects far ones', () => {
    expect(isOnWheel({ x: 150, y: 150 }, layout)).toBe(true);
    expect(isOnWheel({ x: 295, y: 150 }, layout)).toBe(true);   // near rim
    expect(isOnWheel({ x: 500, y: 150 }, layout)).toBe(false);  // way outside
  });

  it('isOnWheel is false for NaN input', () => {
    expect(isOnWheel({ x: NaN, y: NaN }, layout)).toBe(false);
  });
});
