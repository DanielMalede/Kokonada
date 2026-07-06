import {
  fibonacciSphere,
  nearestEdges,
  projectNode,
  heat,
  clamp01,
  CYAN,
  RED,
} from '../neuralLoaderMath';

describe('fibonacciSphere', () => {
  it('returns n points, each on the unit sphere', () => {
    const pts = fibonacciSphere(44);
    expect(pts).toHaveLength(44);
    for (const p of pts) {
      const len = Math.hypot(p.x, p.y, p.z);
      expect(len).toBeCloseTo(1, 5);
      expect(p.phase).toBeGreaterThanOrEqual(0);
      expect(p.phase).toBeLessThan(Math.PI * 2);
    }
  });

  it('spreads points across the full y range (not clustered)', () => {
    const pts = fibonacciSphere(40);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(-0.9);
    expect(Math.max(...ys)).toBeGreaterThan(0.9);
  });

  it('degenerate counts never divide-by-zero or throw', () => {
    expect(fibonacciSphere(0)).toEqual([]);
    const one = fibonacciSphere(1);
    expect(one).toHaveLength(1);
    expect(Number.isFinite(one[0].x)).toBe(true);
    expect(Number.isFinite(one[0].y)).toBe(true);
  });
});

describe('nearestEdges', () => {
  const nodes = fibonacciSphere(30);
  const edges = nearestEdges(nodes, 3);

  it('produces undirected, de-duplicated edges with valid, ordered indices', () => {
    const seen = new Set<string>();
    for (const [a, b] of edges) {
      expect(a).toBeLessThan(b); // canonical order (a<b) → no reversed dupes
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(nodes.length);
      const key = `${a}-${b}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('connects every node to at least one neighbour (no orphans)', () => {
    const touched = new Set<number>();
    for (const [a, b] of edges) { touched.add(a); touched.add(b); }
    expect(touched.size).toBe(nodes.length);
  });

  it('is empty for a single node', () => {
    expect(nearestEdges(fibonacciSphere(1), 3)).toEqual([]);
  });
});

describe('projectNode', () => {
  it('with zero rotation maps to (x, y) and depth (z+1)/2', () => {
    const n = { x: 0.6, y: -0.3, z: 0.75, phase: 1 };
    const p = projectNode(n, 0, 0);
    expect(p.px).toBeCloseTo(0.6, 6);
    expect(p.py).toBeCloseTo(-0.3, 6);
    expect(p.depth).toBeCloseTo((0.75 + 1) / 2, 6);
    expect(p.phase).toBe(1);
  });

  it('keeps a unit node within the [-1,1] plane and depth within [0,1] under any rotation', () => {
    const n = { x: 0, y: 0, z: 1, phase: 0 };
    for (const [ry, rx] of [[1, 0.5], [3.1, -2], [10, 4]]) {
      const p = projectNode(n, ry, rx);
      expect(p.px).toBeGreaterThanOrEqual(-1.0001);
      expect(p.px).toBeLessThanOrEqual(1.0001);
      expect(p.py).toBeGreaterThanOrEqual(-1.0001);
      expect(p.py).toBeLessThanOrEqual(1.0001);
      expect(p.depth).toBeGreaterThanOrEqual(0);
      expect(p.depth).toBeLessThanOrEqual(1);
    }
  });

  it('is NaN-safe — a non-finite input never yields a non-finite output (Skia crash guard)', () => {
    const bad = projectNode({ x: NaN, y: 0.5, z: Infinity, phase: NaN }, NaN, 0);
    expect(Number.isFinite(bad.px)).toBe(true);
    expect(Number.isFinite(bad.py)).toBe(true);
    expect(Number.isFinite(bad.depth)).toBe(true);
    expect(Number.isFinite(bad.phase)).toBe(true);
  });
});

describe('heat (engagement colour ramp: cyan → coral → red)', () => {
  it('anchors cyan at 0 and red at 1', () => {
    expect(heat(0)).toEqual(CYAN);
    expect(heat(1)).toEqual(RED);
  });

  it('is warm (more red than blue) at peak and cool (more blue than red) at rest', () => {
    const cool = heat(0), hot = heat(1);
    expect(cool[2]).toBeGreaterThan(cool[0]); // blue > red when calm
    expect(hot[0]).toBeGreaterThan(hot[2]);   // red > blue at peak
  });

  it('clamps out-of-range and NaN engagement to the endpoints/finite RGB', () => {
    expect(heat(-5)).toEqual(CYAN);
    expect(heat(9)).toEqual(RED);
    for (const c of heat(NaN)) expect(Number.isFinite(c)).toBe(true);
  });

  it('returns integer channels in [0,255]', () => {
    for (const e of [0, 0.25, 0.5, 0.75, 1]) {
      for (const c of heat(e)) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('clamp01', () => {
  it('clamps into [0,1] and maps non-finite to 0', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(1);
  });
});
