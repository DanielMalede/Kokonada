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

describe.each(CASES)('QA-065 field segments (upsampling and Skia not yet covered): %s, %s face', (id, face) => {
  // The sweep's inputs, pinned: dropping a ground, a k bound, a segment or the grain from the
  // amplitude would otherwise leave this block green while it checked less.
  it('sweeps the grounds, k range, segments and dither amplitude this direction can show', () => {
    const cfg = sweepFor(id, face);
    const d = DIRECTIONS[id];
    expect(Object.keys(cfg.grounds).sort()).toEqual(d.field.mask.outside > 0 ? ['face', 'ground', 'ring'] : ['face', 'ring']);
    expect(cfg.kMax).toBe(Math.max(d.field.cap[face], face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight));
    expect(graphSegments(cfg.graph)).toHaveLength(d.field.graph.restIntenseRoute === 'waypoint' ? 17 : 16);
    expect(cfg.ditherAmplitude).toBe(BASE.field.dither.amplitude + Math.max(d.field.grain.ground, d.field.grain.inside));
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
