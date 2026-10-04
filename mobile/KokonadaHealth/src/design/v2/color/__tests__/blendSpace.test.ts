import {
  graphSegments,
  pivotComposite,
  sweepNeverRed,
  validateMix,
  type BlendGraph,
  type NeverRedSweep,
} from '../blendSpace.ts';
import { mixOklab, oklchToOklab, srgbToOklab, type Oklab } from '../oklab.ts';
import { maxInBandChromaInTriangle, type RedBand } from '../redBand.ts';

// FIXTURES. The bands are DEC-081's numbers (base.neverRed: a design band checked in float, a
// check band checked on 8-bit pixels), copied here so the mechanism is tested on its own; the
// token rules run on the token file's own values. The nodes are V0 set A's core tier (v0-spec
// §4.2), and R0 is one rest-glow value from the designer's addendum, used here as a fixture.
const DESIGN_BAND: RedBand = { hueFrom: 345, hueTo: 55, chromaFloor: 0.015 };
const CHECK_BAND: RedBand = { hueFrom: 350, hueTo: 50, chromaFloor: 0.02 };

const lch = (L: number, C: number, h: number): Oklab => oklchToOklab({ L, C, h });

const NODES = {
  J: lch(0.8, 0.11, 80),
  C: lch(0.8, 0.11, 178),
  R: lch(0.68, 0.11, 250),
  I: lch(0.68, 0.1, 322),
  R0: lch(0.5, 0.035, 75),
};

// The designer's graph (V1 addendum §2.4) with restIntenseRoute = "waypoint".
const ROUTED: BlendGraph = {
  nodes: NODES,
  straight: [['J', 'C'], ['C', 'R'], ['R', 'I'], ['J', 'R'], ['C', 'I'], ['R0', 'J'], ['R0', 'C'], ['R0', 'R']],
  waypoint: [['J', 'I'], ['R0', 'I']],
};

// The planted failure the schema asks for: joy and intense joined by a straight edge.
const PLANTED: BlendGraph = {
  ...ROUTED,
  straight: [...ROUTED.straight, ['J', 'I']],
  waypoint: [['R0', 'I']],
};

const NEUTRAL_DARK = lch(0.16, 0, 0);
const SANDSTONE = lch(0.925, 0.016, 72);

function sweep(overrides: Partial<NeverRedSweep>): ReturnType<typeof sweepNeverRed> {
  return sweepNeverRed({
    graph: ROUTED,
    grounds: { ground: NEUTRAL_DARK },
    kMax: 0.85,
    kp: 0,
    shimmerDeg: 0,
    designBand: DESIGN_BAND,
    checkBand: CHECK_BAND,
    ditherAmplitude: 1 / 255,
    grid: { kStep: 0.05, shimmerStepDeg: 1, pixelTStep: 0.25, pixelKStep: 0.25, chromaScales: [0.5, 1] },
    ...overrides,
  });
}

describe('graphSegments: every straight piece of colour a pixel can lie on', () => {
  it('lists each straight edge, both halves of each waypoint edge, and each node alone', () => {
    expect(graphSegments(ROUTED).map((s) => s.id)).toEqual([
      'J-C', 'C-R', 'R-I', 'J-R', 'C-I', 'R0-J', 'R0-C', 'R0-R',
      'J-N-I/1', 'J-N-I/2', 'R0-N-I/1', 'R0-N-I/2',
      'J', 'C', 'R', 'I', 'R0',
    ]);
  });

  // V1 addendum §2.4: "waypoint N = (lerp(L_a, L_b, 0.5), 0, 0): two straight OKLab segments".
  it('routes a waypoint edge through the neutral at the two lightnesses’ midpoint', () => {
    const [first, second] = graphSegments(ROUTED).filter((s) => s.id.startsWith('J-N-I'));
    const waypoint = { L: (NODES.J.L + NODES.I.L) / 2, a: 0, b: 0 };
    expect(first.from).toEqual(NODES.J);
    expect(first.to).toEqual(waypoint);
    expect(second.from).toEqual(waypoint);
    expect(second.to).toEqual(NODES.I);
  });

  const malformed: ReadonlyArray<readonly [string, BlendGraph]> = [
    ['an unknown node', { ...ROUTED, straight: [['J', 'X']] }],
    ['a self edge', { ...ROUTED, straight: [['J', 'J']] }],
    ['an edge listed as both straight and waypoint', { ...ROUTED, straight: [['J', 'I']] }],
    ['a duplicate edge', { ...ROUTED, straight: [['J', 'C'], ['C', 'J']] }],
  ];

  it.each(malformed)('refuses a graph with %s', (_reason, graph) => {
    expect(() => graphSegments(graph)).toThrow(RangeError);
  });
});

// V1 addendum §2.4 and DSN-049: a pixel mixes at most two graph-adjacent nodes plus its ground.
describe('validateMix: at most two nodes, and they must share an edge', () => {
  it('flags a mix of three nodes', () => {
    expect(validateMix(ROUTED, { J: 0.4, C: 0.3, R: 0.3 })).toEqual([{ code: 'too-many-nodes', nodes: ['J', 'C', 'R'] }]);
  });

  it('flags two nodes that the graph does not join', () => {
    const sparse: BlendGraph = { nodes: NODES, straight: [['J', 'C']], waypoint: [] };
    expect(validateMix(sparse, { J: 0.5, R: 0.5 })).toEqual([{ code: 'not-adjacent', nodes: ['J', 'R'] }]);
  });

  it.each([
    [{ J: 0.5, C: 0.5 }],
    [{ J: 0.5, I: 0.5 }],
    [{ J: 1 }],
    [{}],
    [{ J: 0.5, C: 0.5, R: 0 }],
  ])('accepts %j', (weights) => {
    expect(validateMix(ROUTED, weights)).toEqual([]);
  });

  it('flags a node the graph does not have, and a weight that is negative or not a number', () => {
    expect(validateMix(ROUTED, { X: 1 })).toEqual([{ code: 'unknown-node', nodes: ['X'] }]);
    expect(validateMix(ROUTED, { J: -0.1 })).toEqual([{ code: 'invalid-weight', nodes: ['J'] }]);
    expect(validateMix(ROUTED, { J: NaN })).toEqual([{ code: 'invalid-weight', nodes: ['J'] }]);
  });
});

// R4 (designer §1.2): out.L = mix(G.L, col.L, k);
// out.ab = k·col.ab + (1 − k)·(1 − smoothstep(0, kp, k))·G.ab, and kp = 0 is the plain mix.
describe('pivotComposite: the field over its local ground', () => {
  const colour = NODES.I;
  const ground = SANDSTONE;

  it('with kp = 0 it is the straight OKLab mix', () => {
    for (const k of [0, 0.1, 0.5, 0.85]) {
      const out = pivotComposite(colour, ground, k, 0);
      const plain = mixOklab(ground, colour, k);
      expect(out.L).toBeCloseTo(plain.L, 14);
      expect(out.a).toBeCloseTo(plain.a, 14);
      expect(out.b).toBeCloseTo(plain.b, 14);
    }
  });

  it('at k = 0 it is the ground', () => {
    expect(pivotComposite(colour, ground, 0, 0.2)).toEqual(ground);
  });

  it('from k = kp on, the ground keeps its lightness but none of its chroma', () => {
    const out = pivotComposite(colour, ground, 0.3, 0.2);
    expect(out.L).toBeCloseTo(ground.L + (colour.L - ground.L) * 0.3, 14);
    expect(out.a).toBeCloseTo(0.3 * colour.a, 15);
    expect(out.b).toBeCloseTo(0.3 * colour.b, 15);
  });

  it('halfway to kp the ground keeps half of its (1 − k) share of chroma', () => {
    const out = pivotComposite(colour, ground, 0.1, 0.2);
    expect(out.a).toBeCloseTo(0.1 * colour.a + 0.9 * 0.5 * ground.a, 15);
    expect(out.b).toBeCloseTo(0.1 * colour.b + 0.9 * 0.5 * ground.b, 15);
  });

  it.each([
    [-0.01, 0.2],
    [1.01, 0.2],
    [NaN, 0.2],
    [0.5, -0.1],
    [0.5, NaN],
  ])('refuses k = %p, kp = %p', (k, kp) => {
    expect(() => pivotComposite(colour, ground, k, kp)).toThrow(RangeError);
  });
});

describe('sweepNeverRed: the field’s whole blend space against both bands', () => {
  it('the designer’s routed graph is clear, in float and on 8-bit pixels', () => {
    expect(sweep({}).failures).toEqual([]);
  });

  it('the planted straight joy–intense edge fails, and only on that edge', () => {
    const failures = sweep({ graph: PLANTED }).failures;
    expect(failures.length).toBeGreaterThan(0);
    expect(new Set(failures.map((f) => f.segment))).toEqual(new Set(['J-I']));
    expect(failures.some((f) => f.check === 'design-band')).toBe(true);
  });

  it('covers every reachable segment, each local ground, every k sample and every shimmer sample', () => {
    const grounds = { ground: NEUTRAL_DARK, face: lch(0.14, 0.005, 70), ring: lch(0.27, 0.006, 72) };
    const report = sweep({ grounds, shimmerDeg: 3 });
    expect(report.segments).toEqual(graphSegments(ROUTED).map((s) => s.id));
    // k: 0 to 0.85 in 17 equal steps is 18 samples; shimmer: −3° to +3° in 1° steps is 7, for
    // each end of the segment on its own, because halos do not shimmer: 7 × 7.
    expect(report.floatChecks).toBe(17 * 3 * 18 * 7 * 7);
    // pixels: k 0 to 0.85 in 4 steps (5), t 0 to 1 in 4 steps (5), 2 × 2 chroma scales, and each
    // end at −3°, 0 or +3°: 3 × 3.
    expect(report.pixelSamples).toBe(17 * 3 * 5 * 5 * 4 * 3 * 3);
  });

  // Resilience second voice §3: a pixel can mix a shimmering field colour with a steady halo, so
  // the two ends of a segment rotate independently. Two near-opposite hues stay clear when they
  // turn together and cross the band when only one of them turns.
  it('rotates the two ends of a segment independently', () => {
    const graph: BlendGraph = { nodes: { X: lch(0.7, 0.06, 60), Y: lch(0.7, 0.06, 234) }, straight: [['X', 'Y']], waypoint: [] };
    const failures = sweep({ graph, shimmerDeg: 4 }).failures.filter((f) => f.check === 'design-band');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((f) => f.shimmerDeg[0] !== f.shimmerDeg[1])).toBe(true);
  });

  // DEC-081's margin rule needs the largest in-band chroma, not only a verdict.
  it('reports its largest in-band chroma in float and on pixels, and where each peaks', () => {
    const clear = sweep({});
    expect(clear.maxDesign.chroma).toBeGreaterThanOrEqual(0);
    expect(clear.maxDesign.chroma).toBeLessThan(DESIGN_BAND.chromaFloor);
    expect(clear.maxCheck.chroma).toBeLessThan(CHECK_BAND.chromaFloor);
    const planted = sweep({ graph: PLANTED });
    // Over a neutral ground the k = 0.85 composite scales the joy–intense chord by 0.85.
    const chord = maxInBandChromaInTriangle(NODES.J, NODES.J, NODES.I, DESIGN_BAND).chroma;
    expect(planted.maxDesign).toMatchObject({ segment: 'J-I', k: 0.85 });
    expect(planted.maxDesign.chroma).toBeCloseTo(0.85 * chord, 12);
    expect(planted.maxCheck.chroma).toBeGreaterThanOrEqual(CHECK_BAND.chromaFloor);
  });

  it('the shimmer is part of the space: a hue 3° clear of the band fails at ±4° and passes at ±2°', () => {
    const graph: BlendGraph = { nodes: { X: lch(0.7, 0.05, 58) }, straight: [], waypoint: [] };
    expect(sweep({ graph, shimmerDeg: 2 }).failures).toEqual([]);
    expect(sweep({ graph, shimmerDeg: 4 }).failures.length).toBeGreaterThan(0);
  });

  // Designer §1.4 item 5: orchid composited straight onto the Sandstone ground reaches the band.
  // R4's pivot removes the ground's warm chroma before the mix can swing through red.
  it('the pivot is what keeps orchid over a warm ground clear', () => {
    const graph: BlendGraph = { nodes: { I: NODES.I }, straight: [], waypoint: [] };
    const grounds = { ground: SANDSTONE };
    expect(sweep({ graph, grounds, kp: 0 }).failures.some((f) => f.check === 'design-band')).toBe(true);
    expect(sweep({ graph, grounds, kp: 0.2 }).failures).toEqual([]);
  });

  // The dither margin on the whole sweep: a node just under the check floor is clear in float and
  // undithered, and the field's ±1/255 L dither reaches a red pixel.
  it('the 8-bit check catches what the dither adds, and only the dither', () => {
    const graph: BlendGraph = { nodes: { X: lch(0.6, 0.0192, 25) }, straight: [], waypoint: [] };
    const grounds = { ground: lch(0.6, 0, 0) };
    const base = { graph, grounds, designBand: CHECK_BAND, kMax: 1 };
    expect(sweep({ ...base, ditherAmplitude: 0 }).failures).toEqual([]);
    const failures = sweep({ ...base, ditherAmplitude: 1 / 255 }).failures;
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((f) => f.check === 'check-band-pixel')).toBe(true);
  });

  it('a red ground fails at k = 0, before any colour is mixed in', () => {
    const failures = sweep({ grounds: { ground: srgbToOklab([0.8, 0.1, 0.1]) } }).failures;
    expect(failures.some((f) => f.k === 0 && f.check === 'design-band')).toBe(true);
  });

  it.each([
    [{ kMax: 1.2 }],
    [{ kMax: -0.1 }],
    [{ kp: -1 }],
    [{ shimmerDeg: -2 }],
    [{ ditherAmplitude: -1 }],
    [{ grid: { kStep: 0, shimmerStepDeg: 1, pixelTStep: 0.25, pixelKStep: 0.25, chromaScales: [1] } }],
    [{ grid: { kStep: 0.05, shimmerStepDeg: 1, pixelTStep: 0.25, pixelKStep: 0.25, chromaScales: [] } }],
    [{ grid: { kStep: 0.05, shimmerStepDeg: 1, pixelTStep: 0.25, pixelKStep: 0.25, chromaScales: [1.5] } }],
    [{ grounds: {} }],
  ])('refuses the configuration %j', (overrides) => {
    expect(() => sweep(overrides as Partial<NeverRedSweep>)).toThrow(RangeError);
  });
});
