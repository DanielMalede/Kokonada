import { graphSegments, sweepNeverRed, type NeverRedSweep } from '../../color/blendSpace.ts';
import { CHECK_BAND, DESIGN_BAND, fieldSweepFor, type GraphEdges } from '../neverRedSweeps.ts';
import { EXTENSIONS } from '../tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';

// QA-065 over the signed blend graph (addendum §2.4): every reachable segment, every local ground
// the field or a halo lands on, k up to max(cap, halo peak), the pivot, the shimmer turning each
// end of a segment on its own, and the field's L dither and grain on 8-bit pixels. Each sweep keeps
// DEC-081's margin below both floors. Its own file, so jest runs it beside the edge sweep.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const CASES = IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const));
const GRAPH = EXTENSIONS.base['field.graph'] as unknown as { edges: GraphEdges };
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;

const sweepFor = (id: DirectionId, face: Face, edges?: { straight: Array<[string, string]>; waypoint: Array<[string, string]> }): NeverRedSweep =>
  fieldSweepFor(id, face, GRAPH.edges, edges);

// The plate's shadows (designer ruling 2.9, with the critic's text the designer adopted): they multiply
// the local ground's L before the composite, G.L ← G.L·(1 − Σ strength·P), over the face's plate.shadow
// and plate.shadow2. Outer shadows (plate.depth > 0) land outside the rim, where the field lands only
// if mask.outside > 0; inner ones (< 0) on the face. A shadow with no strength or no blur draws nothing
// (fieldFrame.ts). The sweep samples each shadowed ground at P ∈ {0, 0.5, 1}, because quantisation near
// black is not monotone in L; P = 0 is the ground itself.
function shadowsOf(id: DirectionId, face: Face): { under: 'face' | 'ground' | null; sum: number } {
  const d = DIRECTIONS[id];
  const drawn = [d.plate.shadow[face], d.plate.shadow2[face]].filter((t) => t.strength !== 0 && t.blur > 0);
  const under = d.plate.depth < 0 ? 'face' : d.plate.depth > 0 && d.field.mask.outside > 0 ? 'ground' : null;
  return drawn.length === 0 ? { under: null, sum: 0 } : { under, sum: drawn.reduce((t, x) => t + x.strength, 0) };
}

// The close-out (Abyss only): no shipped direction draws a plate shadow, so no shadowed ground is
// swept here; the sampler's shadowed grounds are held on the fixture directions (fixturePaths.test.ts).
it('no shipped direction draws a shadow under the field, so no shadowed ground is swept', () => {
  expect(CASES.filter(([id, face]) => shadowsOf(id, face).under !== null)).toEqual([]);
});

// Tripwire (UI-096). The sweep samples a shadowed ground at P 0.5 and 1 only, which misses failures at
// intermediate P (the QA-065 probe found them between 0.125 and 0.6875). Before any direction draws a
// plate shadow, the certified P-sampler (law round 2, D8) has to replace it.
it('tripwire (UI-096): every shipped plate-shadow strength is 0 until the certified P-sampler exists', () => {
  const drawn = CASES.flatMap(([id, face]) =>
    [DIRECTIONS[id].plate.shadow[face], DIRECTIONS[id].plate.shadow2[face]].filter((t) => t.strength !== 0).map((t) => `${id} ${face} (strength ${t.strength})`),
  );
  if (drawn.length > 0) {
    throw new Error(`UI-096: ${drawn.join(', ')} draws a plate shadow, but the never-red sweep samples a shadowed ground at P 0.5 and 1 only. Build the certified P-sampler (law round 2, D8) first.`);
  }
  expect(drawn).toEqual([]);
});

describe.each(CASES)('QA-065 field segments (upsampling and Skia not yet covered): %s, %s face', (id, face) => {
  // The sweep's inputs, pinned: dropping a ground, a k bound, a segment or the grain from the
  // amplitude would otherwise leave this block green while it checked less.
  it('sweeps the grounds, k range, segments and dither amplitude this direction can show', () => {
    const cfg = sweepFor(id, face);
    const d = DIRECTIONS[id];
    const { under, sum } = shadowsOf(id, face);
    const shadowed = under === null ? [] : [`${under} shadowed 0.5`, `${under} shadowed 1`];
    expect(Object.keys(cfg.grounds).sort()).toEqual([...(d.field.mask.outside > 0 ? ['face', 'ground', 'ring'] : ['face', 'ring']), ...shadowed].sort());
    // Each shadowed ground is its ground with L·(1 − Σ strength·P): L only, so a neutral one stays neutral.
    if (under !== null) {
      for (const P of [0.5, 1]) {
        const g = cfg.grounds[under];
        expect(cfg.grounds[`${under} shadowed ${P}`]).toEqual({ L: g.L * (1 - sum * P), a: g.a, b: g.b });
      }
    }
    expect(cfg.kMax).toBe(Math.max(d.field.cap[face], face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight));
    expect(graphSegments(cfg.graph)).toHaveLength(d.field.graph.restIntenseRoute === 'waypoint' ? 17 : 16);
    expect(cfg.ditherAmplitude).toBe(BASE.field.dither.amplitude + Math.max(d.field.grain.ground, d.field.grain.inside));
  });

  // The resolutions, pinned the same way (resilience round 2, FIX-3): a coarser grid, a lost shimmer
  // or pivot, or a swapped band would otherwise go in unseen. A deliberate change edits these here.
  it('sweeps at k 0.01 and shimmer 1° in float, t and k 0.2 and chroma scales ¼, ½ and 1 on 8-bit pixels, with the pivot, shimmer and bands', () => {
    const cfg = sweepFor(id, face);
    const d = DIRECTIONS[id];
    expect(cfg.grid).toEqual({ kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.2, pixelKStep: 0.2, chromaScales: [0.25, 0.5, 1] });
    expect(cfg.kp).toBe(d.field.pivot);
    expect(cfg.shimmerDeg).toBe(d.field.shimmer.deg);
    expect(cfg.designBand).toEqual(DESIGN_BAND);
    expect(cfg.checkBand).toEqual(CHECK_BAND);
  });

  // The sweeps project's grid (UI-073): only the 8-bit grid is finer; everything else is the same.
  it('at full resolution, t and k 0.1 and shimmer 1° on 8-bit pixels, and nothing else changes', () => {
    const coarse = sweepFor(id, face);
    const full = fieldSweepFor(id, face, GRAPH.edges, undefined, 'full');
    expect(full.grid).toEqual({ kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.1, pixelKStep: 0.1, chromaScales: [0.25, 0.5, 1], pixelShimmerStepDeg: 1 });
    expect({ ...full, grid: coarse.grid }).toEqual(coarse);
  });

  it('no blend-graph colour composited over a local ground is red, in float or on 8-bit pixels, with the margin', () => {
    const report = sweepNeverRed(sweepFor(id, face));
    expect(report.failures).toEqual([]);
    expect(report.pixelSamples).toBeGreaterThan(0);
    expect(report.maxDesign.chroma).toBeLessThanOrEqual(DESIGN_LIMIT);
    expect(report.maxCheck.chroma).toBeLessThanOrEqual(CHECK_LIMIT);
  });

  it('bites: the planted straight joy–intense edge fails', () => {
    const planted = sweepFor(id, face, { straight: [['J', 'I']], waypoint: [] });
    const report = sweepNeverRed({ ...planted, grid: { ...planted.grid, pixelTStep: 0.5, pixelKStep: 0.5 } });
    expect(report.failures.some((f) => f.segment === 'J-I' && f.check === 'design-band')).toBe(true);
  });
});
