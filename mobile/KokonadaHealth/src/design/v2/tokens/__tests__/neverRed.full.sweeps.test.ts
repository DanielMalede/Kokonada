import { sweepNeverRed } from '../../color/blendSpace.ts';
import { CHECK_BAND, DESIGN_BAND, edgeFamiliesFor, fieldSweepFor, type GraphEdges } from '../neverRedSweeps.ts';
import { EXTENSIONS } from '../tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';

// UI-073: QA-065 at full resolution, in the sweeps project (jest.sweeps.config.js), which CI runs
// serially in its own step. The default run keeps the coarse grids (neverRed.field.test.ts and
// neverRed.edges.test.ts, which also pin both grids). Inside the design band, the exact float pass
// plus about 0.004 of rounding bounds the check band; the blind spot is a colour just outside 345–55°
// with C ≳ 0.016 that rounding turns into 350–50°, and only a fine 8-bit grid sees it:
//   • the field: t and k at 0.1 and each end of a segment turned every 1° on 8-bit pixels;
//   • the edges: byte k at 0.01, shimmer every 1°, and every pixel the dither and grain reach.
// Both keep DEC-081's margin below both floors.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const CASES = IDS.flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const));
const GRAPH = EXTENSIONS.base['field.graph'] as unknown as { edges: GraphEdges };
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
// One direction and face of the field at full resolution takes up to about two minutes.
const LONG = 15 * 60_000;

describe.each(CASES)('QA-065 at full resolution: %s, %s face', (id, face) => {
  it(
    'the field: no blend-graph colour composited over a local ground is red, in float or on any 8-bit pixel, with the margin',
    () => {
      const config = fieldSweepFor(id, face, GRAPH.edges, undefined, 'full');
      expect(config.grid.pixelShimmerStepDeg).toBe(1);
      const report = sweepNeverRed(config);
      expect(report.failures).toEqual([]);
      expect(report.pixelSamples).toBeGreaterThan(0);
      expect(report.maxDesign.chroma).toBeLessThanOrEqual(DESIGN_LIMIT);
      expect(report.maxCheck.chroma).toBeLessThanOrEqual(CHECK_LIMIT);
    },
    LONG,
  );

  it(
    'the edges: no anti-aliased pair reaches within the margin of either band',
    () => {
      const full = edgeFamiliesFor(id, face, 'full');
      // The full grid really ran: every family that blends over a lit surface checks more pixel
      // blends than the default grid does.
      const coarse = edgeFamiliesFor(id, face);
      const lit = (f: { family: string }) => f.family.startsWith('ring halo') || f.family.startsWith('face lit');
      const fewer = full.filter((f, i) => lit(f) && !(f.pixelBlends > coarse[i].pixelBlends)).map((f) => f.family);
      expect(full.filter(lit).length).toBeGreaterThan(0);
      expect(fewer).toEqual([]);
      const over = full
        .filter((f) => f.design.chroma > DESIGN_LIMIT || f.check.chroma > CHECK_LIMIT)
        .map((f) => ({
          family: f.family,
          design: `C ${f.design.chroma.toFixed(5)} at ${f.design.hue.toFixed(1)}°`,
          check: `C ${f.check.chroma.toFixed(5)} at ${f.check.hue.toFixed(1)}°`,
        }));
      expect(over).toEqual([]);
    },
    LONG,
  );
});
